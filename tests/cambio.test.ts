import { describe, expect, it } from "vitest";
import type { Shipment } from "@/types";
import { calcularExposicaoCambial } from "@/lib/cambio";

function criarCarga(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: "ship_1",
    workspaceId: "default",
    codigoRastreio: "BRX-004521",
    origem: "Shanghai",
    destino: "Itajaí",
    status: "em-transito",
    previsaoEntrega: new Date(2026, 1, 1).toISOString(),
    atualizadoEm: new Date(2026, 0, 1).toISOString(),
    criadoEm: new Date(2026, 0, 1).toISOString(),
    historico: [],
    ...overrides,
  };
}

describe("calcularExposicaoCambial", () => {
  it("devolve null sem valorFreteUsd configurado", () => {
    expect(calcularExposicaoCambial(criarCarga({ cambioContratadoBrl: 5.0 }), 5.4)).toBeNull();
  });

  it("devolve null sem cambioContratadoBrl configurado", () => {
    expect(calcularExposicaoCambial(criarCarga({ valorFreteUsd: 10_000 }), 5.4)).toBeNull();
  });

  it("devolve null quando o câmbio atual recebido é inválido", () => {
    const carga = criarCarga({ valorFreteUsd: 10_000, cambioContratadoBrl: 5.0 });
    expect(calcularExposicaoCambial(carga, 0)).toBeNull();
    expect(calcularExposicaoCambial(carga, Number.NaN)).toBeNull();
  });

  it("marca câmbio favorável quando o câmbio atual caiu desde a contratação", () => {
    const carga = criarCarga({ valorFreteUsd: 10_000, cambioContratadoBrl: 5.4 });
    const resultado = calcularExposicaoCambial(carga, 5.0);
    expect(resultado?.nivelAlerta).toBe("cambio-favoravel");
    expect(resultado?.variacaoBrl).toBeLessThan(0);
  });

  it("calcula exposição relevante acima de 5% de alta", () => {
    // 5.0 -> 5.3 = +6% de alta.
    const carga = criarCarga({ valorFreteUsd: 10_000, cambioContratadoBrl: 5.0 });
    const resultado = calcularExposicaoCambial(carga, 5.3);
    expect(resultado?.nivelAlerta).toBe("exposicao-relevante");
    expect(resultado?.custoContratadoBrl).toBe(50_000);
    expect(resultado?.custoAtualBrl).toBe(53_000);
    expect(resultado?.variacaoBrl).toBe(3_000);
  });

  it("calcula exposição crítica numa alta de câmbio equivalente a um salto pós-eleitoral (~8%)", () => {
    // 5.0 -> 5.4 = +8% de alta.
    const carga = criarCarga({ valorFreteUsd: 20_000, cambioContratadoBrl: 5.0 });
    const resultado = calcularExposicaoCambial(carga, 5.4);
    expect(resultado?.nivelAlerta).toBe("exposicao-critica");
    expect(resultado?.variacaoPercentual).toBeCloseTo(0.08, 4);
    expect(resultado?.variacaoBrl).toBe(8_000);
  });

  it("fica dentro da margem com uma alta pequena, abaixo do limiar relevante", () => {
    // 5.0 -> 5.1 = +2% de alta.
    const carga = criarCarga({ valorFreteUsd: 10_000, cambioContratadoBrl: 5.0 });
    const resultado = calcularExposicaoCambial(carga, 5.1);
    expect(resultado?.nivelAlerta).toBe("dentro-da-margem");
  });
});
