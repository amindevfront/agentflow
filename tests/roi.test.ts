import { describe, expect, it } from "vitest";
import type { FlowRun, HandoffTicket, RoiConfig } from "@/types";
import {
  ROI_CONFIG_PADRAO,
  calcularRoi,
  estimarCustoModeloUsd,
  formatarHoras,
  formatarPercentual,
  formatarTokens,
  normalizarRoiConfig,
  periodoMesAtual,
  periodoUltimosDias,
} from "@/lib/roi";

const REFERENCIA = new Date("2026-03-15T12:00:00.000Z");
const PERIODO = periodoUltimosDias(30, REFERENCIA);

const CONFIG: RoiConfig = {
  ...ROI_CONFIG_PADRAO,
  custoHoraOperadorBrl: 60,
  minutosManuaisPorExecucao: 30,
  minutosRevisaoHumana: 10,
  cambioUsdBrl: 5,
  custoPlataformaMensalBrl: 0,
};

function execucao(parcial: Partial<FlowRun> & Pick<FlowRun, "id" | "status">): FlowRun {
  return {
    workspaceId: "default",
    flowId: "flow-1",
    flowNome: "Fluxo de teste",
    iniciadoEm: REFERENCIA.toISOString(),
    steps: [],
    ...parcial,
  };
}

function ticket(parcial: Partial<HandoffTicket> & Pick<HandoffTicket, "id" | "status">): HandoffTicket {
  return {
    workspaceId: "default",
    flowId: "flow-1",
    flowNome: "Fluxo de teste",
    traceId: "gr_1",
    motivo: "guardrail-revisao",
    prioridade: "p3",
    severidade: "media",
    violacoes: [],
    payloadMascarado: "{}",
    criadoEm: REFERENCIA.toISOString(),
    criadoPor: "sistema",
    slaExpiraEm: new Date(REFERENCIA.getTime() + 3_600_000).toISOString(),
    ...parcial,
  };
}

describe("estimarCustoModeloUsd", () => {
  it("calcula o custo por milhão de tokens", () => {
    const preco = { modelo: "teste", entradaUsdPorMilhao: 2, saidaUsdPorMilhao: 10 };
    // 1M de entrada = US$ 2; 500k de saída = US$ 5.
    expect(estimarCustoModeloUsd(1_000_000, 500_000, preco)).toBeCloseTo(7, 6);
  });

  it("trata contagem negativa como zero", () => {
    const preco = { modelo: "teste", entradaUsdPorMilhao: 2, saidaUsdPorMilhao: 10 };
    expect(estimarCustoModeloUsd(-100, -100, preco)).toBe(0);
  });
});

describe("calcularRoi", () => {
  it("credita horas economizadas apenas em execuções concluídas", () => {
    const snapshot = calcularRoi({
      execucoes: [
        execucao({ id: "r1", status: "concluido", metrica: { tokensEntrada: 0, tokensSaida: 0 } }),
        execucao({ id: "r2", status: "concluido", metrica: { tokensEntrada: 0, tokensSaida: 0 } }),
        // Falha não economiza nada: muitas vezes até custa retrabalho.
        execucao({ id: "r3", status: "falhou", metrica: { tokensEntrada: 0, tokensSaida: 0 } }),
      ],
      config: CONFIG,
      periodo: PERIODO,
      referencia: REFERENCIA,
    });

    expect(snapshot.execucoesConcluidas).toBe(2);
    expect(snapshot.execucoesFalhas).toBe(1);
    // 2 execuções × 30 min = 1 hora.
    expect(snapshot.horasEconomizadasBrutas).toBe(1);
    expect(snapshot.custoHumanoEvitadoBrl).toBe(60);
  });

  it("usa os minutos informados pela própria execução quando presentes", () => {
    const snapshot = calcularRoi({
      execucoes: [
        execucao({
          id: "r1",
          status: "concluido",
          metrica: { tokensEntrada: 0, tokensSaida: 0, minutosManuaisEvitados: 120 },
        }),
      ],
      config: CONFIG,
      periodo: PERIODO,
      referencia: REFERENCIA,
    });
    expect(snapshot.horasEconomizadasBrutas).toBe(2);
  });

  it("prefere o custo reportado pelo provedor à estimativa por tokens", () => {
    const snapshot = calcularRoi({
      execucoes: [
        execucao({
          id: "r1",
          status: "concluido",
          metrica: { tokensEntrada: 1_000_000, tokensSaida: 1_000_000, custoModeloUsd: 1 },
        }),
      ],
      config: CONFIG,
      periodo: PERIODO,
      referencia: REFERENCIA,
    });
    // US$ 1 × câmbio 5 = R$ 5, e não a estimativa pela tabela de preços.
    expect(snapshot.custoIaBrl).toBe(5);
  });

  it("não computa execução fora do período", () => {
    const snapshot = calcularRoi({
      execucoes: [
        execucao({
          id: "antiga",
          status: "concluido",
          iniciadoEm: "2020-01-01T00:00:00.000Z",
          metrica: { tokensEntrada: 0, tokensSaida: 0 },
        }),
      ],
      config: CONFIG,
      periodo: PERIODO,
      referencia: REFERENCIA,
    });
    expect(snapshot.execucoesTotais).toBe(0);
  });
});

describe("taxa de autonomia (zero-touch)", () => {
  it("considera apenas execuções terminais no denominador", () => {
    const snapshot = calcularRoi({
      execucoes: [
        execucao({ id: "r1", status: "concluido", metrica: { tokensEntrada: 0, tokensSaida: 0 } }),
        execucao({ id: "r2", status: "concluido", metrica: { tokensEntrada: 0, tokensSaida: 0 } }),
        execucao({ id: "r3", status: "concluido", metrica: { tokensEntrada: 0, tokensSaida: 0 } }),
        execucao({ id: "r4", status: "concluido", metrica: { tokensEntrada: 0, tokensSaida: 0 } }),
        // Em andamento não entra na taxa: incluí-la faria o indicador oscilar
        // só porque algo acabou de ser disparado.
        execucao({ id: "r5", status: "em-execucao" }),
      ],
      config: CONFIG,
      periodo: PERIODO,
      referencia: REFERENCIA,
    });

    expect(snapshot.taxaZeroTouch).toBe(1);
    expect(snapshot.execucoesEmAndamento).toBe(1);
  });

  it("quebra o zero-touch quando a execução registra intervenção", () => {
    const snapshot = calcularRoi({
      execucoes: [
        execucao({ id: "r1", status: "concluido", metrica: { tokensEntrada: 0, tokensSaida: 0 } }),
        execucao({
          id: "r2",
          status: "concluido",
          metrica: { tokensEntrada: 0, tokensSaida: 0, intervencaoHumana: true },
        }),
      ],
      config: CONFIG,
      periodo: PERIODO,
      referencia: REFERENCIA,
    });

    expect(snapshot.execucoesComIntervencao).toBe(1);
    expect(snapshot.taxaZeroTouch).toBe(0.5);
  });

  it("quebra o zero-touch por ticket de transbordo, mesmo sem flag na telemetria", () => {
    const snapshot = calcularRoi({
      execucoes: [
        execucao({ id: "r1", status: "concluido", metrica: { tokensEntrada: 0, tokensSaida: 0 } }),
        execucao({ id: "r2", status: "concluido", metrica: { tokensEntrada: 0, tokensSaida: 0 } }),
      ],
      tickets: [ticket({ id: "t1", status: "aberto", runId: "r2" })],
      config: CONFIG,
      periodo: PERIODO,
      referencia: REFERENCIA,
    });

    expect(snapshot.execucoesComIntervencao).toBe(1);
    expect(snapshot.taxaZeroTouch).toBe(0.5);
  });

  it("não conta a mesma intervenção duas vezes", () => {
    const snapshot = calcularRoi({
      execucoes: [
        execucao({
          id: "r1",
          status: "concluido",
          metrica: { tokensEntrada: 0, tokensSaida: 0, intervencaoHumana: true },
        }),
      ],
      tickets: [ticket({ id: "t1", status: "aberto", runId: "r1" })],
      config: CONFIG,
      periodo: PERIODO,
      referencia: REFERENCIA,
    });
    expect(snapshot.execucoesComIntervencao).toBe(1);
  });
});

describe("custo da revisão humana", () => {
  it("usa o tempo real de atendimento quando o ticket foi resolvido", () => {
    const snapshot = calcularRoi({
      execucoes: [execucao({ id: "r1", status: "concluido", metrica: { tokensEntrada: 0, tokensSaida: 0 } })],
      tickets: [
        ticket({
          id: "t1",
          status: "resolvido",
          runId: "r1",
          // 30 minutos de atendimento real, acima dos 10 configurados.
          decididoEm: new Date(REFERENCIA.getTime() + 30 * 60_000).toISOString(),
        }),
      ],
      config: CONFIG,
      periodo: PERIODO,
      referencia: REFERENCIA,
    });

    expect(snapshot.horasGastasEmRevisao).toBe(0.5);
    expect(snapshot.custoRevisaoHumanaBrl).toBe(30);
  });

  it("cai para o tempo configurado em ticket ainda aberto", () => {
    const snapshot = calcularRoi({
      execucoes: [execucao({ id: "r1", status: "concluido", metrica: { tokensEntrada: 0, tokensSaida: 0 } })],
      tickets: [ticket({ id: "t1", status: "aberto", runId: "r1" })],
      config: CONFIG,
      periodo: PERIODO,
      referencia: REFERENCIA,
    });
    // 10 minutos configurados ≈ 0,2 h (arredondado para uma casa).
    expect(snapshot.horasGastasEmRevisao).toBeCloseTo(0.2, 1);
  });
});

describe("transparência da base de cálculo", () => {
  it("expõe cobertura e deixa execução sem telemetria fora do custo de IA", () => {
    const snapshot = calcularRoi({
      execucoes: [
        execucao({ id: "r1", status: "concluido", metrica: { tokensEntrada: 1000, tokensSaida: 1000 } }),
        execucao({ id: "r2", status: "concluido" }),
      ],
      config: CONFIG,
      periodo: PERIODO,
      referencia: REFERENCIA,
    });

    expect(snapshot.execucoesSemTelemetria).toBe(1);
    expect(snapshot.cobertura).toBe(0.5);
    // Apenas r1 contribui com tokens.
    expect(snapshot.tokensTotais).toBe(2000);
    // Mas r2, concluída, ainda credita a hora economizada.
    expect(snapshot.horasEconomizadasBrutas).toBe(1);
  });

  it("não produz NaN nem Infinity sem execuções", () => {
    const snapshot = calcularRoi({ execucoes: [], config: CONFIG, periodo: PERIODO, referencia: REFERENCIA });

    for (const valor of [
      snapshot.taxaZeroTouch,
      snapshot.taxaSucesso,
      snapshot.roiPercentual,
      snapshot.reducaoOpexPercentual,
      snapshot.custoPorExecucaoBrl,
      snapshot.cobertura,
    ]) {
      expect(Number.isFinite(valor)).toBe(true);
    }
  });
});

describe("normalizarRoiConfig", () => {
  it("substitui valores inválidos pelo padrão em vez de propagá-los", () => {
    const normalizada = normalizarRoiConfig({
      custoHoraOperadorBrl: -50,
      cambioUsdBrl: Number.NaN,
      minutosManuaisPorExecucao: 999_999,
    });

    expect(normalizada.custoHoraOperadorBrl).toBe(ROI_CONFIG_PADRAO.custoHoraOperadorBrl);
    expect(normalizada.cambioUsdBrl).toBe(ROI_CONFIG_PADRAO.cambioUsdBrl);
    // Teto aplicado: uma semana de minutos.
    expect(normalizada.minutosManuaisPorExecucao).toBe(10_080);
  });

  it("aceita apenas moedas conhecidas", () => {
    expect(normalizarRoiConfig({ moedaExibicao: "JPY" as never }).moedaExibicao).toBe("BRL");
    expect(normalizarRoiConfig({ moedaExibicao: "USD" }).moedaExibicao).toBe("USD");
  });
});

describe("períodos", () => {
  it("delimita o mês corrente", () => {
    const periodo = periodoMesAtual(new Date(2026, 2, 15, 12));
    expect(new Date(periodo.inicio).getDate()).toBe(1);
    expect(new Date(periodo.inicio).getMonth()).toBe(2);
    expect(new Date(periodo.fim).getMonth()).toBe(2);
    expect(new Date(periodo.fim).getDate()).toBe(31);
  });
});

describe("formatadores", () => {
  it("formata horas em minutos quando abaixo de uma hora", () => {
    expect(formatarHoras(0.5)).toBe("30 min");
    expect(formatarHoras(2.25)).toBe("2.3 h");
  });

  it("formata percentual e tokens", () => {
    expect(formatarPercentual(0.8567)).toBe("85.7%");
    expect(formatarTokens(1500)).toBe("1.5k");
    expect(formatarTokens(2_500_000)).toBe("2.50M");
  });

  it("nunca propaga NaN para a interface", () => {
    expect(formatarPercentual(Number.NaN)).toBe("0.0%");
    expect(formatarHoras(Number.NaN)).toBe("0 min");
  });
});
