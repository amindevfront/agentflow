import { describe, expect, it } from "vitest";
import { interceptarMensagem, processarMensagemEntrante } from "@/lib/guardrails/piiVault";

describe("interceptarMensagem", () => {
  it("mascara CPF antes de qualquer persistência", () => {
    const resultado = interceptarMensagem("Meu CPF é 529.982.247-25, pode confirmar meu cadastro?");
    expect(resultado.textoMascarado).not.toContain("529.982.247-25");
    expect(resultado.temPii).toBe(true);
    expect(resultado.piiDetectada).toContain("cpf");
  });

  it("mascara telefone e e-mail na mesma mensagem", () => {
    const resultado = interceptarMensagem("Me liga no (11) 98765-4321 ou manda e-mail para ana@exemplo.com");
    expect(resultado.textoMascarado).not.toContain("98765-4321");
    expect(resultado.textoMascarado).not.toContain("ana@exemplo.com");
    expect(resultado.piiDetectada).toContain("telefone");
    expect(resultado.piiDetectada).toContain("email");
  });

  it("não acusa PII em mensagem neutra", () => {
    const resultado = interceptarMensagem("Qual o horário de atendimento de vocês?");
    expect(resultado.temPii).toBe(false);
    expect(resultado.piiDetectada).toEqual([]);
    expect(resultado.textoMascarado).toBe("Qual o horário de atendimento de vocês?");
  });

  it("mascara credencial embutida na mensagem", () => {
    const resultado = interceptarMensagem("Segue minha chave: sk-ant-abcdefghijklmnopqrstuvwxyz0123, usem com cuidado.");
    expect(resultado.temPii).toBe(true);
    expect(resultado.piiDetectada).toContain("segredo-api");
    expect(resultado.textoMascarado).not.toContain("abcdefghijklmnop");
  });

  it("lida com texto vazio sem lançar", () => {
    expect(() => interceptarMensagem("")).not.toThrow();
    expect(interceptarMensagem("").textoMascarado).toBe("");
  });

  it("nunca deixa um cofre de tradução vivo após a chamada (não serializável)", () => {
    // Garantia indireta: se o cofre interno não fosse descartado, importar o
    // módulo repetidamente com entradas diferentes não afetaria isolamento —
    // aqui confirmamos que duas chamadas sucessivas não compartilham estado
    // (o mesmo CPF em chamadas distintas recebe o mesmo índice de placeholder,
    // prova de que cada chamada parte de um cofre novo, não acumulado).
    const primeira = interceptarMensagem("CPF 529.982.247-25");
    const segunda = interceptarMensagem("CPF 529.982.247-25 de novo");
    expect(primeira.textoMascarado).toContain("[[PII:CPF:1]]");
    expect(segunda.textoMascarado).toContain("[[PII:CPF:1]]");
  });
});

describe("processarMensagemEntrante", () => {
  it("retorna sem selar quando a mensagem não tem PII (nenhuma chamada de rede)", async () => {
    const resultado = await processarMensagemEntrante({
      texto: "Qual o status do meu pedido?",
      conversationId: "conv-1",
      messageId: "msg-1",
      workspaceId: "ws-1",
      idToken: "token-fake",
    });

    expect(resultado.temVersaoOriginalSelada).toBe(false);
    expect(resultado.envelope).toBeNull();
    expect(resultado.textoMascarado).toBe("Qual o status do meu pedido?");
  });

  it("degrada graciosamente quando o selo falha, mantendo a mensagem mascarada", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("rede indisponível");
    }) as typeof fetch;

    try {
      const resultado = await processarMensagemEntrante({
        texto: "Meu CPF é 529.982.247-25",
        conversationId: "conv-1",
        messageId: "msg-1",
        workspaceId: "ws-1",
        idToken: "token-fake",
      });

      expect(resultado.temVersaoOriginalSelada).toBe(false);
      expect(resultado.envelope).toBeNull();
      expect(resultado.textoMascarado).not.toContain("529.982.247-25");
    } finally {
      globalThis.fetch = original;
    }
  });
});
