import { describe, expect, it } from "vitest";
import type { Transaction } from "firebase-admin/firestore";
import type { Conversation, HandoffTicket } from "@/types";
import {
  detectarTicketsEmViolacaoRegulatoria,
  executarTransacaoFallbackSacShield,
} from "@/lib/server/sacShieldHandoffMonitor";

const CHAVE_HMAC = new Uint8Array(32).fill(7);
const AGORA = new Date("2026-03-15T12:00:00.000Z");

function ticket(parcial: Partial<HandoffTicket> = {}): HandoffTicket {
  return {
    id: "hitl_1",
    workspaceId: "ws-1",
    flowId: "conv-1",
    flowNome: "Conversa WhatsApp",
    conversationId: "conv-1",
    traceId: "trace_1",
    motivo: "frustracao-critica",
    status: "aberto",
    prioridade: "p1",
    severidade: "critica",
    violacoes: [],
    payloadMascarado: "{}",
    criadoEm: "2026-03-15T11:40:00.000Z",
    criadoPor: "sistema",
    // Vencido há 5 minutos em relação a AGORA.
    slaExpiraEm: "2026-03-15T11:55:00.000Z",
    atribuidoPara: null,
    atribuidoEm: null,
    ...parcial,
  };
}

function conversa(parcial: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv-1",
    workspaceId: "ws-1",
    canal: "whatsapp",
    participante: { nome: "Cliente", identificadorMascarado: "+55 ** *****-1234" },
    assunto: "Atraso na entrega",
    status: "escalada",
    prioridade: "p1",
    atribuidoTipo: "agente",
    atribuidoId: "agente-1",
    atribuidoNome: "Agente IA",
    frustrationIndex: 90,
    frustrationTendencia: "subindo",
    circuitBreakerAtivo: false,
    slaTicketId: "hitl_1",
    ultimaMensagemPreview: "...",
    ultimaMensagemEm: "2026-03-15T11:50:00.000Z",
    criadaEm: "2026-03-15T11:30:00.000Z",
    totalMensagens: 4,
    totalMensagensCliente: 2,
    ...parcial,
  };
}

/** Mesmo dublê mínimo de Firestore usado em `tests/auditChainStore.test.ts`. */
function criarFirestoreFalso(seed: Record<string, unknown> = {}) {
  const armazenamento = new Map<string, unknown>(Object.entries(seed));

  const db = {
    collection: (nomeColecao: string) => ({
      doc: (id: string) => ({ _chave: `${nomeColecao}/${id}` }),
    }),
  };

  const tx = {
    get: async (ref: { _chave: string }) => {
      const dados = armazenamento.get(ref._chave);
      return { exists: dados !== undefined, data: () => dados };
    },
    set: (ref: { _chave: string }, dados: unknown) => {
      armazenamento.set(ref._chave, dados);
    },
  } as unknown as Pick<Transaction, "get" | "set">;

  return { db, tx, armazenamento };
}

describe("detectarTicketsEmViolacaoRegulatoria", () => {
  it("seleciona apenas tickets abertos, vinculados a uma conversa, com SLA vencido", () => {
    const vencidoComConversa = ticket({ id: "t1" });
    const vencidoSemConversa = ticket({ id: "t2", conversationId: undefined });
    const dentroDoSla = ticket({ id: "t3", slaExpiraEm: "2026-03-15T13:00:00.000Z" });
    const jaResolvido = ticket({ id: "t4", status: "resolvido" });

    const resultado = detectarTicketsEmViolacaoRegulatoria(
      [vencidoComConversa, vencidoSemConversa, dentroDoSla, jaResolvido],
      AGORA
    );

    expect(resultado.map((t) => t.id)).toEqual(["t1"]);
  });

  it("inclui tickets em-análise, não só abertos", () => {
    const emAnalise = ticket({ id: "t5", status: "em-analise" });
    expect(detectarTicketsEmViolacaoRegulatoria([emAnalise], AGORA).map((t) => t.id)).toEqual(["t5"]);
  });
});

describe("executarTransacaoFallbackSacShield", () => {
  it("expira o ticket, congela a conversa e sela a auditoria — caminho feliz", async () => {
    const { db, tx, armazenamento } = criarFirestoreFalso({
      "hitlTickets/hitl_1": ticket(),
      "conversations/conv-1": conversa(),
    });

    const alerta = await executarTransacaoFallbackSacShield(tx, db as never, {
      ticketId: "hitl_1",
      workspaceId: "ws-1",
      chaveHmac: CHAVE_HMAC,
      referencia: AGORA,
    });

    expect(alerta).not.toBeNull();
    expect(alerta?.ticketId).toBe("hitl_1");
    expect(alerta?.conversationId).toBe("conv-1");
    expect(alerta?.severidade).toBe("critica");
    expect(alerta?.atrasoMinutos).toBe(5);

    const ticketPersistido = armazenamento.get("hitlTickets/hitl_1") as HandoffTicket;
    expect(ticketPersistido.status).toBe("expirado");

    const conversaPersistida = armazenamento.get("conversations/conv-1") as Conversation;
    expect(conversaPersistida.circuitBreakerAtivo).toBe(true);
    expect(conversaPersistida.sacShieldFallbackAtivo).toBe(true);
    expect(conversaPersistida.sacShieldFallbackEm).toBe(AGORA.toISOString());
    expect(conversaPersistida.atribuidoTipo).toBe("nenhum");
    expect(conversaPersistida.atribuidoId).toBeNull();

    const entradaAuditoria = armazenamento.get(`auditLogs/${alerta?.auditEntryId}`) as {
      corpo: { tipo: string; severidade: string };
    };
    expect(entradaAuditoria.corpo.tipo).toBe("sacshield.handoff.fallback-acionado");
    expect(entradaAuditoria.corpo.severidade).toBe("critica");
  });

  it("não aplica nada quando o ticket não tem conversationId vinculado", async () => {
    const { db, tx, armazenamento } = criarFirestoreFalso({
      "hitlTickets/hitl_1": ticket({ conversationId: undefined }),
    });

    const alerta = await executarTransacaoFallbackSacShield(tx, db as never, {
      ticketId: "hitl_1",
      workspaceId: "ws-1",
      chaveHmac: CHAVE_HMAC,
      referencia: AGORA,
    });

    expect(alerta).toBeNull();
    expect(armazenamento.size).toBe(1); // nada novo foi escrito
  });

  it("não aplica nada quando o ticket já foi resolvido entre a varredura e a transação", async () => {
    const { db, tx } = criarFirestoreFalso({
      "hitlTickets/hitl_1": ticket({ status: "resolvido" }),
    });

    const alerta = await executarTransacaoFallbackSacShield(tx, db as never, {
      ticketId: "hitl_1",
      workspaceId: "ws-1",
      chaveHmac: CHAVE_HMAC,
      referencia: AGORA,
    });

    expect(alerta).toBeNull();
  });

  it("não aplica nada quando o SLA deixou de estar violado (relido com outra referência de tempo)", async () => {
    const { db, tx } = criarFirestoreFalso({
      "hitlTickets/hitl_1": ticket(),
    });

    const alerta = await executarTransacaoFallbackSacShield(tx, db as never, {
      ticketId: "hitl_1",
      workspaceId: "ws-1",
      chaveHmac: CHAVE_HMAC,
      referencia: new Date("2026-03-15T11:50:00.000Z"), // antes do vencimento
    });

    expect(alerta).toBeNull();
  });

  it("retorna null quando o ticket não existe mais", async () => {
    const { db, tx } = criarFirestoreFalso();

    const alerta = await executarTransacaoFallbackSacShield(tx, db as never, {
      ticketId: "inexistente",
      workspaceId: "ws-1",
      chaveHmac: CHAVE_HMAC,
      referencia: AGORA,
    });

    expect(alerta).toBeNull();
  });

  it("aplica o fallback ao ticket mesmo quando a conversa vinculada não é encontrada", async () => {
    const { db, tx, armazenamento } = criarFirestoreFalso({
      "hitlTickets/hitl_1": ticket(),
    });

    const alerta = await executarTransacaoFallbackSacShield(tx, db as never, {
      ticketId: "hitl_1",
      workspaceId: "ws-1",
      chaveHmac: CHAVE_HMAC,
      referencia: AGORA,
    });

    expect(alerta).not.toBeNull();
    const ticketPersistido = armazenamento.get("hitlTickets/hitl_1") as HandoffTicket;
    expect(ticketPersistido.status).toBe("expirado");
  });
});
