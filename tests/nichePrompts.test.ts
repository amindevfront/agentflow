import { describe, expect, it } from "vitest";
import { NICHE_ORDER } from "@/lib/niches";
import { gerarContextoNicho, PERFIL_POR_NICHO, PERFIL_POR_NICHO_IDIOMA } from "@/lib/nichePrompts";

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

  it("advocacia/contabilidade inclui o protocolo de triagem B2B (pessoa física/jurídica, porte, objetivo)", () => {
    const contexto = gerarContextoNicho("advocacia-contabilidade") ?? "";
    expect(contexto).toContain("Protocolo de qualificação");
    expect(contexto.toLowerCase()).toContain("pessoa física ou jurídica");
    expect(contexto.toLowerCase()).toContain("porte");
    expect(contexto).toContain("reunião de diagnóstico");
  });

  it("advocacia/contabilidade inclui a restrição contra garantia de êxito/prazo/honorário sem análise técnica", () => {
    const contexto = gerarContextoNicho("advocacia-contabilidade") ?? "";
    expect(contexto).toContain("Restrição");
    expect(contexto.toLowerCase()).toContain("garanta o resultado");
    expect(contexto.toLowerCase()).toContain("prazo judicial");
    expect(contexto.toLowerCase()).toContain("honorário");
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

  // --- Guardrails multi-idioma (EN/ES) ---

  it("com idioma 'es', devolve a variante em espanhol quando ela existe (us-real-estate-luxury)", () => {
    const contexto = gerarContextoNicho("us-real-estate-luxury", "es") ?? "";
    // Palavra-chave em espanhol que não aparece na variante nativa em inglês.
    expect(contexto.toLowerCase()).toContain("comprador");
    expect(contexto).toContain("Nicho do negócio");
  });

  it("com idioma sem variante traduzida ('pt'), cai no perfil padrão (nativo em inglês) — fallback, nunca invenção", () => {
    const contextoComPt = gerarContextoNicho("us-real-estate-luxury", "pt");
    const contextoSemIdioma = gerarContextoNicho("us-real-estate-luxury");
    expect(contextoComPt).toBe(contextoSemIdioma);
    expect(contextoComPt).toContain("buyer qualification");
  });

  it("sem nenhum idioma informado, continua funcionando igual a antes (compatibilidade retroativa)", () => {
    const contexto = gerarContextoNicho("us-real-estate-luxury");
    expect(contexto).toContain("Nicho do negócio");
    expect(contexto).toContain("buyer qualification");
  });

  it("portugal-clinics-health.en substitui a menção a RGPD/Portugal por GDPR (EU) genérico", () => {
    const contexto = gerarContextoNicho("portugal-clinics-health", "en") ?? "";
    expect(contexto.toLowerCase()).toContain("gdpr");
    expect(contexto.toLowerCase()).not.toContain("rgpd");
  });

  it("advocacia-contabilidade.en/es nunca citam um artigo de lei brasileiro (OAB) — linguagem comportamental genérica", () => {
    const contextoEn = gerarContextoNicho("advocacia-contabilidade", "en") ?? "";
    const contextoEs = gerarContextoNicho("advocacia-contabilidade", "es") ?? "";
    expect(contextoEn.toLowerCase()).not.toContain("oab");
    expect(contextoEs.toLowerCase()).not.toContain("oab");
    expect(contextoEn.toLowerCase()).toContain("guarantee");
    expect(contextoEs.toLowerCase()).toContain("garantizar");
  });

  it("cada entrada de PERFIL_POR_NICHO_IDIOMA corresponde a uma chave válida de NICHE_ORDER", () => {
    for (const chave of Object.keys(PERFIL_POR_NICHO_IDIOMA)) {
      expect(NICHE_ORDER).toContain(chave);
    }
  });
});
