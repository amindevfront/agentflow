import { describe, expect, it } from "vitest";
import type { PedidoEcommerce } from "@/types";
import {
  PERCENTUAL_TAXA_RETIDA_PADRAO,
  TAXA_FIXA_CHARGEBACK_BRL_PADRAO,
  calcularExposicaoChargebackDevolucao,
} from "@/lib/chargebackRisk";

function criarPedido(overrides: Partial<PedidoEcommerce> = {}): PedidoEcommerce {
  return {
    id: `pedido_${Math.random()}`,
    workspaceId: "default",
    numeroPedido: "1001",
    valorBrl: 200,
    status: "pago",
    criadoEm: new Date(2026, 0, 1).toISOString(),
    ...overrides,
  };
}

describe("calcularExposicaoChargebackDevolucao", () => {
  it("devolve zeros quando não há pedidos", () => {
    const resultado = calcularExposicaoChargebackDevolucao([]);
    expect(resultado.custoTotalBrl).toBe(0);
    expect(resultado.nivelAlerta).toBe("saudavel");
  });

  it("soma produto perdido + taxa retida + taxa fixa para um chargeback", () => {
    const resultado = calcularExposicaoChargebackDevolucao([criarPedido({ status: "chargeback", valorBrl: 1000 })]);
    const taxaRetidaEsperada = 1000 * PERCENTUAL_TAXA_RETIDA_PADRAO;
    expect(resultado.custoProdutoPerdidoBrl).toBe(1000);
    expect(resultado.custoTaxasRetidasBrl).toBeCloseTo(taxaRetidaEsperada, 2);
    expect(resultado.custoTaxasFixasChargebackBrl).toBe(TAXA_FIXA_CHARGEBACK_BRL_PADRAO);
    expect(resultado.custoTotalBrl).toBeCloseTo(1000 + taxaRetidaEsperada + TAXA_FIXA_CHARGEBACK_BRL_PADRAO, 2);
  });

  it("devolução não perde o produto, mas retém a taxa de processamento e não cobra taxa fixa de disputa", () => {
    const resultado = calcularExposicaoChargebackDevolucao([criarPedido({ status: "devolvido", valorBrl: 500 })]);
    expect(resultado.custoProdutoPerdidoBrl).toBe(0);
    expect(resultado.custoTaxasRetidasBrl).toBeCloseTo(500 * PERCENTUAL_TAXA_RETIDA_PADRAO, 2);
    expect(resultado.custoTaxasFixasChargebackBrl).toBe(0);
  });

  it("nunca conta pedidos cancelados no denominador nem no custo", () => {
    const resultado = calcularExposicaoChargebackDevolucao([
      criarPedido({ status: "cancelado", valorBrl: 10_000 }),
      criarPedido({ status: "pago", valorBrl: 100 }),
    ]);
    expect(resultado.totalPedidos).toBe(2);
    expect(resultado.taxaChargebackEDevolucao).toBe(0);
    expect(resultado.custoTotalBrl).toBe(0);
  });

  it("respeita configuração customizada de percentual de taxa e taxa fixa", () => {
    const resultado = calcularExposicaoChargebackDevolucao([criarPedido({ status: "chargeback", valorBrl: 1000 })], {
      percentualTaxaRetida: 0.05,
      taxaFixaChargebackBrl: 50,
    });
    expect(resultado.custoTaxasRetidasBrl).toBe(50);
    expect(resultado.custoTaxasFixasChargebackBrl).toBe(50);
  });

  it("classifica nível crítico quando a taxa combinada ultrapassa a média documentada de incidentes (7,5%)", () => {
    const pedidos = [
      ...Array.from({ length: 92 }, () => criarPedido({ status: "entregue" })),
      ...Array.from({ length: 8 }, () => criarPedido({ status: "chargeback" })),
    ];
    const resultado = calcularExposicaoChargebackDevolucao(pedidos);
    expect(resultado.taxaChargebackEDevolucao).toBeCloseTo(0.08, 2);
    expect(resultado.nivelAlerta).toBe("critico");
  });
});
