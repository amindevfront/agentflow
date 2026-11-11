// Ações administrativas de Equipe (Configurações → Equipe) —
// `@/lib/server/teamAdmin`.
//
// Cobre: (a) admin-only; (b) não remove a si mesmo; (c) não remove o último
// admin do workspace; (d) isolamento multi-tenant (membro/convite de outro
// workspace); (e) gera entrada de auditoria. Fake Firestore minimalista com
// suporte a `doc().get()/.delete()` (ausente no fake de
// `testEnvironmentResetAdmin.test.ts`, que só cobre `where().get()` em lote)
// e `where().get()` para a contagem de admins.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "@/types";

interface RefFalsa {
  _caminho: string;
  get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
  delete: () => Promise<void>;
}

const armazenamento = new Map<string, Record<string, unknown>>();

function refPara(caminho: string): RefFalsa {
  return {
    _caminho: caminho,
    get: async () => {
      const dados = armazenamento.get(caminho);
      return { exists: dados !== undefined, data: () => dados };
    },
    delete: async () => {
      armazenamento.delete(caminho);
    },
  };
}

/** Suporta `.where().where().get()` encadeado — cada `where` acumula mais um filtro de igualdade. */
function consultaFiltrada(nome: string, filtros: Array<[string, unknown]>) {
  return {
    where: (campo: string, _operador: string, valor: unknown) =>
      consultaFiltrada(nome, [...filtros, [campo, valor]]),
    get: async () => {
      const prefixo = `${nome}/`;
      const docs = [...armazenamento.entries()]
        .filter(
          ([chave, dados]) =>
            chave.startsWith(prefixo) &&
            !chave.slice(prefixo.length).includes("/") &&
            filtros.every(([campo, valor]) => dados[campo] === valor)
        )
        .map(([chave, dados]) => ({ id: chave.slice(prefixo.length), ref: refPara(chave), data: () => dados }));
      return { docs, size: docs.length };
    },
  };
}

function colecaoRef(nome: string) {
  return {
    doc: (id: string) => refPara(`${nome}/${id}`),
    where: (campo: string, _operador: string, valor: unknown) => consultaFiltrada(nome, [[campo, valor]]),
  };
}

function criarDbFalso() {
  return {
    collection: (nome: string) => colecaoRef(nome),
    runTransaction: async <T>(
      fn: (tx: { get: (ref: RefFalsa) => Promise<unknown>; set: (ref: RefFalsa, dados: unknown) => void }) => Promise<T>
    ) => {
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
  chaveAuditoria: async () => new Uint8Array(32).fill(9),
}));

function semear(caminho: string, dados: Record<string, unknown>) {
  armazenamento.set(caminho, dados);
}

describe("autorizarAcaoDeEquipe", () => {
  it("nega sem workspace e exige papel admin", async () => {
    const { autorizarAcaoDeEquipe } = await import("@/lib/server/teamAdmin");
    expect(autorizarAcaoDeEquipe(null).autorizado).toBe(false);
    expect(autorizarAcaoDeEquipe({ workspaceId: "ws-a", papel: "operacoes" }).autorizado).toBe(false);
    expect(autorizarAcaoDeEquipe({ workspaceId: "ws-a", papel: "admin" }).autorizado).toBe(true);
  });
});

describe("removerMembro", () => {
  beforeEach(() => {
    armazenamento.clear();
    semear("users/admin-1", { workspaceId: "ws-a", papel: "admin", email: "admin@exemplo.com" });
    semear("users/admin-2", { workspaceId: "ws-a", papel: "admin", email: "outro-admin@exemplo.com" });
    semear("users/op-1", { workspaceId: "ws-a", papel: "operacoes", email: "op@exemplo.com" });
    semear("users/op-b1", { workspaceId: "ws-b", papel: "operacoes", email: "op-b@exemplo.com" });
  });

  it("remove um membro comum do workspace certo e gera auditoria", async () => {
    const { removerMembro } = await import("@/lib/server/teamAdmin");

    const resultado = await removerMembro("ws-a", "op-1", { uid: "admin-1", email: "admin@exemplo.com" });

    expect(resultado.uidRemovido).toBe("op-1");
    expect(armazenamento.has("users/op-1")).toBe(false);

    const entrada: AuditEntry = resultado.entradaAuditoria;
    expect(entrada.workspaceId).toBe("ws-a");
    expect(entrada.corpo.tipo).toBe("equipe.membro.removido");
    expect(entrada.corpo.ator).toBe("admin-1");
  });

  it("recusa remover a si mesmo", async () => {
    const { removerMembro, ErroAcaoEquipe } = await import("@/lib/server/teamAdmin");
    await expect(removerMembro("ws-a", "admin-1", { uid: "admin-1" })).rejects.toThrow(ErroAcaoEquipe);
    expect(armazenamento.has("users/admin-1")).toBe(true);
  });

  it("recusa remover o único admin restante", async () => {
    const { removerMembro } = await import("@/lib/server/teamAdmin");
    // Remove um dos dois admins primeiro — sobra só admin-2.
    await removerMembro("ws-a", "admin-1", { uid: "admin-2" });

    // Um terceiro ator (não é o próprio admin-2) tenta remover o último admin restante.
    await expect(removerMembro("ws-a", "admin-2", { uid: "op-1" })).rejects.toThrow(/único administrador/);
    expect(armazenamento.has("users/admin-2")).toBe(true);
  });

  it("isolamento multi-tenant: não remove membro de outro workspace", async () => {
    const { removerMembro } = await import("@/lib/server/teamAdmin");
    await expect(removerMembro("ws-a", "op-b1", { uid: "admin-1" })).rejects.toThrow(/não pertence/);
    expect(armazenamento.has("users/op-b1")).toBe(true);
  });
});

describe("revogarConvite", () => {
  beforeEach(() => {
    armazenamento.clear();
    semear("invites/inv-a1", { workspaceId: "ws-a", status: "pendente", email: "convidado@exemplo.com" });
    semear("invites/inv-a2-aceito", { workspaceId: "ws-a", status: "aceito", email: "ja-entrou@exemplo.com" });
    semear("invites/inv-b1", { workspaceId: "ws-b", status: "pendente", email: "convidado-b@exemplo.com" });
  });

  it("revoga um convite pendente do workspace certo e gera auditoria", async () => {
    const { revogarConvite } = await import("@/lib/server/teamAdmin");

    const resultado = await revogarConvite("ws-a", "inv-a1", { uid: "admin-1", email: "admin@exemplo.com" });

    expect(resultado.inviteIdRevogado).toBe("inv-a1");
    expect(armazenamento.has("invites/inv-a1")).toBe(false);
    expect(resultado.entradaAuditoria.corpo.tipo).toBe("equipe.convite.revogado");
  });

  it("recusa revogar um convite já aceito", async () => {
    const { revogarConvite } = await import("@/lib/server/teamAdmin");
    await expect(revogarConvite("ws-a", "inv-a2-aceito", { uid: "admin-1" })).rejects.toThrow(/não está mais pendente/);
    expect(armazenamento.has("invites/inv-a2-aceito")).toBe(true);
  });

  it("isolamento multi-tenant: não revoga convite de outro workspace", async () => {
    const { revogarConvite } = await import("@/lib/server/teamAdmin");
    await expect(revogarConvite("ws-a", "inv-b1", { uid: "admin-1" })).rejects.toThrow(/não pertence/);
    expect(armazenamento.has("invites/inv-b1")).toBe(true);
  });
});
