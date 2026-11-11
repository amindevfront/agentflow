// Ação "Resetar ambiente de testes" (Configurações → Zona de risco) —
// `@/lib/server/testEnvironmentResetAdmin`.
//
// Cobre os quatro pontos críticos pedidos para esta ação destrutiva:
//   (a) exige papel admin — `autorizarResetAmbienteTeste` é pura, testada
//       isoladamente sem precisar simular a rota HTTP inteira;
//   (b) apaga conversas (+ mensagens) e fluxos do workspace certo;
//   (c) NÃO apaga nada de outro workspace — isolamento multi-tenant;
//   (d) gera uma entrada de auditoria do próprio reset (quem, quando, contagens).
//
// Firestore falso minimalista: um único Map `armazenamento`, chaveado pelo
// caminho completo do documento (`conversations/c1`,
// `conversations/c1/mensagens/m1`, `flows/f1`, `auditLogs/<id>`,
// `auditChainHead/<workspaceId>`) — suficiente para `where().get()`,
// `batch().delete()/commit()` e `runTransaction()` (mesmo contrato
// `tx.get`/`tx.set` que `executarTransacaoDeSelo` já usa em
// `tests/auditChainStore.test.ts`), sem depender do Admin SDK real nem do
// emulador.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "@/types";

interface RefFalsa {
  _caminho: string;
  collection: (sub: string) => ColecaoFalsa;
}

interface ColecaoFalsa {
  doc: (id: string) => RefFalsa;
  where: (campo: string, operador: string, valor: unknown) => { get: () => Promise<SnapshotFalso> };
  get: () => Promise<SnapshotFalso>;
}

interface SnapshotFalso {
  docs: Array<{ id: string; ref: RefFalsa; data: () => Record<string, unknown> }>;
  size: number;
}

const armazenamento = new Map<string, Record<string, unknown>>();

function refPara(caminho: string): RefFalsa {
  return {
    _caminho: caminho,
    collection: (sub: string) => colecaoRef(`${caminho}/${sub}`),
  };
}

/** Só os docs DIRETOS deste prefixo — uma barra extra no resto do caminho indica um neto (subcoleção mais funda), não um filho. */
function filhosDiretos(prefixo: string): Array<[string, Record<string, unknown>]> {
  return [...armazenamento.entries()].filter(
    ([chave]) => chave.startsWith(`${prefixo}/`) && !chave.slice(prefixo.length + 1).includes("/")
  );
}

function colecaoRef(prefixo: string): ColecaoFalsa {
  return {
    doc: (id: string) => refPara(`${prefixo}/${id}`),
    where: (campo: string, _operador: string, valor: unknown) => ({
      get: async () => {
        const docs = filhosDiretos(prefixo)
          .filter(([, dados]) => dados[campo] === valor)
          .map(([chave, dados]) => ({ id: chave.slice(prefixo.length + 1), ref: refPara(chave), data: () => dados }));
        return { docs, size: docs.length };
      },
    }),
    get: async () => {
      const docs = filhosDiretos(prefixo).map(([chave, dados]) => ({
        id: chave.slice(prefixo.length + 1),
        ref: refPara(chave),
        data: () => dados,
      }));
      return { docs, size: docs.length };
    },
  };
}

function criarDbFalso() {
  return {
    collection: (nome: string) => colecaoRef(nome),
    batch: () => {
      const pendentes: Array<() => void> = [];
      return {
        delete: (ref: RefFalsa) => {
          pendentes.push(() => armazenamento.delete(ref._caminho));
        },
        commit: async () => {
          for (const fn of pendentes) fn();
        },
      };
    },
    runTransaction: async <T>(fn: (tx: { get: (ref: RefFalsa) => Promise<unknown>; set: (ref: RefFalsa, dados: unknown) => void }) => Promise<T>) => {
      const tx = {
        get: async (ref: RefFalsa) => {
          const dados = armazenamento.get(ref._caminho);
          return { exists: dados !== undefined, data: () => dados };
        },
        set: (ref: RefFalsa, dados: unknown) => {
          armazenamento.set(ref._caminho, dados as Record<string, unknown>);
        },
      };
      return fn(tx);
    },
  };
}

vi.mock("@/lib/server/firebaseAdmin", () => ({
  firestoreAdmin: () => criarDbFalso(),
}));

vi.mock("@/lib/server/env", () => ({
  chaveAuditoria: async () => new Uint8Array(32).fill(7),
}));

function semear(caminho: string, dados: Record<string, unknown>) {
  armazenamento.set(caminho, dados);
}

describe("autorizarResetAmbienteTeste", () => {
  it("nega quando o usuário não tem workspace associado", async () => {
    const { autorizarResetAmbienteTeste } = await import("@/lib/server/testEnvironmentResetAdmin");
    const resultado = autorizarResetAmbienteTeste(null);
    expect(resultado.autorizado).toBe(false);
    expect(resultado.workspaceId).toBeNull();
  });

  it("nega quando o papel não é admin, mesmo com workspace válido", async () => {
    const { autorizarResetAmbienteTeste } = await import("@/lib/server/testEnvironmentResetAdmin");
    const resultado = autorizarResetAmbienteTeste({ workspaceId: "ws-a", papel: "operacoes" });
    expect(resultado.autorizado).toBe(false);
    expect(resultado.workspaceId).toBe("ws-a");
    expect(resultado.motivo).toMatch(/administradores/i);
  });

  it("autoriza quando o usuário é admin do seu próprio workspace", async () => {
    const { autorizarResetAmbienteTeste } = await import("@/lib/server/testEnvironmentResetAdmin");
    const resultado = autorizarResetAmbienteTeste({ workspaceId: "ws-a", papel: "admin" });
    expect(resultado.autorizado).toBe(true);
    expect(resultado.workspaceId).toBe("ws-a");
  });
});

describe("resetarAmbienteDeTeste", () => {
  beforeEach(() => {
    armazenamento.clear();

    // Workspace A: 2 conversas (uma com 2 mensagens) + 1 fluxo + 1 execução — tudo dado de teste a ser apagado.
    semear("conversations/conv-a1", { workspaceId: "ws-a", assunto: "Teste 1" });
    semear("conversations/conv-a1/mensagens/m1", { texto: "oi" });
    semear("conversations/conv-a1/mensagens/m2", { texto: "tudo bem?" });
    semear("conversations/conv-a2", { workspaceId: "ws-a", assunto: "Teste 2" });
    semear("flows/flow-a1", { workspaceId: "ws-a", nome: "Fluxo de teste" });
    semear("flowRuns/run-a1", { workspaceId: "ws-a", flowId: "flow-a1" });

    // Workspace B: dado real de outro tenant — NUNCA deve ser tocado.
    semear("conversations/conv-b1", { workspaceId: "ws-b", assunto: "Cliente real" });
    semear("conversations/conv-b1/mensagens/mb1", { texto: "mensagem real" });
    semear("flows/flow-b1", { workspaceId: "ws-b", nome: "Fluxo real" });
    semear("flowRuns/run-b1", { workspaceId: "ws-b", flowId: "flow-b1" });
  });

  it("apaga todas as conversas (e suas mensagens), fluxos e execuções do workspace alvo", async () => {
    const { resetarAmbienteDeTeste } = await import("@/lib/server/testEnvironmentResetAdmin");

    const resultado = await resetarAmbienteDeTeste("ws-a", { uid: "admin-1", email: "admin@exemplo.com" });

    expect(resultado.conversasExcluidas).toBe(2);
    expect(resultado.mensagensExcluidas).toBe(2);
    expect(resultado.fluxosExcluidos).toBe(1);
    expect(resultado.execucoesExcluidas).toBe(1);

    expect(armazenamento.has("conversations/conv-a1")).toBe(false);
    expect(armazenamento.has("conversations/conv-a1/mensagens/m1")).toBe(false);
    expect(armazenamento.has("conversations/conv-a1/mensagens/m2")).toBe(false);
    expect(armazenamento.has("conversations/conv-a2")).toBe(false);
    expect(armazenamento.has("flows/flow-a1")).toBe(false);
    expect(armazenamento.has("flowRuns/run-a1")).toBe(false);
  });

  it("isolamento multi-tenant: NÃO apaga conversas, fluxos nem execuções de outro workspace", async () => {
    const { resetarAmbienteDeTeste } = await import("@/lib/server/testEnvironmentResetAdmin");

    await resetarAmbienteDeTeste("ws-a", { uid: "admin-1", email: "admin@exemplo.com" });

    expect(armazenamento.has("conversations/conv-b1")).toBe(true);
    expect(armazenamento.has("conversations/conv-b1/mensagens/mb1")).toBe(true);
    expect(armazenamento.has("flows/flow-b1")).toBe(true);
    expect(armazenamento.has("flowRuns/run-b1")).toBe(true);
    expect(armazenamento.get("conversations/conv-b1")).toEqual({ workspaceId: "ws-b", assunto: "Cliente real" });
  });

  it("gera uma entrada de auditoria do próprio reset, com ator e contagens", async () => {
    const { resetarAmbienteDeTeste } = await import("@/lib/server/testEnvironmentResetAdmin");

    const resultado = await resetarAmbienteDeTeste("ws-a", { uid: "admin-1", email: "admin@exemplo.com" });
    const entrada: AuditEntry = resultado.entradaAuditoria;

    expect(entrada.workspaceId).toBe("ws-a");
    expect(entrada.corpo.tipo).toBe("ambiente.teste.resetado");
    expect(entrada.corpo.resultado).toBe("sucesso");
    expect(entrada.corpo.ator).toBe("admin-1");
    expect(entrada.corpo.atorEmail).toBe("admin@exemplo.com");
    expect(entrada.corpo.detalhes).toMatchObject({
      conversasExcluidas: 2,
      mensagensExcluidas: 2,
      fluxosExcluidos: 1,
      execucoesExcluidas: 1,
    });

    // A entrada foi de fato persistida na trilha (não só devolvida em memória).
    const persistida = armazenamento.get(`auditLogs/${entrada.id}`);
    expect(persistida).toEqual(entrada);
  });

  it("gera a entrada de auditoria mesmo quando não havia nada para apagar", async () => {
    armazenamento.clear();
    const { resetarAmbienteDeTeste } = await import("@/lib/server/testEnvironmentResetAdmin");

    const resultado = await resetarAmbienteDeTeste("ws-vazio", { uid: "admin-2" });

    expect(resultado.conversasExcluidas).toBe(0);
    expect(resultado.mensagensExcluidas).toBe(0);
    expect(resultado.fluxosExcluidos).toBe(0);
    expect(resultado.execucoesExcluidas).toBe(0);
    expect(resultado.entradaAuditoria.corpo.tipo).toBe("ambiente.teste.resetado");
  });
});
