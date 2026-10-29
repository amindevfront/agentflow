import { describe, expect, it } from "vitest";
import { NICHE_ORDER } from "@/lib/niches";
import { gerarContextoNicho, PERFIL_POR_NICHO } from "@/lib/nichePrompts";

describe("gerarContextoNicho", () => {
  it("devolve null quando o nicho é ausente", () => {
    expect(gerarContextoNicho(undefined)).toBeNull();
    expect(gerarContextoNicho(null)).toBeNull();
  });

  it("devolve null para um nicho sem perfil definido (nunca um texto genérico inventado)", () => {
    expect(gerarContextoNicho("outros")).toBeNull();
  });

  it("gera o contexto de salão de beleza com foco em agendamento rápido", () => {
    const contexto = gerarContextoNicho("salao-beleza");
    expect(contexto).toContain("agendamento");
    expect(contexto).toContain("Nicho do negócio");
  });

  it("gera o contexto de clínica de alto padrão com foco em qualificação", () => {
    const contexto = gerarContextoNicho("clinica-alto-padrao");
    expect(contexto).toContain("qualificação");
  });

  it("gera o contexto de construtora/imobiliária com direcionamento ao corretor", () => {
    const contexto = gerarContextoNicho("construtora-imobiliaria");
    expect(contexto).toContain("corretor");
  });

  it("gera o contexto de clínica médica/exames com foco em confirmação e no-show", () => {
    const contexto = gerarContextoNicho("clinica-medica-exames");
    expect(contexto).toContain("confirma");
    expect(contexto).toContain("no-show");
  });

  it("cada entrada de PERFIL_POR_NICHO corresponde a uma chave válida de NICHE_ORDER", () => {
    for (const chave of Object.keys(PERFIL_POR_NICHO)) {
      expect(NICHE_ORDER).toContain(chave);
    }
  });
});
