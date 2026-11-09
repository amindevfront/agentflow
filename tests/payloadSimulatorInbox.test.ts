import { describe, expect, it } from "vitest";
import { extrairClienteSimulado } from "@/lib/payloadSimulatorInbox";

describe("extrairClienteSimulado", () => {
  it("extrai nome e texto de chaves em português", () => {
    expect(extrairClienteSimulado({ nome: "Marina", texto: "Quero agendar uma visita." })).toEqual({
      nome: "Marina",
      texto: "Quero agendar uma visita.",
    });
  });

  it("extrai nome e texto de chaves em inglês", () => {
    expect(extrairClienteSimulado({ name: "John", message: "Looking for a quote." })).toEqual({
      nome: "John",
      texto: "Looking for a quote.",
    });
  });

  it("prioriza a primeira chave reconhecida quando mais de uma está presente", () => {
    expect(extrairClienteSimulado({ nome: "Ana", name: "Anna", texto: "Oi", message: "Hi" })).toEqual({
      nome: "Ana",
      texto: "Oi",
    });
  });

  it("ignora chaves com string vazia e cai na próxima", () => {
    expect(extrairClienteSimulado({ nome: "", name: "Carlos", texto: "  ", message: "Hello" })).toEqual({
      nome: "Carlos",
      texto: "Hello",
    });
  });

  it("nunca inventa nome/texto: sem chave reconhecida, usa rótulo genérico e o próprio JSON", () => {
    const payload = { pedido: "123", valor: 500 };
    const resultado = extrairClienteSimulado(payload);
    expect(resultado.nome).toBe("Lead simulado (Fluxos)");
    expect(resultado.texto).toBe(JSON.stringify(payload, null, 2));
  });

  it("lida com payload que não é objeto (array, string, número, null) sem lançar", () => {
    expect(extrairClienteSimulado(null).nome).toBe("Lead simulado (Fluxos)");
    expect(extrairClienteSimulado([1, 2, 3]).nome).toBe("Lead simulado (Fluxos)");
    expect(extrairClienteSimulado("texto solto").texto).toBe(JSON.stringify("texto solto", null, 2));
    expect(extrairClienteSimulado(42).texto).toBe("42");
  });
});
