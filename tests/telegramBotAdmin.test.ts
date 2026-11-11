// Canal Telegram Bot API (`@/lib/server/telegramBotAdmin`).
//
// Cobre: (a) ingestão real cria/reencontra a conversa certa por chatId, com
// isolamento multi-tenant; (b) `resolverConectorTelegram`/
// `obterTokenTelegram` resolvem o conector certo, recusam workspaceId que
// não bate e credencial revogada.
//
// `abrirCredencial` (decifragem real do envelope) já tem cobertura própria
// em outro lugar do projeto (ver `grep -rl "abrirSegredo" tests/` →
// `tests/governance.test.ts`) — aqui mockamos `@/lib/server/vault` para
// devolver um token fixo de teste, e focamos no roteamento/validação de
// workspace e status, não na criptografia.
//
// Fake Firestore com suporte a subcoleção (conversations/{id}/mensagens),
// mesmo padrão de `tests/twilioSmsAdmin.test.ts`.

import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/server/vault", () => ({
  abrirCredencial: vi.fn(async () => "token-fixo-de-teste-123"),
}));

function semear(caminho: string, dados: Record<string, unknown>) {
  armazenamento.set(caminho, dados);
}

describe("resolverConectorTelegram / resolverConectorTelegramDoWorkspace", () => {
  beforeEach(() => {
    armazenamento.clear();
    semear("connectors/conn-tg-a", {
      workspaceId: "ws-a",
      tipo: "Telegram Bot API",
      telegramBotTokenCredentialId: "cred-a1",
      telegramWebhookSecret: "segredo-webhook-a",
    });
  });

  it("resolve o conector certo pelo id (URL do webhook)", async () => {
    const { resolverConectorTelegram } = await import("@/lib/server/telegramBotAdmin");
    const resultado = await resolverConectorTelegram("conn-tg-a");
    expect(resultado?.workspaceId).toBe("ws-a");
    expect(resultado?.credentialId).toBe("cred-a1");
    expect(resultado?.webhookSecret).toBe("segredo-webhook-a");
  });

  it("conector inexistente devolve null", async () => {
    const { resolverConectorTelegram } = await import("@/lib/server/telegramBotAdmin");
    expect(await resolverConectorTelegram("conn-inexistente")).toBeNull();
  });

  it("conector de outro tipo (não Telegram) devolve null", async () => {
    semear("connectors/conn-outro-tipo", { workspaceId: "ws-a", tipo: "SMS / Twilio Gateway" });
    const { resolverConectorTelegram } = await import("@/lib/server/telegramBotAdmin");
    expect(await resolverConectorTelegram("conn-outro-tipo")).toBeNull();
  });

  it("resolve o conector do workspace (usado na rota de envio)", async () => {
    const { resolverConectorTelegramDoWorkspace } = await import("@/lib/server/telegramBotAdmin");
    const resultado = await resolverConectorTelegramDoWorkspace("ws-a");
    expect(resultado?.connectorId).toBe("conn-tg-a");
    expect(resultado?.credentialId).toBe("cred-a1");
    expect(await resolverConectorTelegramDoWorkspace("ws-sem-conector")).toBeNull();
  });
});

describe("registrarMensagemTelegramAdmin", () => {
  beforeEach(() => {
    armazenamento.clear();
  });

  it("cria uma conversa nova no primeiro contato e grava a mensagem", async () => {
    const { registrarMensagemTelegramAdmin } = await import("@/lib/server/telegramBotAdmin");
    const resultado = await registrarMensagemTelegramAdmin({
      workspaceId: "ws-a",
      chatId: "123456789",
      remetenteNome: "Fulano",
      texto: "Olá, preciso de ajuda",
    });

    expect(resultado.conversationId).toBeTruthy();
    const conversa = armazenamento.get(`conversations/${resultado.conversationId}`);
    expect(conversa?.workspaceId).toBe("ws-a");
    expect(conversa?.canal).toBe("telegram");
    expect(conversa?.telegramChatId).toBe("123456789");
    expect(conversa?.totalMensagensCliente).toBe(1);

    const mensagem = armazenamento.get(`conversations/${resultado.conversationId}/mensagens/${resultado.messageId}`);
    expect(mensagem?.canal).toBe("telegram");
    expect(mensagem?.remetente).toBe("cliente");
  });

  it("reencontra a MESMA conversa numa segunda mensagem do mesmo chatId", async () => {
    const { registrarMensagemTelegramAdmin } = await import("@/lib/server/telegramBotAdmin");
    const primeira = await registrarMensagemTelegramAdmin({
      workspaceId: "ws-a",
      chatId: "123456789",
      remetenteNome: "Fulano",
      texto: "Primeira mensagem",
    });
    const segunda = await registrarMensagemTelegramAdmin({
      workspaceId: "ws-a",
      chatId: "123456789",
      remetenteNome: "Fulano",
      texto: "Segunda mensagem",
    });

    expect(segunda.conversationId).toBe(primeira.conversationId);
    const conversa = armazenamento.get(`conversations/${primeira.conversationId}`);
    expect(conversa?.totalMensagensCliente).toBe(2);
  });

  it("isolamento multi-tenant: o mesmo chatId em workspaces diferentes gera conversas separadas", async () => {
    const { registrarMensagemTelegramAdmin } = await import("@/lib/server/telegramBotAdmin");
    const a = await registrarMensagemTelegramAdmin({ workspaceId: "ws-a", chatId: "111", remetenteNome: "A", texto: "oi" });
    const b = await registrarMensagemTelegramAdmin({ workspaceId: "ws-b", chatId: "111", remetenteNome: "B", texto: "oi" });
    expect(a.conversationId).not.toBe(b.conversationId);
  });
});

describe("obterTokenTelegram", () => {
  beforeEach(() => {
    armazenamento.clear();
    semear("credentials/cred-a1", {
      workspaceId: "ws-a",
      status: "ativa",
      versao: 1,
      tipo: "bearer-token",
    });
    semear("credentialSecrets/cred-a1__v1", {
      credentialId: "cred-a1",
      workspaceId: "ws-a",
      versao: 1,
      envelope: { algoritmo: "AES-256-GCM" },
    });
  });

  it("decifra o token quando a credencial é ativa e do workspace certo", async () => {
    const { obterTokenTelegram } = await import("@/lib/server/telegramBotAdmin");
    const token = await obterTokenTelegram("cred-a1", "ws-a");
    expect(token).toBe("token-fixo-de-teste-123");
  });

  it("recusa quando a credencial pertence a outro workspace", async () => {
    const { obterTokenTelegram } = await import("@/lib/server/telegramBotAdmin");
    await expect(obterTokenTelegram("cred-a1", "ws-b")).rejects.toThrow(/outro workspace/i);
  });

  it("recusa quando a credencial está revogada", async () => {
    semear("credentials/cred-a1", { workspaceId: "ws-a", status: "revogada", versao: 1, tipo: "bearer-token" });
    const { obterTokenTelegram } = await import("@/lib/server/telegramBotAdmin");
    await expect(obterTokenTelegram("cred-a1", "ws-a")).rejects.toThrow(/revogada/i);
  });

  it("recusa quando a credencial não existe", async () => {
    const { obterTokenTelegram } = await import("@/lib/server/telegramBotAdmin");
    await expect(obterTokenTelegram("cred-inexistente", "ws-a")).rejects.toThrow(/não encontrada/i);
  });
});
