import { beforeAll, describe, expect, it } from "vitest";
import type { AuditEntry, AuditEventBody, HandoffTicket, SealedSecret } from "@/types";
import type { SolicitacaoTransbordo } from "@/lib/guardrails";

// A chave-mestra tem de existir antes de qualquer operação de cofre. É lida de
// forma preguiçosa, então definir aqui é suficiente — e usar uma chave fixa de
// teste mantém os casos determinísticos.
beforeAll(() => {
  process.env.AGENTFLOW_VAULT_KEK = Buffer.alloc(32, 7).toString("base64url");
  process.env.AGENTFLOW_VAULT_KEK_VERSION = "v1";
  process.env.FIREBASE_PROJECT_ID = "agentflow-teste";
});

const { abrirSegredo, montarAad, selarSegredo } = await import("@/lib/crypto/envelope");
const { jsonCanonico } = await import("@/lib/crypto/canonical");
const { chaveAuditoria } = await import("@/lib/server/env");
const { HASH_GENESIS, idEntradaAuditoria, selarEntradaAuditoria, verificarCadeiaAuditoria } =
  await import("@/lib/crypto/auditChain");
const { base64UrlParaBytes, bytesParaBase64Url, comparacaoSegura } = await import(
  "@/lib/crypto/encoding"
);

const REFERENCIA_CRED = { workspaceId: "default", recursoId: "cred_1", versao: 1, proposito: "credencial" };

describe("encoding", () => {
  it("faz ida e volta em base64url para bytes arbitrários", () => {
    const original = new Uint8Array([0, 1, 127, 128, 255, 42, 17]);
    expect([...base64UrlParaBytes(bytesParaBase64Url(original))]).toEqual([...original]);
  });

  it("produz base64url sem padding nem caracteres inseguros para URL", () => {
    const codificado = bytesParaBase64Url(new Uint8Array([251, 255, 254]));
    expect(codificado).not.toContain("=");
    expect(codificado).not.toContain("+");
    expect(codificado).not.toContain("/");
  });

  it("compara em tempo constante sem falsos positivos", () => {
    expect(comparacaoSegura("abc123", "abc123")).toBe(true);
    expect(comparacaoSegura("abc123", "abc124")).toBe(false);
    expect(comparacaoSegura("abc", "abcd")).toBe(false);
  });
});

describe("jsonCanonico", () => {
  it("ordena chaves para que o hash não dependa da ordem de inserção", () => {
    expect(jsonCanonico({ b: 1, a: 2 })).toBe(jsonCanonico({ a: 2, b: 1 }));
    expect(jsonCanonico({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("omite undefined em objeto e o converte em null em array", () => {
    expect(jsonCanonico({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(jsonCanonico([1, undefined, 3])).toBe("[1,null,3]");
  });

  it("rejeita valores sem representação em JSON", () => {
    expect(() => jsonCanonico({ v: Number.NaN })).toThrow(/não representável/i);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => jsonCanonico(circular)).toThrow(/circular/i);
  });
});

describe("envelope encryption", () => {
  it("cifra e decifra com o AAD correto", async () => {
    const segredo = "sk-teste-abcdefghijklmnop";
    const envelope = await selarSegredo({ plaintext: segredo, ...REFERENCIA_CRED });

    expect(envelope.algoritmo).toBe("AES-256-GCM");
    expect(envelope.ciphertext).not.toContain(segredo);

    const aberto = await abrirSegredo(envelope, montarAad(REFERENCIA_CRED));
    expect(aberto).toBe(segredo);
  });

  it("recusa abrir um envelope sob AAD de outro recurso", async () => {
    const envelope = await selarSegredo({ plaintext: "segredo-de-teste", ...REFERENCIA_CRED });
    const aadDeOutroWorkspace = montarAad({ ...REFERENCIA_CRED, workspaceId: "outro" });

    await expect(abrirSegredo(envelope, aadDeOutroWorkspace)).rejects.toThrow(/AAD do envelope/i);
  });

  it("recusa ciphertext adulterado", async () => {
    const envelope = await selarSegredo({ plaintext: "segredo-de-teste", ...REFERENCIA_CRED });
    const bytes = base64UrlParaBytes(envelope.ciphertext);
    bytes[0] = bytes[0] ^ 0xff;

    const adulterado: SealedSecret = { ...envelope, ciphertext: bytesParaBase64Url(bytes) };
    await expect(abrirSegredo(adulterado, montarAad(REFERENCIA_CRED))).rejects.toThrow(
      /dados inválidos, adulterados ou chave incorreta/i
    );
  });

  it("gera IVs distintos para o mesmo segredo", async () => {
    const a = await selarSegredo({ plaintext: "mesmo-segredo-aqui", ...REFERENCIA_CRED });
    const b = await selarSegredo({ plaintext: "mesmo-segredo-aqui", ...REFERENCIA_CRED });

    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    // A impressão digital, por ser determinística, detecta reuso na rotação.
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("rejeita componente de AAD com o separador do formato", () => {
    expect(() => montarAad({ ...REFERENCIA_CRED, recursoId: "cred|injetado" })).toThrow(
      /Componente de AAD inválido/i
    );
  });

  it("rejeita segredo vazio", async () => {
    await expect(selarSegredo({ plaintext: "", ...REFERENCIA_CRED })).rejects.toThrow(/vazio/i);
  });
});

function corpo(parcial: Partial<AuditEventBody> = {}): AuditEventBody {
  return {
    tipo: "guardrail.entrada.mascarada",
    resultado: "sucesso",
    workspaceId: "default",
    ator: "uid-1",
    recurso: "flows/flow-1",
    detalhes: { pii: 2 },
    ocorridoEm: "2026-03-15T12:00:00.000Z",
    ...parcial,
  };
}

/** Sela uma cadeia de N entradas, como o servidor faria em sequência. */
async function selarCadeia(quantidade: number): Promise<AuditEntry[]> {
  const chave = await chaveAuditoria();
  const entradas: AuditEntry[] = [];
  let anterior: Pick<AuditEntry, "seq" | "chainHash"> | null = null;

  for (let i = 1; i <= quantidade; i += 1) {
    const entrada = await selarEntradaAuditoria({
      corpo: corpo({ recurso: `flows/flow-${i}` }),
      anterior,
      chaveHmac: chave,
    });
    entradas.push(entrada);
    anterior = { seq: entrada.seq, chainHash: entrada.chainHash };
  }

  return entradas;
}

describe("trilha de auditoria", () => {
  it("deriva o id do documento a partir da posição na cadeia", () => {
    expect(idEntradaAuditoria("default", 7)).toBe("default__000000000007");
    // O id é o que faz uma posição já ocupada cair em `update`, negado nas regras.
    expect(idEntradaAuditoria("default", 7)).toBe(idEntradaAuditoria("default", 7));
  });

  it("inicia a cadeia com prevHash vazio e seq 1", async () => {
    const [primeira] = await selarCadeia(1);
    expect(primeira.seq).toBe(1);
    expect(primeira.prevHash).toBe(HASH_GENESIS);
  });

  it("encadeia cada entrada à anterior", async () => {
    const entradas = await selarCadeia(4);
    for (let i = 1; i < entradas.length; i += 1) {
      expect(entradas[i].prevHash).toBe(entradas[i - 1].chainHash);
      expect(entradas[i].seq).toBe(entradas[i - 1].seq + 1);
    }
  });

  it("valida uma cadeia íntegra, inclusive as assinaturas", async () => {
    const entradas = await selarCadeia(5);
    const verificacao = await verificarCadeiaAuditoria(entradas, await chaveAuditoria());

    expect(verificacao.integra).toBe(true);
    expect(verificacao.assinaturasVerificadas).toBe(true);
    expect(verificacao.entradasVerificadas).toBe(5);
  });

  it("ordena por seq antes de verificar, tolerando a ordem de chegada", async () => {
    const entradas = await selarCadeia(4);
    const embaralhadas = [entradas[2], entradas[0], entradas[3], entradas[1]];
    const verificacao = await verificarCadeiaAuditoria(embaralhadas, await chaveAuditoria());
    expect(verificacao.integra).toBe(true);
  });

  it("detecta edição do conteúdo de uma entrada", async () => {
    const entradas = await selarCadeia(3);
    entradas[1] = {
      ...entradas[1],
      corpo: { ...entradas[1].corpo, resultado: "negado" },
    };

    const verificacao = await verificarCadeiaAuditoria(entradas, await chaveAuditoria());
    expect(verificacao.integra).toBe(false);
    expect(verificacao.problemas.map((p) => p.problema)).toContain("hash-conteudo-divergente");
  });

  it("detecta remoção de uma entrada do meio da cadeia", async () => {
    const entradas = await selarCadeia(4);
    const comBuraco = [entradas[0], entradas[1], entradas[3]];

    const verificacao = await verificarCadeiaAuditoria(comBuraco, await chaveAuditoria());
    expect(verificacao.integra).toBe(false);
    const problemas = verificacao.problemas.map((p) => p.problema);
    expect(problemas).toContain("sequencia-fora-de-ordem");
    expect(problemas).toContain("encadeamento-rompido");
  });

  it("detecta entrada forjada sem a chave do servidor", async () => {
    const entradas = await selarCadeia(2);
    const forjada: AuditEntry = { ...entradas[1], assinatura: "0".repeat(64) };

    const verificacao = await verificarCadeiaAuditoria([entradas[0], forjada], await chaveAuditoria());
    expect(verificacao.integra).toBe(false);
    expect(verificacao.problemas.map((p) => p.problema)).toContain("assinatura-invalida");
  });

  it("verifica estrutura sem a chave, marcando que a assinatura não foi conferida", async () => {
    const entradas = await selarCadeia(3);
    const verificacao = await verificarCadeiaAuditoria(entradas);

    expect(verificacao.integra).toBe(true);
    expect(verificacao.assinaturasVerificadas).toBe(false);
  });

  it("detecta duas entradas na mesma posição", async () => {
    const entradas = await selarCadeia(2);
    const verificacao = await verificarCadeiaAuditoria(
      [entradas[0], { ...entradas[0], id: "clone" }],
      await chaveAuditoria()
    );
    expect(verificacao.problemas.map((p) => p.problema)).toContain("sequencia-duplicada");
  });
});

const { SLA_MINUTOS, construirTicket, derivarMotivo, derivarPrioridade, estatisticasFila, formatarSla, ordenarFila, slaViolado } =
  await import("@/lib/humanInTheLoop");

const AGORA = new Date("2026-03-15T12:00:00.000Z");

function solicitacao(parcial: Partial<SolicitacaoTransbordo> = {}): SolicitacaoTransbordo {
  return {
    traceId: "gr_teste",
    politicaId: "padrao",
    severidade: "alta",
    veredito: "transbordo",
    violacoes: [{ regra: "pii-vazamento-saida", severidade: "alta", mensagem: "vazamento" }],
    payloadMascarado: "{}",
    ...parcial,
  };
}

describe("transbordo: prioridade e SLA", () => {
  it("mapeia severidade em prioridade", () => {
    expect(derivarPrioridade("critica", false)).toBe("p1");
    expect(derivarPrioridade("alta", false)).toBe("p2");
    expect(derivarPrioridade("media", false)).toBe("p3");
    expect(derivarPrioridade("info", false)).toBe("p4");
  });

  it("eleva um nível quando o nó é crítico", () => {
    expect(derivarPrioridade("alta", true)).toBe("p1");
    expect(derivarPrioridade("media", true)).toBe("p2");
    // P1 já é o topo: não há para onde escalar.
    expect(derivarPrioridade("critica", true)).toBe("p1");
  });

  it("calcula o prazo de SLA a partir da prioridade", () => {
    const ticket = construirTicket({
      solicitacao: solicitacao({ severidade: "critica" }),
      flowId: "flow-1",
      flowNome: "Faturamento",
      agora: AGORA,
      gerarId: () => "hitl_fixo",
    });

    expect(ticket.prioridade).toBe("p1");
    expect(new Date(ticket.slaExpiraEm).getTime() - AGORA.getTime()).toBe(SLA_MINUTOS.p1 * 60_000);
    expect(ticket.status).toBe("aberto");
  });

  it("deriva o motivo mais específico a partir das violações", () => {
    expect(
      derivarMotivo([{ regra: "loop-ciclo-no", severidade: "critica", mensagem: "" }], "bloqueado")
    ).toBe("loop-detectado");
    expect(
      derivarMotivo(
        [{ regra: "inconsistencia-estocastica", severidade: "alta", mensagem: "" }],
        "transbordo"
      )
    ).toBe("baixa-consistencia");
    // Sem violação específica, recai no veredito.
    expect(derivarMotivo([], "bloqueado")).toBe("guardrail-bloqueio");
  });

  it("nunca copia o payload em claro para o ticket", () => {
    const ticket = construirTicket({
      solicitacao: solicitacao({ payloadMascarado: "cpf: [[PII:CPF:1]]" }),
      flowId: "flow-1",
      flowNome: "Faturamento",
      agora: AGORA,
    });
    expect(ticket.payloadMascarado).toBe("cpf: [[PII:CPF:1]]");
    expect(JSON.stringify(ticket)).not.toContain("529.982.247-25");
  });
});

describe("transbordo: fila", () => {
  function ticketFila(parcial: Partial<HandoffTicket> & Pick<HandoffTicket, "id">): HandoffTicket {
    return {
      workspaceId: "default",
      flowId: "flow-1",
      flowNome: "Fluxo",
      traceId: `gr_${parcial.id}`,
      motivo: "guardrail-revisao",
      status: "aberto",
      prioridade: "p3",
      severidade: "media",
      violacoes: [],
      payloadMascarado: "{}",
      criadoEm: AGORA.toISOString(),
      criadoPor: "sistema",
      slaExpiraEm: new Date(AGORA.getTime() + 60 * 60_000).toISOString(),
      ...parcial,
    };
  }

  it("reconhece SLA violado apenas em ticket ainda pendente", () => {
    const vencido = ticketFila({ id: "t1", slaExpiraEm: new Date(AGORA.getTime() - 60_000).toISOString() });
    expect(slaViolado(vencido, AGORA)).toBe(true);
    // Resolvido não está mais em violação: a decisão já foi tomada.
    expect(slaViolado({ ...vencido, status: "resolvido" }, AGORA)).toBe(false);
  });

  it("coloca os SLA violados à frente na ordenação", () => {
    const fila = [
      ticketFila({ id: "normal", prioridade: "p1" }),
      ticketFila({ id: "atrasado", prioridade: "p4", slaExpiraEm: new Date(AGORA.getTime() - 1).toISOString() }),
    ];
    expect(ordenarFila(fila, AGORA)[0].id).toBe("atrasado");
  });

  it("ordena resolvidos depois dos pendentes", () => {
    const fila = [
      ticketFila({ id: "resolvido", status: "resolvido" }),
      ticketFila({ id: "aberto" }),
    ];
    expect(ordenarFila(fila, AGORA).map((t) => t.id)).toEqual(["aberto", "resolvido"]);
  });

  it("calcula as estatísticas da fila", () => {
    const fila = [
      ticketFila({ id: "t1" }),
      ticketFila({ id: "t2", status: "em-analise", prioridade: "p1" }),
      ticketFila({
        id: "t3",
        status: "resolvido",
        decididoEm: new Date(AGORA.getTime() + 20 * 60_000).toISOString(),
      }),
      ticketFila({ id: "t4", status: "expirado", slaExpiraEm: new Date(AGORA.getTime() - 1).toISOString() }),
    ];

    const estatisticas = estatisticasFila(fila, AGORA);
    expect(estatisticas.total).toBe(4);
    expect(estatisticas.abertos).toBe(1);
    expect(estatisticas.emAnalise).toBe(1);
    expect(estatisticas.resolvidos).toBe(1);
    expect(estatisticas.expirados).toBe(1);
    expect(estatisticas.emViolacaoDeSla).toBe(1);
    expect(estatisticas.porPrioridade.p1).toBe(1);
    expect(estatisticas.tempoMedioResolucaoMin).toBe(20);
  });

  it("não inventa tempo médio sem ticket resolvido", () => {
    expect(estatisticasFila([ticketFila({ id: "t1" })], AGORA).tempoMedioResolucaoMin).toBeNull();
  });

  it("formata o SLA restante e o atraso", () => {
    expect(
      formatarSla(
        ticketFila({ id: "t1", slaExpiraEm: new Date(AGORA.getTime() + 45 * 60_000).toISOString() }),
        AGORA
      )
    ).toBe("45 min");
    // A partir de uma hora, a unidade muda.
    expect(formatarSla(ticketFila({ id: "t1" }), AGORA)).toBe("1h");
    expect(
      formatarSla(
        ticketFila({ id: "t2", slaExpiraEm: new Date(AGORA.getTime() - 5 * 60_000).toISOString() }),
        AGORA
      )
    ).toBe("atrasado 5 min");
  });
});
