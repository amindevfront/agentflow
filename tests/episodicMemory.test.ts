import { describe, expect, it } from "vitest";
import type { Transaction } from "firebase-admin/firestore";
import type { NoClienteEpisodico, RegistrarInteracaoInput } from "@/lib/server/episodicMemory";
import {
  aplicarInteracao,
  executarTransacaoDeInteracao,
  formatarResumoUnificado,
  temContextoCrossChannel,
} from "@/lib/server/episodicMemory";

function interacao(parcial: Partial<RegistrarInteracaoInput> = {}): RegistrarInteracaoInput {
  return {
    workspaceId: "ws-1",
    clienteId: "cliente-1",
    canal: "whatsapp",
    conversationId: "conv-1",
    assunto: "Dúvida sobre agendamento",
    resumoCurto: "Cliente perguntou sobre horários disponíveis.",
    ...parcial,
  };
}

/**
 * Firestore falso mínimo — mesmo padrão de `tests/auditChainStore.test.ts`:
 * só o subconjunto de `Transaction`/`Firestore` que `executarTransacaoDeInteracao`
 * de fato usa, sem depender de Firestore real nem do emulador.
 */
function criarFirestoreFalso() {
  const armazenamento = new Map<string, unknown>();

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

describe("aplicarInteracao", () => {
  it("cria um nó novo a partir da primeira interação do cliente", () => {
    const no = aplicarInteracao(null, interacao(), "2026-03-15T12:00:00.000Z");

    expect(no.workspaceId).toBe("ws-1");
    expect(no.clienteId).toBe("cliente-1");
    expect(no.canaisConhecidos).toEqual(["whatsapp"]);
    expect(no.totalInteracoes).toBe(1);
    expect(no.ultimoCanal).toBe("whatsapp");
    expect(no.episodiosRecentes).toHaveLength(1);
    expect(no.episodiosRecentes[0].desfechoConversao).toBeNull();
  });

  it("acumula um novo canal nas arestas conhecidas quando o cliente troca de canal", () => {
    const primeiro = aplicarInteracao(null, interacao({ canal: "whatsapp" }), "2026-03-15T12:00:00.000Z");
    const segundo = aplicarInteracao(
      primeiro,
      interacao({ canal: "instagram", conversationId: "conv-2" }),
      "2026-03-16T09:00:00.000Z"
    );

    expect(segundo.canaisConhecidos).toEqual(["whatsapp", "instagram"]);
    expect(segundo.ultimoCanal).toBe("instagram");
    expect(segundo.totalInteracoes).toBe(2);
    expect(temContextoCrossChannel(segundo)).toBe(true);
  });

  it("não duplica o mesmo canal nas arestas conhecidas em interações repetidas", () => {
    const primeiro = aplicarInteracao(null, interacao(), "2026-03-15T12:00:00.000Z");
    const segundo = aplicarInteracao(primeiro, interacao({ conversationId: "conv-2" }), "2026-03-15T13:00:00.000Z");

    expect(segundo.canaisConhecidos).toEqual(["whatsapp"]);
    expect(temContextoCrossChannel(segundo)).toBe(false);
  });

  it("mantém apenas a janela rolante de episódios mais recentes, do mais novo para o mais antigo", () => {
    let no: NoClienteEpisodico | null = null;
    for (let i = 1; i <= 10; i += 1) {
      no = aplicarInteracao(
        no,
        interacao({ conversationId: `conv-${i}`, assunto: `Assunto ${i}` }),
        `2026-03-${String(i).padStart(2, "0")}T12:00:00.000Z`
      );
    }

    expect(no!.totalInteracoes).toBe(10);
    expect(no!.episodiosRecentes).toHaveLength(8);
    expect(no!.episodiosRecentes[0].assunto).toBe("Assunto 10");
    expect(no!.episodiosRecentes.at(-1)!.assunto).toBe("Assunto 3");
  });

  it("trunca resumos longos preservando o teto de caracteres", () => {
    const resumoLongo = "a".repeat(500);
    const no = aplicarInteracao(null, interacao({ resumoCurto: resumoLongo }), "2026-03-15T12:00:00.000Z");

    expect(no.episodiosRecentes[0].resumoCurto.length).toBeLessThanOrEqual(140);
    expect(no.episodiosRecentes[0].resumoCurto.endsWith("…")).toBe(true);
  });

  it("preserva resumos curtos sem truncar nem adicionar reticências", () => {
    const no = aplicarInteracao(null, interacao({ resumoCurto: "  Resumo curto.  " }), "2026-03-15T12:00:00.000Z");

    expect(no.episodiosRecentes[0].resumoCurto).toBe("Resumo curto.");
  });

  it("registra o desfecho de conversão quando informado", () => {
    const no = aplicarInteracao(
      null,
      interacao({ desfechoConversao: "fechado-venda" }),
      "2026-03-15T12:00:00.000Z"
    );

    expect(no.episodiosRecentes[0].desfechoConversao).toBe("fechado-venda");
  });
});

describe("temContextoCrossChannel", () => {
  it("é falso para um único canal conhecido", () => {
    const no = aplicarInteracao(null, interacao(), "2026-03-15T12:00:00.000Z");
    expect(temContextoCrossChannel(no)).toBe(false);
  });
});

describe("formatarResumoUnificado", () => {
  it("formata o resumo com contagem de canais e episódios recentes, mais novo primeiro", () => {
    const primeiro = aplicarInteracao(
      null,
      interacao({ canal: "whatsapp", assunto: "Orçamento", resumoCurto: "Perguntou o preço." }),
      "2026-03-15T12:00:00.000Z"
    );
    const segundo = aplicarInteracao(
      primeiro,
      interacao({
        canal: "instagram",
        conversationId: "conv-2",
        assunto: "Agendamento",
        resumoCurto: "Quer remarcar horário.",
        desfechoConversao: "perdido-sem-agenda",
      }),
      "2026-03-16T09:00:00.000Z"
    );

    const texto = formatarResumoUnificado(segundo);

    expect(texto).toContain("2 interação(ões) em 2 canal(is) (WhatsApp, Instagram)");
    expect(texto).toContain("Último contato por Instagram em 2026-03-16T09:00:00.000Z");
    expect(texto.indexOf("Agendamento")).toBeLessThan(texto.indexOf("Orçamento"));
    expect(texto).toContain("[perdido-sem-agenda]");
  });

  it("omite a seção de episódios recentes quando não há nenhum", () => {
    const no: NoClienteEpisodico = {
      workspaceId: "ws-1",
      clienteId: "cliente-1",
      canaisConhecidos: ["email"],
      totalInteracoes: 0,
      ultimoCanal: "email",
      ultimaInteracaoEm: "2026-03-15T12:00:00.000Z",
      episodiosRecentes: [],
      atualizadoEm: "2026-03-15T12:00:00.000Z",
    };

    const texto = formatarResumoUnificado(no);

    expect(texto).not.toContain("Episódios recentes");
  });
});

describe("executarTransacaoDeInteracao", () => {
  it("inicia o nó do cliente do zero na primeira chamada", async () => {
    const { db, tx } = criarFirestoreFalso();

    const no = await executarTransacaoDeInteracao(tx, db as never, interacao(), "2026-03-15T12:00:00.000Z");

    expect(no.totalInteracoes).toBe(1);
  });

  it("acumula interações sucessivas do mesmo cliente no mesmo documento", async () => {
    const { db, tx } = criarFirestoreFalso();

    await executarTransacaoDeInteracao(tx, db as never, interacao(), "2026-03-15T12:00:00.000Z");
    const segundo = await executarTransacaoDeInteracao(
      tx,
      db as never,
      interacao({ canal: "instagram", conversationId: "conv-2" }),
      "2026-03-16T09:00:00.000Z"
    );

    expect(segundo.totalInteracoes).toBe(2);
    expect(segundo.canaisConhecidos).toEqual(["whatsapp", "instagram"]);
  });

  it("mantém nós de clientes diferentes totalmente independentes", async () => {
    const { db, tx } = criarFirestoreFalso();

    const a = await executarTransacaoDeInteracao(
      tx,
      db as never,
      interacao({ clienteId: "cliente-a" }),
      "2026-03-15T12:00:00.000Z"
    );
    const b = await executarTransacaoDeInteracao(
      tx,
      db as never,
      interacao({ clienteId: "cliente-b" }),
      "2026-03-15T12:05:00.000Z"
    );

    expect(a.totalInteracoes).toBe(1);
    expect(b.totalInteracoes).toBe(1);
  });

  it("persiste o nó atualizado no documento nomeado por workspace e cliente", async () => {
    const { db, tx, armazenamento } = criarFirestoreFalso();

    await executarTransacaoDeInteracao(tx, db as never, interacao(), "2026-03-15T12:00:00.000Z");

    const persistido = armazenamento.get("episodicMemoryNodes/ws-1__cliente-1") as NoClienteEpisodico;
    expect(persistido.totalInteracoes).toBe(1);
  });
});
