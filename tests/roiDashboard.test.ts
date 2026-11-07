import { describe, expect, it } from "vitest";
import type { Conversation, HandoffTicket } from "@/types";
import {
  JANELA_MADRUGADA,
  VALOR_MEDIO_PIPELINE_PADRAO_BRL,
  agregarPipelinePorVertical,
  calcularMetricasPipelineVertical,
} from "@/lib/server/roiDashboard";
import { periodoMesAtual } from "@/lib/roi";
import { foraDoExpediente } from "@/lib/inbox/revenueRescue";

const REFERENCIA = new Date("2026-03-15T12:00:00.000Z");
const PERIODO = periodoMesAtual(REFERENCIA);

function conversa(parcial: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv-1",
    workspaceId: "ws-1",
    canal: "webchat",
    participante: { nome: "Visitante", identificadorMascarado: "widget:abc" },
    assunto: "Contato",
    status: "aberta",
    prioridade: "p3",
    atribuidoTipo: "nenhum",
    frustrationIndex: 0,
    frustrationTendencia: "estavel",
    circuitBreakerAtivo: false,
    ultimaMensagemPreview: "",
    ultimaMensagemEm: "2026-03-10T03:00:00.000Z",
    criadaEm: "2026-03-10T03:00:00.000Z",
    totalMensagens: 1,
    totalMensagensCliente: 1,
    ...parcial,
  };
}

function ticket(parcial: Partial<HandoffTicket> = {}): HandoffTicket {
  return {
    id: "hitl-1",
    workspaceId: "ws-1",
    flowId: "conv-1",
    flowNome: "Contato via Web Widget",
    traceId: "gr_1",
    motivo: "agendamento-visita-presencial",
    status: "aberto",
    prioridade: "p2",
    severidade: "media",
    violacoes: [],
    payloadMascarado: "ok",
    criadoEm: "2026-03-10T10:00:00.000Z",
    criadoPor: "sistema",
    slaExpiraEm: "2026-03-10T11:00:00.000Z",
    atribuidoPara: null,
    atribuidoEm: null,
    ...parcial,
  };
}

describe("JANELA_MADRUGADA", () => {
  it("considera madrugada exatamente o intervalo [0h, 6h)", () => {
    expect(foraDoExpediente(new Date("2026-03-10T00:30:00"), JANELA_MADRUGADA)).toBe(true);
    expect(foraDoExpediente(new Date("2026-03-10T05:59:00"), JANELA_MADRUGADA)).toBe(true);
    expect(foraDoExpediente(new Date("2026-03-10T06:00:00"), JANELA_MADRUGADA)).toBe(false);
    expect(foraDoExpediente(new Date("2026-03-10T14:00:00"), JANELA_MADRUGADA)).toBe(false);
    expect(foraDoExpediente(new Date("2026-03-10T23:59:00"), JANELA_MADRUGADA)).toBe(false);
  });

  it("não exclui nenhum dia da semana (fim de semana também conta)", () => {
    // 2026-03-14 é um sábado.
    expect(foraDoExpediente(new Date("2026-03-14T02:00:00"), JANELA_MADRUGADA)).toBe(true);
  });
});

describe("VALOR_MEDIO_PIPELINE_PADRAO_BRL", () => {
  it("tem um valor >= 0 para todo NicheKey (Record exaustivo, nenhum nicho esquecido)", () => {
    for (const valor of Object.values(VALOR_MEDIO_PIPELINE_PADRAO_BRL)) {
      expect(valor).toBeGreaterThanOrEqual(0);
    }
  });

  it("só os três Módulos Verticais com protocolo de agendamento têm valor > 0 — nenhum nicho sem o protocolo recebe valor inventado", () => {
    expect(VALOR_MEDIO_PIPELINE_PADRAO_BRL["construtora-imobiliaria"]).toBeGreaterThan(0);
    expect(VALOR_MEDIO_PIPELINE_PADRAO_BRL["clinica-alto-padrao"]).toBeGreaterThan(0);
    expect(VALOR_MEDIO_PIPELINE_PADRAO_BRL["advocacia-contabilidade"]).toBeGreaterThan(0);

    expect(VALOR_MEDIO_PIPELINE_PADRAO_BRL["logistica-portuaria"]).toBe(0);
    expect(VALOR_MEDIO_PIPELINE_PADRAO_BRL["servicos-luxo"]).toBe(0);
    expect(VALOR_MEDIO_PIPELINE_PADRAO_BRL.ecommerce).toBe(0);
    expect(VALOR_MEDIO_PIPELINE_PADRAO_BRL["salao-beleza"]).toBe(0);
    expect(VALOR_MEDIO_PIPELINE_PADRAO_BRL["clinica-medica-exames"]).toBe(0);
    expect(VALOR_MEDIO_PIPELINE_PADRAO_BRL.outros).toBe(0);
  });
});

describe("calcularMetricasPipelineVertical", () => {
  it("conta atendimentos, leads de madrugada e agendamentos confirmados dentro do período", () => {
    const conversas = [
      conversa({ id: "c1", criadaEm: "2026-03-10T03:00:00.000Z", totalMensagensCliente: 1 }), // madrugada
      conversa({ id: "c2", criadaEm: "2026-03-10T14:00:00.000Z", totalMensagensCliente: 1 }), // fora da madrugada
      conversa({ id: "c3", criadaEm: "2026-03-10T04:00:00.000Z", totalMensagensCliente: 0 }), // madrugada, mas sem mensagem do cliente
    ];
    const tickets = [
      ticket({ id: "t1", motivo: "agendamento-visita-presencial", status: "aberto" }),
      ticket({ id: "t2", motivo: "confirmacao-agendamento-clinico", status: "resolvido" }),
      ticket({ id: "t3", motivo: "agendamento-visita-presencial", status: "cancelado" }), // cancelado não conta
      ticket({ id: "t4", motivo: "guardrail-bloqueio", status: "aberto" }), // não é confirmação de agendamento
    ];

    const resultado = calcularMetricasPipelineVertical({
      workspaceId: "ws-1",
      setor: "construtora-imobiliaria",
      conversas,
      tickets,
      periodo: PERIODO,
      referencia: REFERENCIA,
    });

    expect(resultado.atendimentos).toBe(3);
    expect(resultado.leadsQualificadosMadrugada).toBe(1); // só c1
    expect(resultado.agendamentosConfirmados).toBe(2); // t1 e t2
    expect(resultado.valorMedioPipelineUsadoBrl).toBe(VALOR_MEDIO_PIPELINE_PADRAO_BRL["construtora-imobiliaria"]);
    expect(resultado.pipelineEstimadoBrl).toBe(2 * VALOR_MEDIO_PIPELINE_PADRAO_BRL["construtora-imobiliaria"]);
  });

  it("ignora tickets de outro workspace", () => {
    const resultado = calcularMetricasPipelineVertical({
      workspaceId: "ws-1",
      setor: "clinica-alto-padrao",
      conversas: [],
      tickets: [ticket({ workspaceId: "ws-2", motivo: "confirmacao-agendamento-clinico" })],
      periodo: PERIODO,
      referencia: REFERENCIA,
    });
    expect(resultado.agendamentosConfirmados).toBe(0);
    expect(resultado.pipelineEstimadoBrl).toBe(0);
  });

  it("respeita o override explícito de valorMedioPipelineBrl", () => {
    const resultado = calcularMetricasPipelineVertical({
      workspaceId: "ws-1",
      setor: "clinica-alto-padrao",
      conversas: [],
      tickets: [ticket({ motivo: "confirmacao-agendamento-clinico" })],
      periodo: PERIODO,
      valorMedioPipelineBrl: 9999,
      referencia: REFERENCIA,
    });
    expect(resultado.valorMedioPipelineUsadoBrl).toBe(9999);
    expect(resultado.pipelineEstimadoBrl).toBe(9999);
  });

  it("nicho sem protocolo de agendamento gera pipeline zero mesmo com tickets de confirmação (não deveria ocorrer na prática, mas nunca inventa valor)", () => {
    const resultado = calcularMetricasPipelineVertical({
      workspaceId: "ws-1",
      setor: "ecommerce",
      conversas: [],
      tickets: [ticket({ motivo: "agendamento-visita-presencial" })],
      periodo: PERIODO,
      referencia: REFERENCIA,
    });
    expect(resultado.pipelineEstimadoBrl).toBe(0);
  });

  it("ignora conversas e tickets fora do período", () => {
    const resultado = calcularMetricasPipelineVertical({
      workspaceId: "ws-1",
      setor: "construtora-imobiliaria",
      conversas: [conversa({ criadaEm: "2025-01-01T03:00:00.000Z" })],
      tickets: [ticket({ criadoEm: "2025-01-01T10:00:00.000Z" })],
      periodo: PERIODO,
      referencia: REFERENCIA,
    });
    expect(resultado.atendimentos).toBe(0);
    expect(resultado.agendamentosConfirmados).toBe(0);
  });
});

describe("agregarPipelinePorVertical", () => {
  it("agrega corretamente por vertical, somando múltiplos workspaces do mesmo setor", () => {
    const metricas = [
      calcularMetricasPipelineVertical({
        workspaceId: "ws-1",
        setor: "construtora-imobiliaria",
        conversas: [],
        tickets: [ticket({ workspaceId: "ws-1", motivo: "agendamento-visita-presencial" })],
        periodo: PERIODO,
        referencia: REFERENCIA,
      }),
      calcularMetricasPipelineVertical({
        workspaceId: "ws-2",
        setor: "construtora-imobiliaria",
        conversas: [],
        tickets: [ticket({ workspaceId: "ws-2", motivo: "agendamento-visita-presencial" })],
        periodo: PERIODO,
        referencia: REFERENCIA,
      }),
      calcularMetricasPipelineVertical({
        workspaceId: "ws-3",
        setor: "clinica-alto-padrao",
        conversas: [],
        tickets: [ticket({ workspaceId: "ws-3", motivo: "confirmacao-agendamento-clinico" })],
        periodo: PERIODO,
        referencia: REFERENCIA,
      }),
    ];

    const snapshot = agregarPipelinePorVertical(metricas, PERIODO, REFERENCIA);

    const imobiliario = snapshot.porVertical.find((v) => v.setor === "construtora-imobiliaria");
    expect(imobiliario?.workspacesContribuintes).toBe(2);
    expect(imobiliario?.agendamentosConfirmados).toBe(2);
    expect(imobiliario?.pipelineEstimadoBrl).toBe(2 * VALOR_MEDIO_PIPELINE_PADRAO_BRL["construtora-imobiliaria"]);

    const clinica = snapshot.porVertical.find((v) => v.setor === "clinica-alto-padrao");
    expect(clinica?.workspacesContribuintes).toBe(1);

    expect(snapshot.agendamentosConfirmadosTotais).toBe(3);
    expect(snapshot.pipelineTotalEstimadoBrl).toBe(
      2 * VALOR_MEDIO_PIPELINE_PADRAO_BRL["construtora-imobiliaria"] +
        1 * VALOR_MEDIO_PIPELINE_PADRAO_BRL["clinica-alto-padrao"]
    );
  });

  it("ordena por pipeline estimado, do maior para o menor", () => {
    const metricas = [
      calcularMetricasPipelineVertical({
        workspaceId: "ws-1",
        setor: "clinica-alto-padrao",
        conversas: [],
        tickets: [ticket({ workspaceId: "ws-1", motivo: "confirmacao-agendamento-clinico" })],
        periodo: PERIODO,
        referencia: REFERENCIA,
      }),
      calcularMetricasPipelineVertical({
        workspaceId: "ws-2",
        setor: "construtora-imobiliaria",
        conversas: [],
        tickets: [ticket({ workspaceId: "ws-2", motivo: "agendamento-visita-presencial" })],
        periodo: PERIODO,
        referencia: REFERENCIA,
      }),
    ];

    const snapshot = agregarPipelinePorVertical(metricas, PERIODO, REFERENCIA);
    expect(snapshot.porVertical[0].setor).toBe("construtora-imobiliaria"); // maior valor médio
  });

  it("devolve snapshot vazio, nunca lança, quando não há métricas", () => {
    const snapshot = agregarPipelinePorVertical([], PERIODO, REFERENCIA);
    expect(snapshot.porVertical).toEqual([]);
    expect(snapshot.pipelineTotalEstimadoBrl).toBe(0);
  });
});
