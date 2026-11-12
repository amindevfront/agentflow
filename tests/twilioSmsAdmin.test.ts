// Canal Global — SMS / Twilio Gateway (`@/lib/server/twilioSmsAdmin`).
//
// Cobre: (a) resolução do conector pelo número Twilio (`To`), com isolamento
// multi-tenant; (b) ingestão real cria/reencontra a conversa certa e grava a
// mensagem; (c) envio recusa sem as 3 credenciais da Twilio configuradas.
//
// Fake Firestore com suporte a subcoleção (conversations/{id}/mensagens),
// necessário para a ingestão gravar o histórico — mesmo padrão de
// `tests/testEnvironmentResetAdmin.test.ts`.

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
    // Suficiente para `executarTransacaoDeInteracao` (episodicMemory.ts), que
    // só usa `get`/`set` da transação — sem isolamento real entre leitura e
    // escrita, mas os testes aqui não exercitam concorrência nesse ponto.
    runTransaction: async <T>(fn: (tx: { get: (ref: RefFalsa) => ReturnType<RefFalsa["get"]>; set: (ref: RefFalsa, dados: Record<string, unknown>) => void }) => Promise<T>) =>
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

describe("resolverConectorPorNumeroTwilio / resolverNumeroTwilioDoWorkspace", () => {
  beforeEach(() => {
    armazenamento.clear();
    semear("connectors/conn-a1", { workspaceId: "ws-a", tipo: "SMS / Twilio Gateway", twilioPhoneNumber: "+15550001111" });
    semear("connectors/conn-b1", { workspaceId: "ws-b", tipo: "SMS / Twilio Gateway", twilioPhoneNumber: "+15559998888" });
  });

  it("resolve o workspace certo pelo número Twilio (To)", async () => {
    const { resolverConectorPorNumeroTwilio } = await import("@/lib/server/twilioSmsAdmin");
    const resultado = await resolverConectorPorNumeroTwilio("+15550001111");
    expect(resultado?.workspaceId).toBe("ws-a");
  });

  it("isolamento multi-tenant: não resolve número de outro workspace por engano", async () => {
    const { resolverConectorPorNumeroTwilio } = await import("@/lib/server/twilioSmsAdmin");
    const resultado = await resolverConectorPorNumeroTwilio("+15559998888");
    expect(resultado?.workspaceId).toBe("ws-b");
    expect(resultado?.workspaceId).not.toBe("ws-a");
  });

  it("número não cadastrado em nenhum conector devolve null — nunca grava às cegas", async () => {
    const { resolverConectorPorNumeroTwilio } = await import("@/lib/server/twilioSmsAdmin");
    expect(await resolverConectorPorNumeroTwilio("+10000000000")).toBeNull();
  });

  it("resolve o número Twilio pelo workspace (usado na rota de envio)", async () => {
    const { resolverNumeroTwilioDoWorkspace } = await import("@/lib/server/twilioSmsAdmin");
    expect(await resolverNumeroTwilioDoWorkspace("ws-a")).toBe("+15550001111");
    expect(await resolverNumeroTwilioDoWorkspace("ws-sem-conector")).toBeNull();
  });
});

describe("registrarMensagemSmsAdmin", () => {
  beforeEach(() => {
    armazenamento.clear();
  });

  it("cria uma conversa nova no primeiro contato e grava a mensagem", async () => {
    const { registrarMensagemSmsAdmin } = await import("@/lib/server/twilioSmsAdmin");
    const resultado = await registrarMensagemSmsAdmin({
      workspaceId: "ws-a",
      telefoneCliente: "+15551234567",
      texto: "Olá, preciso de ajuda",
    });

    expect(resultado.conversationId).toBeTruthy();
    const conversa = armazenamento.get(`conversations/${resultado.conversationId}`);
    expect(conversa?.workspaceId).toBe("ws-a");
    expect(conversa?.canal).toBe("sms");
    expect(conversa?.smsTelefone).toBe("+15551234567");
    expect(conversa?.totalMensagensCliente).toBe(1);

    const mensagem = armazenamento.get(`conversations/${resultado.conversationId}/mensagens/${resultado.messageId}`);
    expect(mensagem?.canal).toBe("sms");
    expect(mensagem?.remetente).toBe("cliente");
  });

  it("reencontra a MESMA conversa numa segunda mensagem do mesmo número", async () => {
    const { registrarMensagemSmsAdmin } = await import("@/lib/server/twilioSmsAdmin");
    const primeira = await registrarMensagemSmsAdmin({
      workspaceId: "ws-a",
      telefoneCliente: "+15551234567",
      texto: "Primeira mensagem",
    });
    const segunda = await registrarMensagemSmsAdmin({
      workspaceId: "ws-a",
      telefoneCliente: "+15551234567",
      texto: "Segunda mensagem",
    });

    expect(segunda.conversationId).toBe(primeira.conversationId);
    const conversa = armazenamento.get(`conversations/${primeira.conversationId}`);
    expect(conversa?.totalMensagensCliente).toBe(2);
  });

  it("isolamento multi-tenant: o mesmo número em workspaces diferentes gera conversas separadas", async () => {
    const { registrarMensagemSmsAdmin } = await import("@/lib/server/twilioSmsAdmin");
    const a = await registrarMensagemSmsAdmin({ workspaceId: "ws-a", telefoneCliente: "+15551234567", texto: "oi" });
    const b = await registrarMensagemSmsAdmin({ workspaceId: "ws-b", telefoneCliente: "+15551234567", texto: "oi" });
    expect(a.conversationId).not.toBe(b.conversationId);
  });

  it("idempotência: reenvio do MESMO MessageSid (retry de webhook) não duplica a mensagem nem o contador", async () => {
    const { registrarMensagemSmsAdmin } = await import("@/lib/server/twilioSmsAdmin");
    const entrada = {
      workspaceId: "ws-a",
      telefoneCliente: "+15551234567",
      texto: "Olá, preciso de ajuda",
      idExterno: "SM123456",
    };

    const primeira = await registrarMensagemSmsAdmin(entrada);
    const retry = await registrarMensagemSmsAdmin(entrada);

    expect(retry.conversationId).toBe(primeira.conversationId);
    expect(retry.messageId).toBe(primeira.messageId);

    const conversa = armazenamento.get(`conversations/${primeira.conversationId}`);
    expect(conversa?.totalMensagensCliente).toBe(1);
  });
});

describe("enviarMensagemSmsTwilio", () => {
  const envOriginal = { ...process.env };

  afterEach(() => {
    process.env = { ...envOriginal };
  });

  it("recusa o envio sem as credenciais da Twilio configuradas", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;

    const { enviarMensagemSmsTwilio, ErroEnvioSms } = await import("@/lib/server/twilioSmsAdmin");
    await expect(enviarMensagemSmsTwilio({ telefoneDestino: "+15551234567", texto: "oi" })).rejects.toThrow(
      ErroEnvioSms
    );
  });
});
