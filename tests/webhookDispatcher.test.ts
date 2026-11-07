import { describe, expect, it } from "vitest";
import {
  HEADER_ASSINATURA_CONNECT_HUB,
  assinarPayloadConnectHub,
  despacharPayloadConnectHub,
  mascararDadosSaida,
  montarPayloadConnectHub,
  type ExecutorEnvioWebhook,
} from "@/lib/server/connectors/webhookDispatcher";
import { hmacSha256Hex } from "@/lib/crypto/digest";
import { textoParaBytes } from "@/lib/crypto/encoding";
import { jsonCanonico } from "@/lib/crypto/canonical";

describe("mascararDadosSaida (Blindagem de PII na Saída)", () => {
  it("mascara CPF, e-mail e telefone em campos de texto livre", () => {
    const saida = mascararDadosSaida({
      observacao: "Cliente com CPF 529.982.247-25 confirmou o e-mail cliente@exemplo.com.",
    });
    expect(JSON.stringify(saida)).not.toContain("529.982.247-25");
    expect(JSON.stringify(saida)).not.toContain("cliente@exemplo.com");
    expect(JSON.stringify(saida)).toContain("[[PII:CPF:1]]");
  });

  it("mascara recursivamente em estruturas aninhadas (objetos e arrays)", () => {
    const saida = mascararDadosSaida({
      ticket: {
        payloadMascarado: "ok",
        contatos: ["joao@exemplo.com", "Telefone: (11) 98888-7777"],
      },
    });
    const texto = JSON.stringify(saida);
    expect(texto).not.toContain("joao@exemplo.com");
    expect(texto).not.toContain("98888-7777");
  });

  it("mascara por nome de campo sensível mesmo sem padrão reconhecível (ex.: senha)", () => {
    const saida = mascararDadosSaida({ senha: "minhaSenhaSecreta123" }) as Record<string, unknown>;
    expect(saida.senha).not.toBe("minhaSenhaSecreta123");
  });

  it("preserva texto sem PII inalterado", () => {
    const saida = mascararDadosSaida({ status: "ticket resolvido pelo operador" });
    expect(saida).toEqual({ status: "ticket resolvido pelo operador" });
  });
});

describe("montarPayloadConnectHub", () => {
  const AGORA = new Date("2026-03-15T12:00:00.000Z");

  it("monta o envelope com dados já mascarados", () => {
    const payload = montarPayloadConnectHub({
      evento: "handoff.sucesso",
      workspaceId: "ws-1",
      traceId: "gr_teste",
      dados: { cpf: "529.982.247-25" },
      agora: AGORA,
    });

    expect(payload.evento).toBe("handoff.sucesso");
    expect(payload.workspaceId).toBe("ws-1");
    expect(payload.traceId).toBe("gr_teste");
    expect(payload.ocorridoEm).toBe(AGORA.toISOString());
    expect(JSON.stringify(payload.dados)).not.toContain("529.982.247-25");
  });

  it("nunca lança mesmo com dados vazios", () => {
    expect(() => montarPayloadConnectHub({ evento: "agendamento.validado", workspaceId: "ws-1", dados: {} })).not.toThrow();
  });
});

describe("assinarPayloadConnectHub", () => {
  it("produz uma assinatura HMAC-SHA-256 determinística e verificável", async () => {
    const payload = montarPayloadConnectHub({
      evento: "handoff.sucesso",
      workspaceId: "ws-1",
      dados: { ticketId: "hitl_1" },
      agora: new Date("2026-03-15T12:00:00.000Z"),
    });

    const { corpoJson, assinatura } = await assinarPayloadConnectHub(payload, "segredo-do-cliente");
    const esperada = await hmacSha256Hex(textoParaBytes("segredo-do-cliente"), jsonCanonico(payload));

    expect(assinatura).toBe(esperada);
    expect(corpoJson).toBe(jsonCanonico(payload));
  });

  it("segredos diferentes produzem assinaturas diferentes para o mesmo payload", async () => {
    const payload = montarPayloadConnectHub({ evento: "handoff.sucesso", workspaceId: "ws-1", dados: {} });

    const { assinatura: a1 } = await assinarPayloadConnectHub(payload, "segredo-a");
    const { assinatura: a2 } = await assinarPayloadConnectHub(payload, "segredo-b");

    expect(a1).not.toBe(a2);
  });

  it("payloads diferentes produzem assinaturas diferentes para o mesmo segredo", async () => {
    const payloadA = montarPayloadConnectHub({ evento: "handoff.sucesso", workspaceId: "ws-1", dados: { a: 1 } });
    const payloadB = montarPayloadConnectHub({ evento: "handoff.sucesso", workspaceId: "ws-1", dados: { a: 2 } });

    const { assinatura: a1 } = await assinarPayloadConnectHub(payloadA, "mesmo-segredo");
    const { assinatura: a2 } = await assinarPayloadConnectHub(payloadB, "mesmo-segredo");

    expect(a1).not.toBe(a2);
  });
});

describe("despacharPayloadConnectHub", () => {
  const payload = montarPayloadConnectHub({
    evento: "agendamento.validado",
    workspaceId: "ws-1",
    dados: { resumo: "ok" },
  });

  it("devolve entregue: true quando o executor confirma sucesso, e repassa a assinatura correta", async () => {
    let urlRecebida = "";
    let assinaturaRecebida = "";
    const executor: ExecutorEnvioWebhook = async (url, _corpo, assinatura) => {
      urlRecebida = url;
      assinaturaRecebida = assinatura;
      return { ok: true, status: 200 };
    };

    const resultado = await despacharPayloadConnectHub({
      payload,
      webhookUrl: "https://cliente.exemplo.com/webhook",
      segredoWebhook: "segredo-123",
      executor,
    });

    expect(resultado.entregue).toBe(true);
    expect(resultado.statusHttp).toBe(200);
    expect(urlRecebida).toBe("https://cliente.exemplo.com/webhook");
    expect(assinaturaRecebida).toBe(resultado.assinatura);
  });

  it("devolve entregue: false quando o executor reporta falha HTTP", async () => {
    const executor: ExecutorEnvioWebhook = async () => ({ ok: false, status: 500 });

    const resultado = await despacharPayloadConnectHub({
      payload,
      webhookUrl: "https://cliente.exemplo.com/webhook",
      segredoWebhook: "segredo-123",
      executor,
    });

    expect(resultado.entregue).toBe(false);
    expect(resultado.statusHttp).toBe(500);
  });

  it("propaga exceção do executor (ex.: falha de rede) para o chamador decidir", async () => {
    const executor: ExecutorEnvioWebhook = async () => {
      throw new Error("ECONNREFUSED");
    };

    await expect(
      despacharPayloadConnectHub({
        payload,
        webhookUrl: "https://cliente.exemplo.com/webhook",
        segredoWebhook: "segredo-123",
        executor,
      })
    ).rejects.toThrow("ECONNREFUSED");
  });
});

describe("HEADER_ASSINATURA_CONNECT_HUB", () => {
  it("é um nome de header HTTP válido, em minúsculas", () => {
    expect(HEADER_ASSINATURA_CONNECT_HUB).toBe("x-agentflow-signature");
  });
});
