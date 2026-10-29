import { describe, expect, it } from "vitest";
import type { RoiSnapshot } from "@/types";
import { simularContingenciaMacro } from "@/lib/contingencia";

function snapshot(overrides: Partial<RoiSnapshot> = {}): RoiSnapshot {
  return {
    execucoesTotais: 100,
    execucoesConcluidas: 95,
    execucoesFalhas: 5,
    execucoesEmAndamento: 0,
    execucoesComIntervencao: 10,
    horasEconomizadasBrutas: 50,
    horasGastasEmRevisao: 5,
    horasEconomizadasLiquidas: 45,
    custoHumanoEvitadoBrl: 6000,
    custoIaBrl: 200,
    custoRevisaoHumanaBrl: 300,
    custoPlataformaBrl: 500,
    economiaLiquidaBrl: 5000,
    reducaoOpexPercentual: 0.83,
    custoPorExecucaoBrl: 10,
    roiPercentual: 5,
    salarioBaseEvitadoBrl: 3000,
    encargosInssBrl: 600,
    encargosFgtsBrl: 240,
    encargosDecimoTerceiroBrl: 250,
    encargosFeriasBrl: 333,
    encargosProvisaoRescisaoBrl: 96,
    encargosTotaisBrl: 1519,
    salarioBaseEvitadoPayrollBrl: 4000,
    encargosFicaBrl: 300,
    encargosFutaSutaBrl: 120,
    encargosWorkersCompBrl: 60,
    encargosBeneficiosBrl: 480,
    encargosBpoOverheadBrl: 320,
    encargosTotaisPayrollBrl: 1280,
    taxaZeroTouch: 0.9,
    taxaSucesso: 0.95,
    tokensEntrada: 10000,
    tokensSaida: 5000,
    tokensTotais: 15000,
    execucoesSemTelemetria: 0,
    cobertura: 1,
    conversasTotais: 20,
    conversasResolvidas: 18,
    conversasComFrustracaoCritica: 1,
    mensagensProcessadas: 60,
    campanhasExecutadas: 2,
    enviosCampanhaRealizados: 40,
    enviosCampanhaBloqueados: 2,
    periodo: { inicio: "2026-03-01T00:00:00.000Z", fim: "2026-03-31T23:59:59.999Z", rotulo: "março de 2026" },
    moeda: "BRL",
    atualizadoEm: "2026-03-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("simularContingenciaMacro", () => {
  it("projeta linearmente o custo de inércia, o ganho líquido e as horas, pelo horizonte escolhido", () => {
    const resultado = simularContingenciaMacro({
      snapshot: snapshot({ custoHumanoEvitadoBrl: 6000, economiaLiquidaBrl: 5000, horasEconomizadasBrutas: 50 }),
      horizonteMeses: 12,
    });

    expect(resultado.horizonteMeses).toBe(12);
    expect(resultado.custoInerciaProjetadoBrl).toBe(72000); // 6000 * 12
    expect(resultado.ganhoLiquidoProjetadoBrl).toBe(60000); // 5000 * 12
    expect(resultado.horasInerciaProjetadas).toBe(600); // 50 * 12
  });

  it("escala corretamente para horizontes menores (3 e 6 meses)", () => {
    const base = snapshot({ custoHumanoEvitadoBrl: 1000, economiaLiquidaBrl: 800, horasEconomizadasBrutas: 10 });

    const tres = simularContingenciaMacro({ snapshot: base, horizonteMeses: 3 });
    const seis = simularContingenciaMacro({ snapshot: base, horizonteMeses: 6 });

    expect(tres.custoInerciaProjetadoBrl).toBe(3000);
    expect(seis.custoInerciaProjetadoBrl).toBe(6000);
    expect(seis.custoInerciaProjetadoBrl).toBe(tres.custoInerciaProjetadoBrl * 2);
  });

  it("propaga um ganho líquido negativo sem inventar um piso em zero", () => {
    const resultado = simularContingenciaMacro({
      snapshot: snapshot({ economiaLiquidaBrl: -200 }),
      horizonteMeses: 6,
    });
    expect(resultado.ganhoLiquidoProjetadoBrl).toBe(-1200);
  });

  it("nunca inventa uma curva de crescimento — a projeção é estritamente linear", () => {
    const base = snapshot({ custoHumanoEvitadoBrl: 1000 });
    const doze = simularContingenciaMacro({ snapshot: base, horizonteMeses: 12 });
    const seis = simularContingenciaMacro({ snapshot: base, horizonteMeses: 6 });
    expect(doze.custoInerciaProjetadoBrl).toBe(seis.custoInerciaProjetadoBrl * 2);
  });
});
