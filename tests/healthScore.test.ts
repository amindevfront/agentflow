import { describe, expect, it } from "vitest";
import type { Conversation, FlowRun, HandoffTicket, PedidoEcommerce } from "@/types";
import { calcularHealthScore } from "@/lib/healthScore";

const AGORA = new Date(2026, 0, 31, 12, 0, 0);

function horasAtras(horas: number): string {
  return new Date(AGORA.getTime() - horas * 60 * 60 * 1000).toISOString();
}

function diasAtras(dias: number): string {
  return horasAtras(dias * 24);
}

function criarExecucao(overrides: Partial<FlowRun> = {}): FlowRun {
  return {
    id: `run_${Math.random()}`,
    workspaceId: "default",
    flowId: "flow_1",
    flowNome: "Fluxo Teste",
    status: "concluido",
    iniciadoEm: diasAtras(1),
    steps: [],
    ...overrides,
  };
}

function criarTicket(overrides: Partial<HandoffTicket> = {}): HandoffTicket {
  return {
    id: `ticket_${Math.random()}`,
    workspaceId: "default",
    flowId: "flow_1",
    flowNome: "Fluxo Teste",
    traceId: "trace_1",
    motivo: "solicitacao-manual",
    status: "aberto",
    prioridade: "p3",
    severidade: "media",
    violacoes: [],
    payloadMascarado: "{}",
    criadoEm: diasAtras(1),
    criadoPor: "sistema",
    slaExpiraEm: diasAtras(-1),
    ...overrides,
  };
}

function criarConversa(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: `conv_${Math.random()}`,
    workspaceId: "default",
    canal: "whatsapp",
    participante: { nome: "Cliente Teste", identificadorMascarado: "[[PII:TELEFONE:1]]" },
    assunto: "Dúvida sobre produto",
    status: "resolvida",
    prioridade: "p3",
    atribuidoTipo: "humano",
    frustrationIndex: 0,
    frustrationTendencia: "estavel",
    circuitBreakerAtivo: false,
    ultimaMensagemPreview: "Obrigado pela ajuda!",
    ultimaMensagemEm: diasAtras(1),
    criadaEm: diasAtras(1),
    totalMensagens: 4,
    totalMensagensCliente: 2,
    ...overrides,
  };
}

function criarPedido(overrides: Partial<PedidoEcommerce> = {}): PedidoEcommerce {
  return {
    id: `pedido_${Math.random()}`,
    workspaceId: "default",
    numeroPedido: "1001",
    valorBrl: 200,
    status: "entregue",
    criadoEm: diasAtras(1),
    ...overrides,
  };
}

describe("calcularHealthScore", () => {
  it("score 100 / saudável quando tudo está bem: sucesso alto, sem ticket vencido, atividade recente", () => {
    const resultado = calcularHealthScore({
      execucoes: [...Array.from({ length: 9 }, () => criarExecucao()), criarExecucao({ status: "falhou" })],
      tickets: [],
      conversas: [],
      referencia: AGORA,
    });
    expect(resultado.score).toBe(100);
    expect(resultado.nivel).toBe("saudavel");
    expect(resultado.sinais).toHaveLength(0);
  });

  it("taxaSucessoExecucoes é null sem nenhuma execução terminal na janela de 30 dias", () => {
    const resultado = calcularHealthScore({
      execucoes: [criarExecucao({ status: "em-execucao" })],
      tickets: [],
      conversas: [criarConversa()],
      referencia: AGORA,
    });
    expect(resultado.taxaSucessoExecucoes).toBeNull();
  });

  it("penaliza taxa de sucesso crítica (abaixo de 70%)", () => {
    const execucoes = [
      ...Array.from({ length: 6 }, () => criarExecucao({ status: "falhou" })),
      ...Array.from({ length: 4 }, () => criarExecucao({ status: "concluido" })),
    ];
    const resultado = calcularHealthScore({ execucoes, tickets: [], conversas: [], referencia: AGORA });
    expect(resultado.taxaSucessoExecucoes).toBeCloseTo(0.4, 2);
    expect(resultado.score).toBe(70);
    expect(resultado.sinais.some((s) => s.descricao.includes("70%"))).toBe(true);
  });

  it("penaliza 3 ou mais tickets de transbordo vencidos (>48h) com o peso crítico", () => {
    const tickets = [
      criarTicket({ criadoEm: horasAtras(72) }),
      criarTicket({ criadoEm: horasAtras(96) }),
      criarTicket({ criadoEm: horasAtras(120) }),
    ];
    const resultado = calcularHealthScore({
      execucoes: [criarExecucao()],
      tickets,
      conversas: [],
      referencia: AGORA,
    });
    expect(resultado.ticketsAbertosVencidos).toBe(3);
    expect(resultado.score).toBe(70);
  });

  it("tickets resolvidos ou recentes (<48h) nunca contam como vencidos", () => {
    const tickets = [
      criarTicket({ status: "resolvido", criadoEm: horasAtras(200) }),
      criarTicket({ status: "aberto", criadoEm: horasAtras(10) }),
    ];
    const resultado = calcularHealthScore({
      execucoes: [criarExecucao()],
      tickets,
      conversas: [],
      referencia: AGORA,
    });
    expect(resultado.ticketsAbertosVencidos).toBe(0);
  });

  it("diasSemAtividade é null e aplica a penalidade máxima quando nunca houve execução nem conversa", () => {
    const resultado = calcularHealthScore({ execucoes: [], tickets: [], conversas: [], referencia: AGORA });
    expect(resultado.diasSemAtividade).toBeNull();
    expect(resultado.score).toBe(60);
    expect(resultado.nivel).toBe("atencao");
  });

  it("usa a atividade mais recente entre execuções e conversas para contar dias sem atividade", () => {
    const resultado = calcularHealthScore({
      execucoes: [criarExecucao({ iniciadoEm: diasAtras(20) })],
      tickets: [],
      conversas: [criarConversa({ criadaEm: diasAtras(2), ultimaMensagemEm: diasAtras(2) })],
      referencia: AGORA,
    });
    expect(resultado.diasSemAtividade).toBe(2);
  });

  it("classifica nível 'risco' quando múltiplos sinais críticos se acumulam", () => {
    const resultado = calcularHealthScore({
      execucoes: [criarExecucao({ iniciadoEm: diasAtras(20), status: "falhou" })],
      tickets: [criarTicket({ criadoEm: horasAtras(96) }), criarTicket({ criadoEm: horasAtras(96) }), criarTicket({ criadoEm: horasAtras(96) })],
      conversas: [],
      referencia: AGORA,
    });
    expect(resultado.nivel).toBe("risco");
    expect(resultado.score).toBeLessThan(40);
  });

  it("acumula as três penalidades críticas sem nunca ficar negativo", () => {
    const resultado = calcularHealthScore({
      execucoes: [
        ...Array.from({ length: 10 }, () => criarExecucao({ status: "falhou", iniciadoEm: diasAtras(25) })),
      ],
      tickets: [criarTicket({ criadoEm: horasAtras(96) }), criarTicket({ criadoEm: horasAtras(96) }), criarTicket({ criadoEm: horasAtras(96) })],
      conversas: [],
      referencia: AGORA,
    });
    // sucesso crítico (-30) + tickets crítico (-30) + inatividade crítica (-35) = score 5.
    expect(resultado.score).toBe(5);
    expect(resultado.score).toBeGreaterThanOrEqual(0);
    expect(resultado.sinais).toHaveLength(3);
  });

  it("taxaChargebackEDevolucao fica null quando `pedidos` não é informado — sinal de e-commerce nunca penaliza outro nicho", () => {
    const resultado = calcularHealthScore({
      execucoes: [...Array.from({ length: 9 }, () => criarExecucao()), criarExecucao({ status: "falhou" })],
      tickets: [],
      conversas: [],
      referencia: AGORA,
    });
    expect(resultado.taxaChargebackEDevolucao).toBeNull();
    expect(resultado.score).toBe(100);
  });

  it("`pedidos` vazio é tratado como ausente — nenhum sinal de chargeback, nenhuma penalidade", () => {
    const resultado = calcularHealthScore({
      execucoes: [...Array.from({ length: 9 }, () => criarExecucao()), criarExecucao({ status: "falhou" })],
      tickets: [],
      conversas: [],
      pedidos: [],
      referencia: AGORA,
    });
    expect(resultado.taxaChargebackEDevolucao).toBeNull();
    expect(resultado.score).toBe(100);
  });

  it("penaliza em -25 quando a taxa de chargeback+devolução está em nível crítico (>=7,5%)", () => {
    const pedidos = [
      ...Array.from({ length: 92 }, () => criarPedido({ status: "entregue" })),
      ...Array.from({ length: 8 }, () => criarPedido({ status: "chargeback" })),
    ];
    const resultado = calcularHealthScore({
      execucoes: [...Array.from({ length: 9 }, () => criarExecucao()), criarExecucao({ status: "falhou" })],
      tickets: [],
      conversas: [],
      pedidos,
      referencia: AGORA,
    });
    expect(resultado.taxaChargebackEDevolucao).toBeCloseTo(0.08, 2);
    expect(resultado.score).toBe(75); // 100 - 25
    expect(resultado.sinais.some((s) => s.descricao.includes("chargeback"))).toBe(true);
  });

  it("penaliza em -10 quando a taxa de chargeback+devolução está em nível de atenção (4%-7,5%)", () => {
    const pedidos = [
      ...Array.from({ length: 95 }, () => criarPedido({ status: "entregue" })),
      ...Array.from({ length: 5 }, () => criarPedido({ status: "devolvido" })),
    ];
    const resultado = calcularHealthScore({
      execucoes: [...Array.from({ length: 9 }, () => criarExecucao()), criarExecucao({ status: "falhou" })],
      tickets: [],
      conversas: [],
      pedidos,
      referencia: AGORA,
    });
    expect(resultado.taxaChargebackEDevolucao).toBeCloseTo(0.05, 2);
    expect(resultado.score).toBe(90); // 100 - 10
  });

  it("não penaliza quando a taxa de chargeback+devolução está saudável (<4%)", () => {
    const pedidos = [...Array.from({ length: 99 }, () => criarPedido({ status: "entregue" })), criarPedido({ status: "chargeback" })];
    const resultado = calcularHealthScore({
      execucoes: [...Array.from({ length: 9 }, () => criarExecucao()), criarExecucao({ status: "falhou" })],
      tickets: [],
      conversas: [],
      pedidos,
      referencia: AGORA,
    });
    expect(resultado.score).toBe(100);
  });
});
