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

  it("construtora/imobiliária inclui o protocolo de qualificação estruturada (orçamento em faixa, metragem, prazo)", () => {
    const contexto = gerarContextoNicho("construtora-imobiliaria");
    expect(contexto).toContain("Protocolo de qualificação");
    expect(contexto).toContain("faixa de orçamento");
    expect(contexto).toContain("metragem");
    expect(contexto).toContain("prazo");
    // Defesa em profundidade: nunca repetir/pedir um valor exato em R$.
    expect(contexto).toContain("nunca");
  });

  it("construtora/imobiliária inclui a restrição comercial contra preço/desconto não autorizado", () => {
    const contexto = gerarContextoNicho("construtora-imobiliaria") ?? "";
    expect(contexto).toContain("Restrição");
    expect(contexto).toContain("diretoria");
    expect(contexto.toLowerCase()).toContain("desconto");
  });

  it("clínica de alto padrão inclui o protocolo de acolhimento 24/7 (queixa principal, objetivo do paciente)", () => {
    const contexto = gerarContextoNicho("clinica-alto-padrao") ?? "";
    expect(contexto).toContain("Protocolo de qualificação");
    expect(contexto).toContain("queixa principal");
    expect(contexto).toContain("objetivo do paciente");
    expect(contexto).toContain("avaliação presencial");
  });

  it("clínica de alto padrão inclui a restrição contra diagnóstico/promessa de resultado sem avaliação presencial", () => {
    const contexto = gerarContextoNicho("clinica-alto-padrao") ?? "";
    expect(contexto).toContain("Restrição");
    expect(contexto.toLowerCase()).toContain("diagnóstico");
    expect(contexto.toLowerCase()).toContain("resultado estético");
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
