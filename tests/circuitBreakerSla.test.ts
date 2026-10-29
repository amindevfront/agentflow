import { describe, expect, it } from "vitest";
import type { Conversation, HandoffTicket } from "@/types";
import { construirTicket } from "@/lib/humanInTheLoop";
import { detectarCircuitBreakerPorSlaVencido } from "@/lib/inbox/firestore";

// SLA Rescue & Circuit Breaker — segundo gatilho (independente de
// frustração textual): um P1 vinculado a uma conversa que estourou o SLA
// deve congelar o bot e acionar o circuit breaker na própria conversa.

const REFERENCIA = new Date("2026-03-15T12:30:00.000Z");

function conversa(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv_1",
    workspaceId: "default",
    canal: "whatsapp",
    participante: { nome: "Cliente Teste", identificadorMascarado: "[[PII:TELEFONE:1]]" },
    assunto: "Cobrança indevida",
    status: "aberta",
    prioridade: "p1",
    atribuidoTipo: "agente",
    atribuidoId: "bot-1",
    atribuidoNome: "Bot de Atendimento",
    frustrationIndex: 10,
    frustrationTendencia: "estavel",
    circuitBreakerAtivo: false,
    ultimaMensagemPreview: "Ainda aguardando resposta...",
    ultimaMensagemEm: REFERENCIA.toISOString(),
    criadaEm: REFERENCIA.toISOString(),
    totalMensagens: 3,
    totalMensagensCliente: 2,
    ...overrides,
  };
}

/** Constrói um ticket P1 real (via `construirTicket`) cujo SLA já venceu há `minutosAtras` minutos. */
function ticketP1Vencido(minutosAtras: number, overrides: Partial<HandoffTicket> = {}): HandoffTicket {
  const criadoEm = new Date(REFERENCIA.getTime() - minutosAtras * 60_000);
  const ticket = construirTicket({
    solicitacao: {
      traceId: "inbox_msg_1",
      politicaId: "padrao",
      severidade: "critica", // critica + noCritico=false => p1 (ver derivarPrioridade)
      veredito: "transbordo",
      violacoes: [{ regra: "frustracao-critica", severidade: "critica", mensagem: "teste" }],
      payloadMascarado: "texto mascarado",
    },
    flowId: "conv_1",
    flowNome: "Conversa whatsapp",
    conversationId: "conv_1",
    motivoForcado: "frustracao-critica",
    agora: criadoEm,
    gerarId: () => "hitl_teste",
  });
  return { ...ticket, ...overrides };
}

describe("detectarCircuitBreakerPorSlaVencido", () => {
  it("detecta uma conversa cujo ticket P1 vinculado estourou o SLA (15 min)", () => {
    const pendentes = detectarCircuitBreakerPorSlaVencido(
      [conversa()],
      [ticketP1Vencido(20)],
      REFERENCIA
    );

    expect(pendentes).toEqual([{ conversationId: "conv_1", ticketId: "hitl_teste" }]);
  });

  it("não detecta nada quando o SLA do P1 ainda não venceu", () => {
    const pendentes = detectarCircuitBreakerPorSlaVencido(
      [conversa()],
      [ticketP1Vencido(5)],
      REFERENCIA
    );
    expect(pendentes).toEqual([]);
  });

  it("ignora tickets que não são P1", () => {
    const ticket = ticketP1Vencido(20, { prioridade: "p2" });
    const pendentes = detectarCircuitBreakerPorSlaVencido([conversa()], [ticket], REFERENCIA);
    expect(pendentes).toEqual([]);
  });

  it("ignora tickets já resolvidos ou cancelados, mesmo com SLA vencido", () => {
    const resolvido = ticketP1Vencido(20, { status: "resolvido" });
    const cancelado = ticketP1Vencido(20, { status: "cancelado" });
    const pendentes = detectarCircuitBreakerPorSlaVencido([conversa()], [resolvido, cancelado], REFERENCIA);
    expect(pendentes).toEqual([]);
  });

  it("não repete uma conversa já com circuit breaker ativo (idempotência)", () => {
    const pendentes = detectarCircuitBreakerPorSlaVencido(
      [conversa({ circuitBreakerAtivo: true })],
      [ticketP1Vencido(20)],
      REFERENCIA
    );
    expect(pendentes).toEqual([]);
  });

  it("ignora tickets sem conversationId (originados de um fluxo, não da Neural Inbox)", () => {
    const ticket = ticketP1Vencido(20);
    const { conversationId, ...semConversa } = ticket;
    void conversationId;
    const pendentes = detectarCircuitBreakerPorSlaVencido([conversa()], [semConversa as HandoffTicket], REFERENCIA);
    expect(pendentes).toEqual([]);
  });
});
