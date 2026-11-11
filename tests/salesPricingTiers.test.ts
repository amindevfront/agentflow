import { describe, expect, it } from "vitest";
import { calcularRoiContrato, FAIXAS_PRECO_CONTRATO } from "@/lib/salesPricingTiers";

describe("calcularRoiContrato", () => {
  it("calcula custo total (setup + MRR × meses) e ganho total (ganho mensal × meses)", () => {
    const resultado = calcularRoiContrato({ ganhoMensalBrl: 1000, setupBrl: 2000, mrrBrl: 500, meses: 12 });
    expect(resultado.custoTotalBrl).toBe(2000 + 500 * 12);
    expect(resultado.ganhoTotalBrl).toBe(1000 * 12);
    expect(resultado.lucroLiquidoBrl).toBe(1000 * 12 - (2000 + 500 * 12));
  });

  it("ROI percentual positivo quando o ganho supera o custo", () => {
    const resultado = calcularRoiContrato({ ganhoMensalBrl: 2000, setupBrl: 2000, mrrBrl: 500, meses: 12 });
    expect(resultado.roiPercentual).not.toBeNull();
    expect(resultado.roiPercentual!).toBeGreaterThan(0);
  });

  it("ROI percentual negativo quando o ganho não cobre o custo — nunca escondido", () => {
    const resultado = calcularRoiContrato({ ganhoMensalBrl: 100, setupBrl: 10_000, mrrBrl: 5_000, meses: 12 });
    expect(resultado.roiPercentual).not.toBeNull();
    expect(resultado.roiPercentual!).toBeLessThan(0);
  });

  it("ROI nulo (não zero, não infinito) quando o custo total é zero", () => {
    const resultado = calcularRoiContrato({ ganhoMensalBrl: 1000, setupBrl: 0, mrrBrl: 0, meses: 12 });
    expect(resultado.roiPercentual).toBeNull();
  });

  it("payback: encontra o primeiro mês em que o ganho acumulado alcança o custo acumulado", () => {
    // Setup 1000, MRR 100, ganho mensal 300: mês 1 custo=1100 ganho=300 (não);
    // mês 2 custo=1200 ganho=600 (não); ... mês 5 custo=1500 ganho=1500 (sim).
    const resultado = calcularRoiContrato({ ganhoMensalBrl: 300, setupBrl: 1000, mrrBrl: 100, meses: 12 });
    expect(resultado.paybackMeses).toBe(5);
  });

  it("payback nulo quando o ganho mensal é zero ou negativo — nunca paga", () => {
    const resultado = calcularRoiContrato({ ganhoMensalBrl: 0, setupBrl: 1000, mrrBrl: 100, meses: 12 });
    expect(resultado.paybackMeses).toBeNull();
  });

  it("payback nulo quando o ganho nunca alcança o custo dentro do horizonte projetado", () => {
    const resultado = calcularRoiContrato({ ganhoMensalBrl: 50, setupBrl: 10_000, mrrBrl: 1_000, meses: 12 });
    expect(resultado.paybackMeses).toBeNull();
  });

  it("nunca produz NaN/Infinity, mesmo com entrada inválida", () => {
    const resultado = calcularRoiContrato({ ganhoMensalBrl: Number.NaN, setupBrl: -5, mrrBrl: Number.NaN, meses: 0 });
    expect(Number.isFinite(resultado.custoTotalBrl)).toBe(true);
    expect(Number.isFinite(resultado.ganhoTotalBrl)).toBe(true);
    expect(Number.isFinite(resultado.lucroLiquidoBrl)).toBe(true);
  });

  it("tabela de preços tem as 3 faixas oficiais, sem valor inventado fora do já definido", () => {
    expect(Object.keys(FAIXAS_PRECO_CONTRATO)).toEqual(["simples", "profissional", "enterprise"]);
    expect(FAIXAS_PRECO_CONTRATO.simples.setupMinBrl).toBe(1_500);
    expect(FAIXAS_PRECO_CONTRATO.profissional.mrrMaxBrl).toBe(2_997);
    expect(FAIXAS_PRECO_CONTRATO.enterprise.mrrMinBrl).toBe(4_997);
  });
});
