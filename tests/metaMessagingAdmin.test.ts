// Canal Meta Graph API — Instagram Direct / Facebook Messenger
// (`@/lib/server/metaMessagingAdmin`).
//
// Cobre: (a) resolução do conector pelo pageId, com isolamento multi-tenant;
// (b) ingestão real cria/reencontra a conversa certa por canal — o mesmo
// senderId em canais diferentes (Instagram x Facebook) NUNCA deve colidir na
// mesma conversa; (c) envio recusa sem `META_PAGE_ACCESS_TOKEN` configurado.
//
// Fake Firestore com suporte a subcoleção (conversations/{id}/mensagens),
// mesmo padrão de `tests/twilioSmsAdmin.test.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface RefFalsa {
  _caminho: string;
  collection: (sub: string) => ReturnType<typeof colecaoRef>;
  get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
  set: (dados: Record<string, unknown>) => Promise<void>;
  update: (patch: Record<string, unknown>) => Promise<void>;
}

const armazenamento = new Map<string, Record<string, unknown>>();

function refPara(caminho: string): RefFalsa {
  return {
    _caminho: caminho,
    collection: (sub: string) => colecaoRef(`${caminho}/${sub}`),
    get: async () => {
      const dados = armazenamento.get(caminho);
      return { exists: dados !== undefined, data: () => dados };
    },
    set: async (dados: Record<string, unknown>) => {
      armazenamento.set(caminho, dados);
    },
    update: async (patch: Record<string, unknown>) => {
      const atual = armazenamento.get(caminho) ?? {};
      armazenamento.set(caminho, { ...atual, ...patch });
    },
  };
}

function filhosDiretos(prefixo: string): Array<[string, Record<string, unknown>]> {
  return [...armazenamento.entries()].filter(
    ([chave]) => chave.startsWith(`${prefixo}/`) && !chave.slice(prefixo.length + 1).includes("/")
  );
}

function consultaFiltrada(prefixo: string, filtros: Array<[string, unknown]>) {
  return {
    where: (campo: string, _op: string, valor: unknown) => consultaFiltrada(prefixo, [...filtros, [campo, valor]]),
    orderBy: () => consultaFiltrada(prefixo, filtros),
    limit: () => consultaFiltrada(prefixo, filtros),
    get: async () => {
      const docs = filhosDiretos(prefixo)
        .filter(([, dados]) => filtros.every(([campo, valor]) => dados[campo] === valor))
        .map(([chave, dados]) => ({ id: chave.slice(prefixo.length + 1), ref: refPara(chave), data: () => dados }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  };
}

function colecaoRef(prefixo: string) {
  return {
    doc: (id: string) => refPara(`${prefixo}/${id}`),
    where: (campo: string, _op: string, valor: unknown) => consultaFiltrada(prefixo, [[campo, valor]]),
  };
}

function criarDbFalso() {
  return { collection: (nome: string) => colecaoRef(nome) };
}

vi.mock("@/lib/server/firebaseAdmin", () => ({
  firestoreAdmin: () => criarDbFalso(),
}));

function semear(caminho: string, dados: Record<string, unknown>) {
  armazenamento.set(caminho, dados);
}

describe("resolverConectorPorPageId / resolverPageIdDoWorkspace", () => {
  beforeEach(() => {
    armazenamento.clear();
    semear("connectors/conn-ig-a", {
      workspaceId: "ws-a",
      tipo: "Instagram Direct (Meta Graph API)",
      metaPageId: "pageid-111",
    });
    semear("connectors/conn-fb-b", {
      workspaceId: "ws-b",
      tipo: "Facebook Messenger (Meta Graph API)",
      metaPageId: "pageid-222",
    });
  });

  it("resolve o workspace certo pelo pageId do Instagram", async () => {
    const { resolverConectorPorPageId } = await import("@/lib/server/metaMessagingAdmin");
    const resultado = await resolverConectorPorPageId("pageid-111", "instagram");
    expect(resultado?.workspaceId).toBe("ws-a");
  });

  it("isolamento multi-tenant: não resolve pageId de outro workspace por engano", async () => {
    const { resolverConectorPorPageId } = await import("@/lib/server/metaMessagingAdmin");
    const resultado = await resolverConectorPorPageId("pageid-222", "facebook");
    expect(resultado?.workspaceId).toBe("ws-b");
    expect(resultado?.workspaceId).not.toBe("ws-a");
  });

  it("mesmo pageId cadastrado só para um canal não resolve no outro", async () => {
    const { resolverConectorPorPageId } = await import("@/lib/server/metaMessagingAdmin");
    expect(await resolverConectorPorPageId("pageid-111", "facebook")).toBeNull();
  });

  it("pageId não cadastrado em nenhum conector devolve null — nunca grava às cegas", async () => {
    const { resolverConectorPorPageId } = await import("@/lib/server/metaMessagingAdmin");
    expect(await resolverConectorPorPageId("pageid-inexistente", "instagram")).toBeNull();
  });

  it("resolve o pageId pelo workspace e canal (usado na rota de envio)", async () => {
    const { resolverPageIdDoWorkspace } = await import("@/lib/server/metaMessagingAdmin");
    expect(await resolverPageIdDoWorkspace("ws-a", "instagram")).toBe("pageid-111");
    expect(await resolverPageIdDoWorkspace("ws-b", "facebook")).toBe("pageid-222");
    expect(await resolverPageIdDoWorkspace("ws-sem-conector", "instagram")).toBeNull();
  });
});

describe("registrarMensagemMetaAdmin", () => {
  beforeEach(() => {
    armazenamento.clear();
  });

  it("cria uma conversa nova no primeiro contato e grava a mensagem (instagram)", async () => {
    const { registrarMensagemMetaAdmin } = await import("@/lib/server/metaMessagingAdmin");
    const resultado = await registrarMensagemMetaAdmin({
      workspaceId: "ws-a",
      canal: "instagram",
      remetenteId: "sender-123",
      texto: "Olá, preciso de ajuda",
    });

    expect(resultado.conversationId).toBeTruthy();
    const conversa = armazenamento.get(`conversations/${resultado.conversationId}`);
    expect(conversa?.workspaceId).toBe("ws-a");
    expect(conversa?.canal).toBe("instagram");
    expect(conversa?.metaSenderId).toBe("sender-123");
    expect(conversa?.totalMensagensCliente).toBe(1);

    const mensagem = armazenamento.get(`conversations/${resultado.conversationId}/mensagens/${resultado.messageId}`);
    expect(mensagem?.canal).toBe("instagram");
    expect(mensagem?.remetente).toBe("cliente");
  });

  it("reencontra a MESMA conversa numa segunda mensagem do mesmo sender id e canal", async () => {
    const { registrarMensagemMetaAdmin } = await import("@/lib/server/metaMessagingAdmin");
    const primeira = await registrarMensagemMetaAdmin({
      workspaceId: "ws-a",
      canal: "facebook",
      remetenteId: "sender-123",
      texto: "Primeira mensagem",
    });
    const segunda = await registrarMensagemMetaAdmin({
      workspaceId: "ws-a",
      canal: "facebook",
      remetenteId: "sender-123",
      texto: "Segunda mensagem",
    });

    expect(segunda.conversationId).toBe(primeira.conversationId);
    const conversa = armazenamento.get(`conversations/${primeira.conversationId}`);
    expect(conversa?.totalMensagensCliente).toBe(2);
  });

  it("o MESMO sender id em canais diferentes (instagram x facebook) NUNCA colide na mesma conversa", async () => {
    const { registrarMensagemMetaAdmin } = await import("@/lib/server/metaMessagingAdmin");
    const viaInstagram = await registrarMensagemMetaAdmin({
      workspaceId: "ws-a",
      canal: "instagram",
      remetenteId: "sender-999",
      texto: "oi pelo instagram",
    });
    const viaFacebook = await registrarMensagemMetaAdmin({
      workspaceId: "ws-a",
      canal: "facebook",
      remetenteId: "sender-999",
      texto: "oi pelo facebook",
    });

    expect(viaInstagram.conversationId).not.toBe(viaFacebook.conversationId);
  });

  it("isolamento multi-tenant: o mesmo sender id em workspaces diferentes gera conversas separadas", async () => {
    const { registrarMensagemMetaAdmin } = await import("@/lib/server/metaMessagingAdmin");
    const a = await registrarMensagemMetaAdmin({ workspaceId: "ws-a", canal: "instagram", remetenteId: "sender-1", texto: "oi" });
    const b = await registrarMensagemMetaAdmin({ workspaceId: "ws-b", canal: "instagram", remetenteId: "sender-1", texto: "oi" });
    expect(a.conversationId).not.toBe(b.conversationId);
  });
});

describe("enviarMensagemMetaMessaging", () => {
  const envOriginal = { ...process.env };

  afterEach(() => {
    process.env = { ...envOriginal };
  });

  it("recusa o envio sem META_PAGE_ACCESS_TOKEN configurado", async () => {
    delete process.env.META_PAGE_ACCESS_TOKEN;

    const { enviarMensagemMetaMessaging, ErroEnvioMetaMessaging } = await import("@/lib/server/metaMessagingAdmin");
    await expect(
      enviarMensagemMetaMessaging({ metaPageId: "pageid-111", destinatarioId: "sender-123", texto: "oi" })
    ).rejects.toThrow(ErroEnvioMetaMessaging);
  });
});
