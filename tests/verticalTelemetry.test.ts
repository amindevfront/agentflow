import { describe, expect, it } from "vitest";
import type { Conversation, FlowRun, HandoffTicket, RoiPeriodo, Shipment } from "@/types";
import {
  CONTRATO_IMOBILIARIO_ALTO_PADRAO,
  CONTRATO_LOGISTICA_B2B,
  calcularTelemetriaVertical,
  duracaoExecucaoMs,
  formatarValorMetrica,
  obterContratoVertical,
  type EntradaTelemetriaVertical,
  type MetricaVertical,
} from "@/lib/verticalTelemetry";

const PERIODO: RoiPeriodo = {
  inicio: "2026-11-01T00:00:00.000Z",
  fim: "2026-11-30T23:59:59.999Z",
  rotulo: "novembro/2026",
};

function conversa(parcial: Partial<Conversation> & { id: string; criadaEm: string }): Conversation {
  return {
    workspaceId: "ws-1",
    canal: "whatsapp",
    participante: { nome: "Lead", identificadorMascarado: "***" },
    assunto: "Assunto",
    status: "aberta",
    prioridade: "p3",
    atribuidoTipo: "nenhum",
    frustrationIndex: 0,
    frustrationTendencia: "estavel",
    circuitBreakerAtivo: false,
    ultimaMensagemPreview: "",
    ultimaMensagemEm: parcial.criadaEm,
    totalMensagens: 1,
    totalMensagensCliente: 1,
    ...parcial,
  } as Conversation;
}

function ticket(parcial: Partial<HandoffTicket> & { id: string; criadoEm: string }): HandoffTicket {
  return {
    workspaceId: "ws-1",
    flowId: "f1",
    flowNome: "Fluxo",
    nodeId: "n1",
    traceId: "t1",
    motivo: "agendamento-visita-presencial",
    status: "aberto",
    prioridade: "p2",
    severidade: "alta",
    violacoes: [],
    payloadMascarado: "",
    criadoPor: "sistema",
    slaExpiraEm: parcial.criadoEm,
    atribuidoPara: null,
    atribuidoEm: null,
    ...parcial,
  } as HandoffTicket;
}

function execucao(parcial: Partial<FlowRun> & { id: string; iniciadoEm: string }): FlowRun {
  return {
    workspaceId: "ws-1",
    flowId: "f1",
    flowNome: "Fluxo",
    status: "concluido",
    steps: [],
    ...parcial,
  } as FlowRun;
}

function base(parcial: Partial<EntradaTelemetriaVertical> = {}): EntradaTelemetriaVertical {
  return {
    contrato: CONTRATO_IMOBILIARIO_ALTO_PADRAO,
    periodo: PERIODO,
    conversas: [],
    tickets: [],
    execucoes: [],
    cargas: [],
    referencia: new Date("2026-11-17T12:00:00.000Z"),
    ...parcial,
  };
}

function metrica(metricas: MetricaVertical[], id: string): MetricaVertical {
  const encontrada = metricas.find((m) => m.id === id);
  if (!encontrada) throw new Error(`Métrica "${id}" não encontrada.`);
  return encontrada;
}

describe("obterContratoVertical", () => {
  it("resolve os dois motores dedicados e nada mais", () => {
    expect(obterContratoVertical("construtora-imobiliaria")?.id).toBe("imobiliario-alto-padrao");
    expect(obterContratoVertical("logistica-portuaria")?.id).toBe("logistica-b2b");
    expect(obterContratoVertical("ecommerce")).toBeNull();
    expect(obterContratoVertical(null)).toBeNull();
    expect(obterContratoVertical(undefined)).toBeNull();
  });
});

describe("contrato de dados do Motor Vertical A", () => {
  it("mantém o baseline de produção pedido para Itajaí/BC", () => {
    expect(CONTRATO_IMOBILIARIO_ALTO_PADRAO.vgvMedioUnidadeBrl).toBe(1_500_000);
    expect(CONTRATO_IMOBILIARIO_ALTO_PADRAO.comissaoMediaBrl).toBe(75_000);
    expect(CONTRATO_IMOBILIARIO_ALTO_PADRAO.pracasAlvo).toContain("Praia Brava");
  });
});

describe("calcularTelemetriaVertical — imobiliário", () => {
  it("conta leads de madrugada (0h–6h) só com mensagem do cliente", () => {
    const metricas = calcularTelemetriaVertical(
      base({
        conversas: [
          // 03:00 local — dentro da janela de madrugada.
          conversa({ id: "c1", criadaEm: "2026-11-10T03:00:00.000" }),
          // 14:00 local — fora.
          conversa({ id: "c2", criadaEm: "2026-11-10T14:00:00.000" }),
          // Madrugada, mas sem resposta do cliente — não qualifica.
          conversa({ id: "c3", criadaEm: "2026-11-10T04:00:00.000", totalMensagensCliente: 0 }),
          // Fora do período de apuração.
          conversa({ id: "c4", criadaEm: "2026-09-10T03:00:00.000" }),
        ],
      })
    );
    expect(metrica(metricas, "leads-madrugada").valor).toBe(1);
  });

  it("traduz visitas confirmadas em VGV e comissão pelo contrato declarado", () => {
    const metricas = calcularTelemetriaVertical(
      base({
        tickets: [
          ticket({ id: "t1", criadoEm: "2026-11-05T10:00:00.000Z" }),
          ticket({ id: "t2", criadoEm: "2026-11-06T10:00:00.000Z" }),
          // Cancelado não conta.
          ticket({ id: "t3", criadoEm: "2026-11-07T10:00:00.000Z", status: "cancelado" }),
          // Outro motivo (frustração) não é visita.
          ticket({ id: "t4", criadoEm: "2026-11-08T10:00:00.000Z", motivo: "frustracao-critica" }),
          // Fora do período.
          ticket({ id: "t5", criadoEm: "2026-10-08T10:00:00.000Z" }),
        ],
      })
    );
    expect(metrica(metricas, "visitas-agendadas").valor).toBe(2);
    expect(metrica(metricas, "vgv-pipeline").valor).toBe(3_000_000);
    expect(metrica(metricas, "comissao-projetada").valor).toBe(150_000);
  });

  it("zera VGV sem nenhuma visita — zero real, nunca um pipeline inventado", () => {
    const metricas = calcularTelemetriaVertical(base());
    expect(metrica(metricas, "vgv-pipeline").valor).toBe(0);
    expect(metrica(metricas, "comissao-projetada").valor).toBe(0);
  });
});

describe("calcularTelemetriaVertical — logística", () => {
  const entradaLogistica = (parcial: Partial<EntradaTelemetriaVertical> = {}) =>
    base({ contrato: CONTRATO_LOGISTICA_B2B, ...parcial });

  it("conta como sub-30s só execuções concluídas COM telemetria de duração", () => {
    const metricas = calcularTelemetriaVertical(
      entradaLogistica({
        execucoes: [
          execucao({
            id: "r1",
            iniciadoEm: "2026-11-05T10:00:00.000Z",
            steps: [{ id: "s1", titulo: "a", status: "concluido", duracaoMs: 12_000 }],
          }),
          execucao({
            id: "r2",
            iniciadoEm: "2026-11-05T11:00:00.000Z",
            steps: [{ id: "s1", titulo: "a", status: "concluido", duracaoMs: 45_000 }],
          }),
          // Sem duração registrada: fora do numerador E do denominador.
          execucao({
            id: "r3",
            iniciadoEm: "2026-11-05T12:00:00.000Z",
            steps: [{ id: "s1", titulo: "a", status: "concluido" }],
          }),
          // Falhou: nem entra.
          execucao({
            id: "r4",
            iniciadoEm: "2026-11-05T13:00:00.000Z",
            status: "falhou",
            steps: [{ id: "s1", titulo: "a", status: "falhou", duracaoMs: 1_000 }],
          }),
        ],
      })
    );
    const m = metrica(metricas, "cotacoes-sub-30s");
    expect(m.valor).toBe(1);
    expect(m.detalhe).toContain("2 execução(ões)");
  });

  it("conta resolução autônoma só sem ticket de SLA e sem circuit breaker", () => {
    const metricas = calcularTelemetriaVertical(
      entradaLogistica({
        conversas: [
          conversa({ id: "c1", criadaEm: "2026-11-05T10:00:00.000Z", status: "resolvida" }),
          conversa({
            id: "c2",
            criadaEm: "2026-11-05T10:00:00.000Z",
            status: "resolvida",
            slaTicketId: "hitl_1",
          }),
          conversa({
            id: "c3",
            criadaEm: "2026-11-05T10:00:00.000Z",
            status: "resolvida",
            circuitBreakerAtivo: true,
          }),
          conversa({ id: "c4", criadaEm: "2026-11-05T10:00:00.000Z", status: "aberta" }),
        ],
      })
    );
    expect(metrica(metricas, "resolucoes-autonomas").valor).toBe(1);
  });

  it("soma Risk Shield dos tickets do período e expõe demurrage em curso à parte", () => {
    const cargaComDemurrage: Shipment = {
      id: "ship_1",
      workspaceId: "ws-1",
      codigoRastreio: "DEMO-1",
      origem: "Itajaí",
      destino: "Campinas",
      status: "aduana",
      previsaoEntrega: "2026-11-20T00:00:00.000Z",
      freeTimeDias: 2,
      custoDiarioDemurrageBrl: 100,
      atualizadoEm: "2026-11-01T00:00:00.000Z",
      criadoEm: "2026-11-01T00:00:00.000Z",
      // Chegou à aduana há 5 dias: 3 dias excedentes × R$100 = R$300.
      historico: [{ status: "aduana", ocorridoEm: "2026-11-12T12:00:00.000Z" }],
    };

    const metricas = calcularTelemetriaVertical(
      entradaLogistica({
        tickets: [
          ticket({
            id: "t1",
            criadoEm: "2026-11-05T10:00:00.000Z",
            motivo: "risco-fiscal-margem-nao-autorizado",
            riscoPrevenido: {
              regras: ["desconto-acima-limite-sem-aprovacao"],
              categorias: ["Desconto acima do limite sem aprovação"],
              prejuizoEstimadoBrl: 12_000,
            },
          }),
          // Fora do período: não soma.
          ticket({
            id: "t2",
            criadoEm: "2026-08-05T10:00:00.000Z",
            motivo: "risco-fiscal-margem-nao-autorizado",
            riscoPrevenido: {
              regras: ["informalidade-fiscal-nao-autorizada"],
              categorias: ["Informalidade fiscal"],
              prejuizoEstimadoBrl: 99_000,
            },
          }),
        ],
        cargas: [cargaComDemurrage],
      })
    );

    expect(metrica(metricas, "risk-shield").valor).toBe(12_000);
    expect(metrica(metricas, "risk-shield").detalhe).toContain("demurrage");
    expect(metrica(metricas, "cargas-monitoradas").valor).toBe(1);
  });

  it("carga sem termos de demurrage contratados não entra no contador", () => {
    const semTermos: Shipment = {
      id: "ship_2",
      workspaceId: "ws-1",
      codigoRastreio: "DEMO-2",
      origem: "A",
      destino: "B",
      status: "aduana",
      previsaoEntrega: "2026-11-20T00:00:00.000Z",
      atualizadoEm: "2026-11-01T00:00:00.000Z",
      criadoEm: "2026-11-01T00:00:00.000Z",
      historico: [{ status: "aduana", ocorridoEm: "2026-11-12T12:00:00.000Z" }],
    };
    const metricas = calcularTelemetriaVertical(entradaLogistica({ cargas: [semTermos] }));
    expect(metrica(metricas, "cargas-monitoradas").valor).toBe(0);
  });
});

describe("duracaoExecucaoMs", () => {
  it("soma só os passos que registraram duração", () => {
    expect(
      duracaoExecucaoMs(
        execucao({
          id: "r",
          iniciadoEm: "2026-11-05T10:00:00.000Z",
          steps: [
            { id: "a", titulo: "a", status: "concluido", duracaoMs: 1_000 },
            { id: "b", titulo: "b", status: "concluido" },
            { id: "c", titulo: "c", status: "concluido", duracaoMs: 2_500 },
          ],
        })
      )
    ).toBe(3_500);
  });

  it("devolve null quando nenhum passo registrou duração — nunca zero", () => {
    expect(
      duracaoExecucaoMs(
        execucao({ id: "r", iniciadoEm: "2026-11-05T10:00:00.000Z", steps: [{ id: "a", titulo: "a", status: "concluido" }] })
      )
    ).toBeNull();
  });
});

describe("formatarValorMetrica", () => {
  it("formata moeda sem centavos e inteiro sem decoração", () => {
    const metricas = calcularTelemetriaVertical(
      base({ tickets: [ticket({ id: "t1", criadoEm: "2026-11-05T10:00:00.000Z" })] })
    );
    expect(formatarValorMetrica(metrica(metricas, "vgv-pipeline"))).toContain("1.500.000");
    expect(formatarValorMetrica(metrica(metricas, "visitas-agendadas"))).toBe("1");
  });
});

describe("integridade das métricas", () => {
  it("toda métrica de todo motor tem rótulo, detalhe e dica preenchidos", () => {
    for (const contrato of [CONTRATO_IMOBILIARIO_ALTO_PADRAO, CONTRATO_LOGISTICA_B2B]) {
      const metricas = calcularTelemetriaVertical(base({ contrato }));
      expect(metricas.length).toBeGreaterThan(0);
      for (const m of metricas) {
        expect(m.rotulo.trim().length).toBeGreaterThan(0);
        expect(m.detalhe.trim().length).toBeGreaterThan(0);
        expect(m.dica.trim().length).toBeGreaterThan(0);
        expect(Number.isFinite(m.valor)).toBe(true);
      }
      // Ids únicos — a UI usa `metrica.id` como key de lista.
      const ids = metricas.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
