import { describe, expect, it } from "vitest";
import type { Transaction } from "firebase-admin/firestore";
import type { AuditEntry, AuditEventBody } from "@/types";
import { executarTransacaoDeSelo } from "@/lib/server/auditChainStore";
import { verificarCadeiaAuditoria } from "@/lib/crypto/auditChain";

const CHAVE_HMAC = new Uint8Array(32).fill(9);

function corpo(parcial: Partial<AuditEventBody> = {}): AuditEventBody {
  return {
    tipo: "guardrail.entrada.mascarada",
    resultado: "sucesso",
    workspaceId: "default",
    ator: "uid-1",
    recurso: "flows/flow-1",
    detalhes: {},
    ocorridoEm: "2026-03-15T12:00:00.000Z",
    ...parcial,
  };
}

/**
 * Firestore falso mínimo: só o que `executarTransacaoDeSelo` de fato usa —
 * `db.collection(nome).doc(id)` devolvendo uma referência opaca, e
 * `tx.get`/`tx.set` operando sobre um Map indexado pela identidade da
 * referência. Suficiente para provar a lógica da transação sem depender de
 * Firestore real nem do emulador (que não está disponível neste ambiente —
 * ver observação no corpo da auditoria desta tarefa).
 */
function criarFirestoreFalso() {
  const armazenamento = new Map<string, unknown>();

  const db = {
    collection: (nomeColecao: string) => ({
      doc: (id: string) => ({ _chave: `${nomeColecao}/${id}` }),
    }),
  };

  // O tipo real de `Transaction.get` é sobrecarregado (também aceita
  // `Query`), o que nenhum dublê de teste satisfaz estruturalmente — o cast
  // é para a forma reduzida que `executarTransacaoDeSelo` de fato usa.
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

describe("executarTransacaoDeSelo", () => {
  it("inicia a cadeia do workspace do zero na primeira chamada", async () => {
    const { db, tx } = criarFirestoreFalso();

    const entrada = await executarTransacaoDeSelo(tx, db as never, "default", corpo(), CHAVE_HMAC);

    expect(entrada.seq).toBe(1);
    expect(entrada.prevHash).toBe("");
  });

  it("avança o ponteiro e encadeia corretamente entre chamadas sucessivas", async () => {
    const { db, tx } = criarFirestoreFalso();

    const primeira = await executarTransacaoDeSelo(tx, db as never, "default", corpo(), CHAVE_HMAC);
    const segunda = await executarTransacaoDeSelo(
      tx,
      db as never,
      "default",
      corpo({ recurso: "flows/flow-2" }),
      CHAVE_HMAC
    );
    const terceira = await executarTransacaoDeSelo(
      tx,
      db as never,
      "default",
      corpo({ recurso: "flows/flow-3" }),
      CHAVE_HMAC
    );

    expect(segunda.seq).toBe(2);
    expect(segunda.prevHash).toBe(primeira.chainHash);
    expect(terceira.seq).toBe(3);
    expect(terceira.prevHash).toBe(segunda.chainHash);

    const verificacao = await verificarCadeiaAuditoria([primeira, segunda, terceira], CHAVE_HMAC);
    expect(verificacao.integra).toBe(true);
    expect(verificacao.assinaturasVerificadas).toBe(true);
  });

  it("mantém cadeias de workspaces diferentes totalmente independentes", async () => {
    const { db, tx } = criarFirestoreFalso();

    const a1 = await executarTransacaoDeSelo(tx, db as never, "workspace-a", corpo({ workspaceId: "workspace-a" }), CHAVE_HMAC);
    const b1 = await executarTransacaoDeSelo(tx, db as never, "workspace-b", corpo({ workspaceId: "workspace-b" }), CHAVE_HMAC);
    const a2 = await executarTransacaoDeSelo(tx, db as never, "workspace-a", corpo({ workspaceId: "workspace-a" }), CHAVE_HMAC);

    expect(a1.seq).toBe(1);
    expect(b1.seq).toBe(1); // ponteiro de B não foi afetado por A
    expect(a2.seq).toBe(2);
    expect(a2.prevHash).toBe(a1.chainHash);
  });

  it("persiste a entrada e o ponteiro no mesmo documento em chamadas subsequentes", async () => {
    const { db, tx, armazenamento } = criarFirestoreFalso();

    const entrada = await executarTransacaoDeSelo(tx, db as never, "default", corpo(), CHAVE_HMAC);

    const entradaPersistida = armazenamento.get(`auditLogs/${entrada.id}`) as AuditEntry;
    expect(entradaPersistida).toEqual(entrada);

    const ponteiro = armazenamento.get("auditChainHead/default") as { seq: number; chainHash: string };
    expect(ponteiro.seq).toBe(entrada.seq);
    expect(ponteiro.chainHash).toBe(entrada.chainHash);
  });
});
