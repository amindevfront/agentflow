import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  gerarWidgetEmbedSnippet,
  normalizarMensagemTwilioSms,
  normalizarMensagemWidget,
} from "@/lib/inbox/channelAdapters";
import { validarAssinaturaTwilio } from "@/lib/inbox/twilioSignature";

describe("normalizarMensagemTwilioSms", () => {
  it("normaliza um payload válido de SMS", () => {
    const resultado = normalizarMensagemTwilioSms({
      From: "+15551234567",
      To: "+15559876543",
      Body: "Olá, quero saber o status do meu pedido.",
      MessageSid: "SM123",
    });

    expect(resultado).toEqual({
      canal: "sms",
      identificadorRemetente: "+15551234567",
      texto: "Olá, quero saber o status do meu pedido.",
      idExterno: "SM123",
    });
  });

  it("lança quando o remetente (From) está ausente", () => {
    expect(() => normalizarMensagemTwilioSms({ Body: "Oi" })).toThrow(/From/);
  });

  it("lança quando o corpo (Body) está ausente ou vazio", () => {
    expect(() => normalizarMensagemTwilioSms({ From: "+15551234567", Body: "" })).toThrow(/Body/);
    expect(() => normalizarMensagemTwilioSms({ From: "+15551234567" })).toThrow(/Body/);
  });
});

describe("validarAssinaturaTwilio", () => {
  const URL = "https://app.agentflow.com/api/inbox/webhook/twilio";
  const AUTH_TOKEN = "auth-token-de-teste";
  const PARAMETROS = { From: "+15551234567", To: "+15559876543", Body: "Oi" };

  /** Mesmo algoritmo documentado pela Twilio, computado de forma independente neste teste. */
  function assinar(url: string, parametros: Record<string, string>, token: string): string {
    const chavesOrdenadas = Object.keys(parametros).sort();
    const dados = url + chavesOrdenadas.map((chave) => `${chave}${parametros[chave]}`).join("");
    return createHmac("sha1", token).update(dados, "utf8").digest("base64");
  }

  it("aceita uma assinatura correta", () => {
    const assinatura = assinar(URL, PARAMETROS, AUTH_TOKEN);
    expect(validarAssinaturaTwilio(URL, PARAMETROS, AUTH_TOKEN, assinatura)).toBe(true);
  });

  it("rejeita uma assinatura de outro Auth Token", () => {
    const assinatura = assinar(URL, PARAMETROS, "outro-token");
    expect(validarAssinaturaTwilio(URL, PARAMETROS, AUTH_TOKEN, assinatura)).toBe(false);
  });

  it("rejeita quando um parâmetro foi adulterado após a assinatura", () => {
    const assinatura = assinar(URL, PARAMETROS, AUTH_TOKEN);
    const adulterado = { ...PARAMETROS, Body: "mensagem trocada" };
    expect(validarAssinaturaTwilio(URL, adulterado, AUTH_TOKEN, assinatura)).toBe(false);
  });

  it("é insensível à ordem de inserção dos parâmetros (ordena por chave)", () => {
    const parametrosForaDeOrdem = { Body: "Oi", From: "+15551234567", To: "+15559876543" };
    const assinatura = assinar(URL, PARAMETROS, AUTH_TOKEN);
    expect(validarAssinaturaTwilio(URL, parametrosForaDeOrdem, AUTH_TOKEN, assinatura)).toBe(true);
  });

  it("rejeita uma assinatura com tamanho diferente, sem lançar", () => {
    expect(validarAssinaturaTwilio(URL, PARAMETROS, AUTH_TOKEN, "curta")).toBe(false);
  });
});

describe("normalizarMensagemWidget", () => {
  it("normaliza um payload válido do Web Widget", () => {
    const resultado = normalizarMensagemWidget({
      workspaceId: "ws-1",
      visitorId: "visitor-abc",
      texto: "Quero saber mais sobre o plano enterprise.",
    });

    expect(resultado).toEqual({
      canal: "webchat",
      identificadorRemetente: "visitor-abc",
      texto: "Quero saber mais sobre o plano enterprise.",
    });
  });

  it("lança quando workspaceId, visitorId ou texto estão ausentes ou com tipo errado", () => {
    expect(() => normalizarMensagemWidget({ visitorId: "v1", texto: "oi" })).toThrow(/workspaceId/);
    expect(() => normalizarMensagemWidget({ workspaceId: "ws-1", texto: "oi" })).toThrow(/visitorId/);
    expect(() => normalizarMensagemWidget({ workspaceId: "ws-1", visitorId: "v1", texto: 123 })).toThrow(/texto/);
  });
});

describe("gerarWidgetEmbedSnippet", () => {
  it("gera um snippet apontando para o host e o workspace corretos", () => {
    const snippet = gerarWidgetEmbedSnippet({ workspaceId: "ws-1", baseUrl: "https://app.agentflow.com" });

    expect(snippet).toContain("https://app.agentflow.com/widget.js");
    expect(snippet).toContain('data-workspace-id="ws-1"');
    expect(snippet).toContain("<script");
  });

  it("usa a origem permitida informada, ou um placeholder claro quando omitida", () => {
    const comOrigem = gerarWidgetEmbedSnippet({
      workspaceId: "ws-1",
      baseUrl: "https://app.agentflow.com",
      origemPermitida: "https://clienteglobal.com",
    });
    expect(comOrigem).toContain('data-allowed-origin="https://clienteglobal.com"');

    const semOrigem = gerarWidgetEmbedSnippet({ workspaceId: "ws-1", baseUrl: "https://app.agentflow.com" });
    expect(semOrigem).toContain("data-allowed-origin=");
  });
});
