import { describe, expect, it } from "vitest";
import { detectarLeadAltoPadrao } from "@/lib/inbox/highEndLead";

describe("detectarLeadAltoPadrao", () => {
  it("não qualifica mensagem neutra", () => {
    const resultado = detectarLeadAltoPadrao(["Olá, gostaria de saber mais sobre o empreendimento."]);
    expect(resultado.qualificado).toBe(false);
    expect(resultado.sinaisCapacidade).toEqual([]);
    expect(resultado.sinaisUrgencia).toEqual([]);
  });

  it("não qualifica só com capacidade, sem urgência", () => {
    const resultado = detectarLeadAltoPadrao(["Posso pagar à vista, sem financiamento."]);
    expect(resultado.sinaisCapacidade.length).toBeGreaterThan(0);
    expect(resultado.sinaisUrgencia).toEqual([]);
    expect(resultado.qualificado).toBe(false);
  });

  it("não qualifica só com urgência, sem capacidade", () => {
    const resultado = detectarLeadAltoPadrao(["É urgente, preciso decidir essa semana."]);
    expect(resultado.sinaisUrgencia.length).toBeGreaterThan(0);
    expect(resultado.sinaisCapacidade).toEqual([]);
    expect(resultado.qualificado).toBe(false);
  });

  it("qualifica quando capacidade E urgência aparecem, mesmo em mensagens separadas", () => {
    const resultado = detectarLeadAltoPadrao([
      "Tenho o valor todo disponível, posso pagar à vista.",
      "É urgente, preciso fechar essa semana por causa de uma mudança urgente.",
    ]);
    expect(resultado.qualificado).toBe(true);
    expect(resultado.sinaisCapacidade.length).toBeGreaterThan(0);
    expect(resultado.sinaisUrgencia.length).toBeGreaterThan(0);
  });

  it("qualifica quando ambos os sinais aparecem na mesma mensagem", () => {
    const resultado = detectarLeadAltoPadrao(["Posso pagar à vista e quero fechar hoje mesmo."]);
    expect(resultado.qualificado).toBe(true);
  });

  it("ignora mensagens vazias ou não-string sem lançar", () => {
    const resultado = detectarLeadAltoPadrao(["", "   ", "Posso pagar à vista.", "Quero fechar agora."]);
    expect(resultado.qualificado).toBe(true);
  });

  it("não deduplica incorretamente: dois sinais distintos de capacidade contam como dois", () => {
    const resultado = detectarLeadAltoPadrao(["Posso pagar à vista, sem financiamento, e quero fechar hoje."]);
    expect(resultado.sinaisCapacidade.length).toBeGreaterThanOrEqual(2);
  });

  it("é determinístico: mesma entrada produz sempre o mesmo resultado", () => {
    const mensagens = ["Tenho capital disponível e preciso de uma mudança urgente."];
    expect(detectarLeadAltoPadrao(mensagens)).toEqual(detectarLeadAltoPadrao(mensagens));
  });

  it("lista vazia nunca qualifica", () => {
    expect(detectarLeadAltoPadrao([]).qualificado).toBe(false);
  });
});
