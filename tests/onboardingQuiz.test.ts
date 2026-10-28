import { describe, expect, it } from "vitest";
import {
  PAIN_POINT_ORDER,
  PAIN_POINT_PRESETS,
  REGIAO_ORDER,
  REGIAO_PRESETS,
  derivarAjustesDoQuiz,
} from "@/lib/onboardingQuiz";
import { NICHE_PRESETS } from "@/lib/niches";

const REFERENCIA = new Date("2026-03-15T12:00:00.000Z");

describe("PAIN_POINT_PRESETS", () => {
  it("tem uma entrada para cada chave em PAIN_POINT_ORDER, sem duplicatas", () => {
    expect(new Set(PAIN_POINT_ORDER).size).toBe(PAIN_POINT_ORDER.length);
    for (const key of PAIN_POINT_ORDER) {
      expect(PAIN_POINT_PRESETS[key]).toBeDefined();
      expect(PAIN_POINT_PRESETS[key].key).toBe(key);
    }
  });

  it("todo preset tem label e descrição não vazios", () => {
    for (const key of PAIN_POINT_ORDER) {
      const preset = PAIN_POINT_PRESETS[key];
      expect(preset.label.trim().length).toBeGreaterThan(0);
      expect(preset.descricao.trim().length).toBeGreaterThan(0);
    }
  });

  it("eleva a severidade média a transbordo para o ralo de passivo trabalhista", () => {
    const overrides = PAIN_POINT_PRESETS["passivo-clt-overtime"].guardrailOverrides;
    expect(overrides.acaoPorSeveridade?.media).toBe("transbordo");
    expect(overrides.acaoPorSeveridade?.critica).toBe("bloqueado");
  });

  it("zera o limiar de valor sensível e bloqueia PII na saída para vazamento de PII", () => {
    const overrides = PAIN_POINT_PRESETS["vazamento-pii"].guardrailOverrides;
    expect(overrides.limiarValorSensivel).toBe(0);
    expect(overrides.bloquearPiiNaSaida).toBe(true);
  });

  it("não aplica nenhum ajuste de guardrail para ralos sem módulo dedicado ('outro')", () => {
    expect(PAIN_POINT_PRESETS.outro.guardrailOverrides).toEqual({});
  });
});

describe("REGIAO_PRESETS", () => {
  it("tem uma entrada para cada chave em REGIAO_ORDER", () => {
    for (const key of REGIAO_ORDER) {
      expect(REGIAO_PRESETS[key]).toBeDefined();
      expect(REGIAO_PRESETS[key].key).toBe(key);
    }
  });

  it("Brasil usa Real e regime CLT; Global usa Dólar e regime Payroll", () => {
    expect(REGIAO_PRESETS.br.moedaPadrao).toBe("BRL");
    expect(REGIAO_PRESETS.br.regimeEncargosPadrao).toBe("clt-br");
    expect(REGIAO_PRESETS.global.moedaPadrao).toBe("USD");
    expect(REGIAO_PRESETS.global.regimeEncargosPadrao).toBe("payroll-us-uk");
  });
});

describe("derivarAjustesDoQuiz", () => {
  it("deriva playbooks sugeridos a partir do nicho (reaproveita NICHE_PRESETS)", () => {
    const ajustes = derivarAjustesDoQuiz(
      { setor: "clinica-alto-padrao", ralogDeCaixa: "outro", regiaoOperacao: "br" },
      REFERENCIA
    );
    expect(ajustes.workspacePatch.setor).toBe("clinica-alto-padrao");
    expect(ajustes.workspacePatch.playbooksSugeridos).toEqual(
      NICHE_PRESETS["clinica-alto-padrao"].playbooksSugeridos
    );
  });

  it("região Brasil deriva moeda BRL e regime CLT no patch do RoiConfig", () => {
    const ajustes = derivarAjustesDoQuiz(
      { setor: "ecommerce", ralogDeCaixa: "outro", regiaoOperacao: "br" },
      REFERENCIA
    );
    expect(ajustes.roiConfigPatch).toEqual({ moedaExibicao: "BRL", regimeEncargos: "clt-br" });
  });

  it("região Global deriva moeda USD e regime Payroll no patch do RoiConfig", () => {
    const ajustes = derivarAjustesDoQuiz(
      { setor: "servicos-luxo", ralogDeCaixa: "outro", regiaoOperacao: "global" },
      REFERENCIA
    );
    expect(ajustes.roiConfigPatch).toEqual({ moedaExibicao: "USD", regimeEncargos: "payroll-us-uk" });
  });

  it("propaga os guardrailOverrides do ralo de caixa escolhido", () => {
    const ajustes = derivarAjustesDoQuiz(
      { setor: "outros", ralogDeCaixa: "vazamento-pii", regiaoOperacao: "br" },
      REFERENCIA
    );
    expect(ajustes.workspacePatch.guardrailOverrides).toEqual(
      PAIN_POINT_PRESETS["vazamento-pii"].guardrailOverrides
    );
  });

  it("registra quizRespondidoEm com o instante injetado (determinístico)", () => {
    const ajustes = derivarAjustesDoQuiz(
      { setor: "outros", ralogDeCaixa: "outro", regiaoOperacao: "br" },
      REFERENCIA
    );
    expect(ajustes.workspacePatch.quizRespondidoEm).toBe(REFERENCIA.toISOString());
  });

  it("é determinístico: mesma entrada produz sempre a mesma derivação", () => {
    const entrada = { setor: "logistica-portuaria" as const, ralogDeCaixa: "no-show-agendamento" as const, regiaoOperacao: "global" as const };
    expect(derivarAjustesDoQuiz(entrada, REFERENCIA)).toEqual(derivarAjustesDoQuiz(entrada, REFERENCIA));
  });

  it("preserva o ralo de caixa e a região escolhidos no patch do workspace", () => {
    const ajustes = derivarAjustesDoQuiz(
      { setor: "construtora-imobiliaria", ralogDeCaixa: "passivo-clt-overtime", regiaoOperacao: "global" },
      REFERENCIA
    );
    expect(ajustes.workspacePatch.ralogDeCaixa).toBe("passivo-clt-overtime");
    expect(ajustes.workspacePatch.regiaoOperacao).toBe("global");
  });
});
