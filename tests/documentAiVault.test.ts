import { describe, expect, it } from "vitest";
import { analisarClausulasCriticas, gerarResumoExecutivoContrato } from "@/lib/documentAiVault";

describe("analisarClausulasCriticas", () => {
  it("detecta renovação automática e multa/penalidade (PT)", () => {
    const clausulas = analisarClausulasCriticas(
      "Este contrato terá renovação automática e multa de 20% em caso de rescisão."
    );
    const tipos = clausulas.map((c) => c.tipo);
    expect(tipos).toContain("renovacao-automatica");
    expect(tipos).toContain("multa-penalidade");
    expect(clausulas.every((c) => c.severidade === "alta")).toBe(true);
  });

  it("detecta não concorrência e renovação automática (EN)", () => {
    const clausulas = analisarClausulasCriticas(
      "This agreement includes a non-compete clause and automatic renewal."
    );
    const tipos = clausulas.map((c) => c.tipo);
    expect(tipos).toContain("nao-concorrencia");
    expect(tipos).toContain("renovacao-automatica");
  });

  it("detecta rescisão unilateral só quando explicitamente qualificada, nunca por 'rescisão' isolada", () => {
    expect(analisarClausulasCriticas("O contrato pode ser rescindido conforme as regras padrão.").length).toBe(0);
    expect(
      analisarClausulasCriticas("As partes concordam com a rescisão unilateral por qualquer uma delas.").some(
        (c) => c.tipo === "rescisao-unilateral"
      )
    ).toBe(true);
  });

  it("não duplica o mesmo tipo de cláusula mesmo quando dois padrões do mesmo tipo casam", () => {
    const clausulas = analisarClausulasCriticas(
      "Este acordo de confidencialidade é também um non-disclosure agreement completo."
    );
    expect(clausulas.filter((c) => c.tipo === "confidencialidade")).toHaveLength(1);
  });

  it("devolve lista vazia quando nenhuma cláusula do catálogo é encontrada (nunca inventa)", () => {
    expect(analisarClausulasCriticas("Este documento é só um informativo de boas-vindas.")).toEqual([]);
    expect(analisarClausulasCriticas("")).toEqual([]);
  });
});

describe("gerarResumoExecutivoContrato", () => {
  it("resume contagem, severidade alta e cada cláusula detectada", () => {
    const texto = "Este contrato terá renovação automática e multa de 20% em caso de rescisão.";
    const clausulas = analisarClausulasCriticas(texto);
    const resumo = gerarResumoExecutivoContrato(texto, clausulas);

    expect(resumo).toContain("2 cláusula(s) crítica(s) identificada(s)");
    expect(resumo).toContain("2 de severidade ALTA");
    expect(resumo).toContain("Renovação automática");
    expect(resumo).toContain("Multa/penalidade");
  });

  it("devolve mensagem honesta quando nenhuma cláusula crítica é identificada", () => {
    const resumo = gerarResumoExecutivoContrato("Documento informativo.", []);
    expect(resumo).toMatch(/nenhuma cláusula crítica/i);
  });

  it("devolve null apenas quando o texto está vazio — nunca por falha silenciosa", () => {
    expect(gerarResumoExecutivoContrato("", [])).toBeNull();
  });
});
