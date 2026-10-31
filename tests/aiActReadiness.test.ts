import { describe, expect, it } from "vitest";
import type { AuditChainVerification, HandoffQueueStats } from "@/types";
import { LIMIAR_RETENCAO_MINIMA_DIAS, avaliarProntidaoAiAct } from "@/lib/aiActReadiness";

const AGORA = new Date(2026, 9, 31, 12, 0, 0);

function diasAtras(dias: number): string {
  return new Date(AGORA.getTime() - dias * 24 * 60 * 60 * 1000).toISOString();
}

function ticketStatsVazio(overrides: Partial<HandoffQueueStats> = {}): HandoffQueueStats {
  return {
    total: 0,
    abertos: 0,
    emAnalise: 0,
    resolvidos: 0,
    expirados: 0,
    emViolacaoDeSla: 0,
    porPrioridade: { p1: 0, p2: 0, p3: 0, p4: 0 },
    tempoMedioResolucaoMin: null,
    ...overrides,
  };
}

function verificacaoIntegra(overrides: Partial<AuditChainVerification> = {}): AuditChainVerification {
  return {
    integra: true,
    entradasVerificadas: 10,
    assinaturasVerificadas: true,
    problemas: [],
    verificadoEm: AGORA.toISOString(),
    ...overrides,
  };
}

function buscarItem(itens: ReturnType<typeof avaliarProntidaoAiAct>["itens"], id: string) {
  const item = itens.find((i) => i.id === id);
  if (!item) throw new Error(`item ${id} não encontrado`);
  return item;
}

describe("avaliarProntidaoAiAct", () => {
  it("sem nenhuma entrada de auditoria: registro automático e retenção ficam 'sem_dados'", () => {
    const resultado = avaliarProntidaoAiAct({
      totalEntradasAuditoria: 0,
      primeiraEntradaEm: null,
      verificacaoCadeia: null,
      ticketStats: ticketStatsVazio(),
      referencia: AGORA,
    });
    expect(buscarItem(resultado.itens, "registro-automatico").status).toBe("sem_dados");
    expect(buscarItem(resultado.itens, "retencao-minima").status).toBe("sem_dados");
    expect(resultado.diasRetencaoDemonstrados).toBeNull();
  });

  it("com entradas registradas, 'registro automático' atende", () => {
    const resultado = avaliarProntidaoAiAct({
      totalEntradasAuditoria: 42,
      primeiraEntradaEm: diasAtras(10),
      verificacaoCadeia: null,
      ticketStats: ticketStatsVazio(),
      referencia: AGORA,
    });
    expect(buscarItem(resultado.itens, "registro-automatico").status).toBe("atende");
  });

  it("verificação de cadeia ausente: 'integridade' fica sem_dados, não 'nao_atende'", () => {
    const resultado = avaliarProntidaoAiAct({
      totalEntradasAuditoria: 5,
      primeiraEntradaEm: diasAtras(5),
      verificacaoCadeia: null,
      ticketStats: ticketStatsVazio(),
      referencia: AGORA,
    });
    expect(buscarItem(resultado.itens, "integridade-cadeia").status).toBe("sem_dados");
  });

  it("verificação íntegra: 'integridade' atende", () => {
    const resultado = avaliarProntidaoAiAct({
      totalEntradasAuditoria: 5,
      primeiraEntradaEm: diasAtras(5),
      verificacaoCadeia: verificacaoIntegra(),
      ticketStats: ticketStatsVazio(),
      referencia: AGORA,
    });
    expect(buscarItem(resultado.itens, "integridade-cadeia").status).toBe("atende");
  });

  it("verificação com problema: 'integridade' nao_atende", () => {
    const resultado = avaliarProntidaoAiAct({
      totalEntradasAuditoria: 5,
      primeiraEntradaEm: diasAtras(5),
      verificacaoCadeia: verificacaoIntegra({
        integra: false,
        problemas: [{ seq: 3, entryId: "e3", problema: "encadeamento-rompido", detalhe: "x" }],
      }),
      ticketStats: ticketStatsVazio(),
      referencia: AGORA,
    });
    expect(buscarItem(resultado.itens, "integridade-cadeia").status).toBe("nao_atende");
  });

  it("retenção 'em_formacao' quando o histórico ainda é menor que o mínimo exigido", () => {
    const resultado = avaliarProntidaoAiAct({
      totalEntradasAuditoria: 3,
      primeiraEntradaEm: diasAtras(30),
      verificacaoCadeia: null,
      ticketStats: ticketStatsVazio(),
      referencia: AGORA,
    });
    expect(resultado.diasRetencaoDemonstrados).toBe(30);
    expect(buscarItem(resultado.itens, "retencao-minima").status).toBe("em_formacao");
  });

  it(`retenção 'atende' quando o histórico já cobre ${LIMIAR_RETENCAO_MINIMA_DIAS} dias ou mais`, () => {
    const resultado = avaliarProntidaoAiAct({
      totalEntradasAuditoria: 500,
      primeiraEntradaEm: diasAtras(200),
      verificacaoCadeia: null,
      ticketStats: ticketStatsVazio(),
      referencia: AGORA,
    });
    expect(resultado.diasRetencaoDemonstrados).toBe(200);
    expect(buscarItem(resultado.itens, "retencao-minima").status).toBe("atende");
  });

  it("minimização de PII sempre atende — é um controle arquitetural, não depende de dados de entrada", () => {
    const resultado = avaliarProntidaoAiAct({
      totalEntradasAuditoria: 0,
      primeiraEntradaEm: null,
      verificacaoCadeia: null,
      ticketStats: ticketStatsVazio(),
      referencia: AGORA,
    });
    expect(buscarItem(resultado.itens, "minimizacao-pii").status).toBe("atende");
  });

  it("supervisão humana reflete o uso real da fila de transbordo", () => {
    const semUso = avaliarProntidaoAiAct({
      totalEntradasAuditoria: 0,
      primeiraEntradaEm: null,
      verificacaoCadeia: null,
      ticketStats: ticketStatsVazio(),
      referencia: AGORA,
    });
    expect(buscarItem(semUso.itens, "supervisao-humana").status).toBe("sem_dados");

    const comUso = avaliarProntidaoAiAct({
      totalEntradasAuditoria: 0,
      primeiraEntradaEm: null,
      verificacaoCadeia: null,
      ticketStats: ticketStatsVazio({ total: 7, resolvidos: 5 }),
      referencia: AGORA,
    });
    expect(buscarItem(comUso.itens, "supervisao-humana").status).toBe("atende");
  });

  it("itens fora do escopo do software estão sempre presentes e nunca entram no denominador avaliável", () => {
    const resultado = avaliarProntidaoAiAct({
      totalEntradasAuditoria: 500,
      primeiraEntradaEm: diasAtras(200),
      verificacaoCadeia: verificacaoIntegra(),
      ticketStats: ticketStatsVazio({ total: 7, resolvidos: 5 }),
      referencia: AGORA,
    });
    const foraDoEscopo = resultado.itens.filter((i) => i.status === "fora_do_escopo");
    expect(foraDoEscopo.length).toBeGreaterThanOrEqual(3);
    expect(resultado.totalAvaliavelPorSoftware).toBe(resultado.itens.length - foraDoEscopo.length);
    // Cenário "tudo verde": todos os itens avaliáveis pelo software atendem.
    expect(resultado.totalAtende).toBe(resultado.totalAvaliavelPorSoftware);
  });
});
