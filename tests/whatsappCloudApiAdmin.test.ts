// Canal WhatsApp Business (Cloud API) (`@/lib/server/whatsappCloudApiAdmin`).
//
// Cobre: (a) resolução do conector pelo `phone_number_id`, com isolamento
// multi-tenant; (b) ingestão real cria/reencontra a conversa certa e grava a
// mensagem; (c) idempotência por `idExterno` (id da mensagem no WhatsApp
// Cloud API) — um retry do mesmo webhook nunca duplica; (d) envio recusa sem
// `WHATSAPP_ACCESS_TOKEN` configurado.
//
// Este módulo é o canal mais antigo/mais usado do projeto e, até este
// arquivo, não tinha NENHUM teste unitário dedicado — lacuna real de
// cobertura, mesmo com `channelAdapters.test.ts`/`circuitBreakerSla.test.ts`
// citando "whatsapp" apenas de passagem. Mesmo padrão de fake Firestore de
// `tests/telegramBotAdmin.test.ts`/`tests/twilioSmsAdmin.test.ts`.

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
  return {
    collection: (nome: string) => colecaoRef(nome),
    // Suficiente para `executarTransacaoDeInteracao` (episodicMemory.ts) e
    // para `ingerirMensagemWhatsappTx`, que só usam `get`/`set` da transação.
    runTransaction: async <T>(
      fn: (tx: {
        get: (ref: RefFalsa) => ReturnType<RefFalsa["get"]>;
        set: (ref: RefFalsa, dados: Record<string, unknown>) => void;
      }) => Promise<T>
    ) =>
      fn({
        get: (ref) => ref.get(),
        set: (ref, dados) => {
          armazenamento.set(ref._caminho, dados);
        },
      }),
  };
}

vi.mock("@/lib/server/firebaseAdmin", () => ({
  firestoreAdmin: () => criarDbFalso(),
}));

function semear(caminho: string, dados: Record<string, unknown>) {
  armazenamento.set(caminho, dados);
}

describe("resolverConectorPorPhoneNumberId / resolverPhoneNumberIdDoWorkspace", () => {
  beforeEach(() => {
    armazenamento.clear();
    semear("connectors/conn-wa-a", {
      workspaceId: "ws-a",
      tipo: "WhatsApp Business (Cloud API)",
      metaPhoneNumberId: "phone-111",
    });
    semear("connectors/conn-wa-b", {
      workspaceId: "ws-b",
      tipo: "WhatsApp Business (Cloud API)",
      metaPhoneNumberId: "phone-222",
    });
  });

  it("resolve o workspace certo pelo phone_number_id", async () => {
    const { resolverConectorPorPhoneNumberId } = await import("@/lib/server/whatsappCloudApiAdmin");
    const resultado = await resolverConectorPorPhoneNumberId("phone-111");
    expect(resultado?.workspaceId).toBe("ws-a");
  });

  it("isolamento multi-tenant: não resolve phone_number_id de outro workspace por engano", async () => {
    const { resolverConectorPorPhoneNumberId } = await import("@/lib/server/whatsappCloudApiAdmin");
    const resultado = await resolverConectorPorPhoneNumberId("phone-222");
    expect(resultado?.workspaceId).toBe("ws-b");
    expect(resultado?.workspaceId).not.toBe("ws-a");
  });

  it("phone_number_id não cadastrado em nenhum conector devolve null — nunca grava às cegas", async () => {
    const { resolverConectorPorPhoneNumberId } = await import("@/lib/server/whatsappCloudApiAdmin");
    expect(await resolverConectorPorPhoneNumberId("phone-inexistente")).toBeNull();
  });

  it("resolve o phone_number_id pelo workspace (usado na rota de envio)", async () => {
    const { resolverPhoneNumberIdDoWorkspace } = await import("@/lib/server/whatsappCloudApiAdmin");
    expect(await resolverPhoneNumberIdDoWorkspace("ws-a")).toBe("phone-111");
    expect(await resolverPhoneNumberIdDoWorkspace("ws-sem-conector")).toBeNull();
  });
});

describe("registrarMensagemWhatsappAdmin", () => {
  beforeEach(() => {
    armazenamento.clear();
  });

  it("cria uma conversa nova no primeiro contato e grava a mensagem", async () => {
    const { registrarMensagemWhatsappAdmin } = await import("@/lib/server/whatsappCloudApiAdmin");
    const resultado = await registrarMensagemWhatsappAdmin({
      workspaceId: "ws-a",
      telefoneCliente: "+15551234567",
      nomeCliente: "Fulano",
      texto: "Olá, preciso de ajuda",
    });

    expect(resultado.conversationId).toBeTruthy();
    const conversa = armazenamento.get(`conversations/${resultado.conversationId}`);
    expect(conversa?.workspaceId).toBe("ws-a");
    expect(conversa?.canal).toBe("whatsapp");
    expect(conversa?.whatsappTelefone).toBe("+15551234567");
    expect(conversa?.totalMensagensCliente).toBe(1);
  });

  it("reencontra a MESMA conversa numa segunda mensagem do mesmo número", async () => {
    const { registrarMensagemWhatsappAdmin } = await import("@/lib/server/whatsappCloudApiAdmin");
    const primeira = await registrarMensagemWhatsappAdmin({
      workspaceId: "ws-a",
      telefoneCliente: "+15551234567",
      nomeCliente: "Fulano",
      texto: "Primeira mensagem",
    });
    const segunda = await registrarMensagemWhatsappAdmin({
      workspaceId: "ws-a",
      telefoneCliente: "+15551234567",
      nomeCliente: "Fulano",
      texto: "Segunda mensagem",
    });

    expect(segunda.conversationId).toBe(primeira.conversationId);
    const conversa = armazenamento.get(`conversations/${primeira.conversationId}`);
    expect(conversa?.totalMensagensCliente).toBe(2);
  });

  it("isolamento multi-tenant: o mesmo número em workspaces diferentes gera conversas separadas", async () => {
    const { registrarMensagemWhatsappAdmin } = await import("@/lib/server/whatsappCloudApiAdmin");
    const a = await registrarMensagemWhatsappAdmin({
      workspaceId: "ws-a",
      telefoneCliente: "+15551234567",
      nomeCliente: "A",
      texto: "oi",
    });
    const b = await registrarMensagemWhatsappAdmin({
      workspaceId: "ws-b",
      telefoneCliente: "+15551234567",
      nomeCliente: "B",
      texto: "oi",
    });
    expect(a.conversationId).not.toBe(b.conversationId);
  });

  it("idempotência: reenvio do MESMO id de mensagem (retry de webhook) não duplica a mensagem nem o contador", async () => {
    const { registrarMensagemWhatsappAdmin } = await import("@/lib/server/whatsappCloudApiAdmin");
    const entrada = {
      workspaceId: "ws-a",
      telefoneCliente: "+15551234567",
      nomeCliente: "Fulano",
      texto: "Olá, preciso de ajuda",
      idExterno: "wamid.ABC123",
    };

    const primeira = await registrarMensagemWhatsappAdmin(entrada);
    const retry = await registrarMensagemWhatsappAdmin(entrada);

    expect(retry.conversationId).toBe(primeira.conversationId);
    expect(retry.messageId).toBe(primeira.messageId);

    const conversa = armazenamento.get(`conversations/${primeira.conversationId}`);
    expect(conversa?.totalMensagensCliente).toBe(1);

    const mensagens = [...armazenamento.keys()].filter((chave) =>
      chave.startsWith(`conversations/${primeira.conversationId}/mensagens/`)
    );
    expect(mensagens).toHaveLength(1);
  });
});

describe("enviarMensagemWhatsappCloudApi", () => {
  const ambienteOriginal = process.env.WHATSAPP_ACCESS_TOKEN;

  afterEach(() => {
    if (ambienteOriginal === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN;
    else process.env.WHATSAPP_ACCESS_TOKEN = ambienteOriginal;
    vi.unstubAllGlobals();
  });

  it("recusa o envio sem WHATSAPP_ACCESS_TOKEN configurado", async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    const { enviarMensagemWhatsappCloudApi, ErroEnvioWhatsapp } = await import("@/lib/server/whatsappCloudApiAdmin");
    await expect(
      enviarMensagemWhatsappCloudApi({ metaPhoneNumberId: "phone-111", telefoneDestino: "+15551234567", texto: "oi" })
    ).rejects.toThrow(ErroEnvioWhatsapp);
  });
});
