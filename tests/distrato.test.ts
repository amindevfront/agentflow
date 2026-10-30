import { describe, expect, it } from "vitest";
import type { ContratoImobiliario, StatusContratoImobiliario } from "@/types";
import {
  calcularExposicaoFinanceiraDistrato,
  PERCENTUAL_RETENCAO_PADRAO,
  PERCENTUAL_RETENCAO_PATRIMONIO_AFETACAO,
  PROXIMO_STATUS_DISTRATO,
} from "@/lib/distrato";

const AGORA = new Date(2026, 0, 10, 12, 0, 0);

function diasAtras(dias: number): string {
  return new Date(AGORA.getTime() - dias * 24 * 60 * 60 * 1000).toISOString();
}

function diasAFrente(dias: number): string {
  return new Date(AGORA.getTime() + dias * 24 * 60 * 60 * 1000).toISOString();
}

function criarContrato(overrides: Partial<ContratoImobiliario> = {}): ContratoImobiliario {
  return {
    id: "contrato_1",
    workspaceId: "default",
    conversationId: "conv_1",
    compradorNome: "Maria Souza",
    unidade: "Apto 1102 - Torre A",
    valorContratoBrl: 2_000_000,
    valorPagoBrl: 400_000,
    dataPrevistaEntrega: diasAFrente(60),
    dataEntregaRealizadaEm: null,
    toleranciaAtrasoDias: 180,
    patrimonioDeAfetacao: false,
    status: "ativo",
    distratoSolicitadoEm: null,
    criadoEm: AGORA.toISOString(),
    criadoPor: "uid_1",
    ...overrides,
  };
}

describe("calcularExposicaoFinanceiraDistrato", () => {
  it("dentro do prazo, sem patrimônio de afetação: retenção padrão de 25%", () => {
    const resultado = calcularExposicaoFinanceiraDistrato(criarContrato(), AGORA);
    expect(resultado.culpaConstrutora).toBe(false);
    expect(resultado.nivelAlerta).toBe("dentro-do-prazo");
    expect(resultado.percentualRetencao).toBe(PERCENTUAL_RETENCAO_PADRAO);
    expect(resultado.valorRetidoBrl).toBe(100_000);
    expect(resultado.valorAReembolsarBrl).toBe(300_000);
  });

  it("dentro do prazo, com patrimônio de afetação: retenção de 50%", () => {
    const resultado = calcularExposicaoFinanceiraDistrato(
      criarContrato({ patrimonioDeAfetacao: true }),
      AGORA
    );
    expect(resultado.percentualRetencao).toBe(PERCENTUAL_RETENCAO_PATRIMONIO_AFETACAO);
    expect(resultado.valorRetidoBrl).toBe(200_000);
    expect(resultado.valorAReembolsarBrl).toBe(200_000);
  });

  it("alerta 'tolerância próxima do limite' quando restam poucos dias dentro da tolerância", () => {
    // Previsão há 165 dias, tolerância de 180 dias → restam 15 dias.
    const resultado = calcularExposicaoFinanceiraDistrato(
      criarContrato({ dataPrevistaEntrega: diasAtras(165), toleranciaAtrasoDias: 180 }),
      AGORA
    );
    expect(resultado.nivelAlerta).toBe("tolerancia-proxima-do-limite");
    expect(resultado.culpaConstrutora).toBe(false);
    expect(resultado.diasRestantesTolerancia).toBe(15);
  });

  it("culpa da construtora configurada quando o atraso supera a tolerância — reembolso de 100%, sem retenção", () => {
    // Previsão há 200 dias, tolerância de 180 dias → 20 dias além da tolerância.
    const resultado = calcularExposicaoFinanceiraDistrato(
      criarContrato({ dataPrevistaEntrega: diasAtras(200), toleranciaAtrasoDias: 180, valorPagoBrl: 500_000 }),
      AGORA
    );
    expect(resultado.culpaConstrutora).toBe(true);
    expect(resultado.nivelAlerta).toBe("culpa-construtora-configurada");
    expect(resultado.diasAtrasoAlemTolerancia).toBe(20);
    expect(resultado.percentualRetencao).toBe(0);
    expect(resultado.valorRetidoBrl).toBe(0);
    expect(resultado.valorAReembolsarBrl).toBe(500_000);
  });

  it("congela o cálculo no instante da entrega — entrega dentro da tolerância não configura culpa mesmo que a verificação ocorra muito depois", () => {
    const contrato = criarContrato({
      dataPrevistaEntrega: diasAtras(200),
      toleranciaAtrasoDias: 180,
      // Entregue 10 dias depois da previsão — dentro da tolerância de 180.
      dataEntregaRealizadaEm: diasAtras(190),
    });
    const resultado = calcularExposicaoFinanceiraDistrato(contrato, AGORA);
    expect(resultado.culpaConstrutora).toBe(false);
    expect(resultado.nivelAlerta).toBe("dentro-do-prazo");
  });

  it("congela o cálculo no instante da entrega — entrega além da tolerância mantém a culpa registrada para sempre", () => {
    const contrato = criarContrato({
      dataPrevistaEntrega: diasAtras(400),
      toleranciaAtrasoDias: 180,
      // Entregue 220 dias depois da previsão — 40 dias além da tolerância de 180.
      dataEntregaRealizadaEm: diasAtras(180),
    });
    const resultado = calcularExposicaoFinanceiraDistrato(contrato, new Date(AGORA.getTime() + 365 * 86_400_000));
    expect(resultado.culpaConstrutora).toBe(true);
    expect(resultado.diasAtrasoAlemTolerancia).toBe(40);
  });

  it("status diferente de 'ativo' sempre reporta 'distrato-em-andamento', mesmo dentro do prazo", () => {
    const resultado = calcularExposicaoFinanceiraDistrato(
      criarContrato({ status: "distrato-solicitado" }),
      AGORA
    );
    expect(resultado.nivelAlerta).toBe("distrato-em-andamento");
  });

  it("mantém os valores financeiros corretos mesmo com distrato em andamento, para o operador saber quanto devolver", () => {
    const resultado = calcularExposicaoFinanceiraDistrato(
      criarContrato({ status: "distrato-formalizado", valorPagoBrl: 300_000 }),
      AGORA
    );
    expect(resultado.valorRetidoBrl).toBe(75_000);
    expect(resultado.valorAReembolsarBrl).toBe(225_000);
  });
});

describe("PROXIMO_STATUS_DISTRATO", () => {
  it.each([
    ["ativo", "distrato-solicitado"],
    ["distrato-solicitado", "distrato-formalizado"],
    ["distrato-formalizado", null],
  ] as Array<[StatusContratoImobiliario, StatusContratoImobiliario | null]>)(
    "transição de '%s' é '%s'",
    (atual, esperado) => {
      expect(PROXIMO_STATUS_DISTRATO[atual]).toBe(esperado);
    }
  );
});
