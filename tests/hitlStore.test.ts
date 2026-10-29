import { describe, expect, it } from "vitest";
import type { SolicitacaoTransbordo } from "@/lib/guardrails";
import {
  SLA_MINUTOS,
  construirTicketAdmin,
  derivarMotivo,
  derivarPrioridade,
} from "@/lib/server/hitlStore";

// Mesmas expectativas de `tests/governance.test.ts` para o módulo cliente
// (`@/lib/humanInTheLoop`) — os dois lados precisam concordar exatamente,
// porque o operador vê tickets abertos por ambos os caminhos na mesma fila.

const AGORA = new Date("2026-03-15T12:00:00.000Z");

function solicitacao(parcial: Partial<SolicitacaoTransbordo> = {}): SolicitacaoTransbordo {
  return {
    traceId: "gr_teste",
    politicaId: "padrao",
    severidade: "alta",
    veredito: "transbordo",
    violacoes: [{ regra: "pii-vazamento-saida", severidade: "alta", mensagem: "vazamento" }],
    payloadMascarado: "{}",
    ...parcial,
  };
}

describe("derivarPrioridade (servidor) — paridade com o cliente", () => {
  it("mapeia severidade em prioridade", () => {
    expect(derivarPrioridade("critica", false)).toBe("p1");
    expect(derivarPrioridade("alta", false)).toBe("p2");
    expect(derivarPrioridade("media", false)).toBe("p3");
    expect(derivarPrioridade("info", false)).toBe("p4");
  });

  it("eleva um nível quando o nó é crítico, sem passar de p1", () => {
    expect(derivarPrioridade("alta", true)).toBe("p1");
    expect(derivarPrioridade("critica", true)).toBe("p1");
  });
});

describe("derivarMotivo (servidor) — paridade com o cliente", () => {
  it("prioriza o motivo mais específico disponível", () => {
    expect(derivarMotivo([{ regra: "loop-ciclo-no", severidade: "critica", mensagem: "" }], "bloqueado")).toBe(
      "loop-detectado"
    );
    expect(derivarMotivo([{ regra: "segredo-em-payload", severidade: "critica", mensagem: "" }], "bloqueado")).toBe(
      "pii-sensivel"
    );
    expect(derivarMotivo([], "bloqueado")).toBe("guardrail-bloqueio");
    expect(derivarMotivo([], "transbordo")).toBe("guardrail-revisao");
  });
});

describe("construirTicketAdmin", () => {
  it("calcula o SLA a partir da prioridade e nunca copia dado em claro", () => {
    const ticket = construirTicketAdmin({
      solicitacao: solicitacao({ severidade: "critica", payloadMascarado: "cpf: [[PII:CPF:1]]" }),
      flowId: "flow-1",
      flowNome: "Faturamento",
      workspaceId: "ws-1",
      criadoPor: "sistema",
      agora: AGORA,
      gerarId: () => "hitl_fixo",
    });

    expect(ticket.id).toBe("hitl_fixo");
    expect(ticket.prioridade).toBe("p1");
    expect(ticket.status).toBe("aberto");
    expect(new Date(ticket.slaExpiraEm).getTime() - AGORA.getTime()).toBe(SLA_MINUTOS.p1 * 60_000);
    expect(ticket.payloadMascarado).toBe("cpf: [[PII:CPF:1]]");
    expect(JSON.stringify(ticket)).not.toContain("529.982.247-25");
  });

  it("eleva a prioridade quando o chamador marca o nó como crítico", () => {
    const ticket = construirTicketAdmin({
      solicitacao: solicitacao({ severidade: "media" }),
      flowId: "flow-1",
      flowNome: "Faturamento",
      workspaceId: "ws-1",
      criadoPor: "sistema",
      noCritico: true,
      agora: AGORA,
    });
    expect(ticket.prioridade).toBe("p2");
  });

  it("carrega conversationId e respeita motivoForcado — paridade com o Circuit Breaker da Neural Inbox (inclusive Web Widget)", () => {
    const ticket = construirTicketAdmin({
      solicitacao: solicitacao({ severidade: "critica" }),
      flowId: "conv-widget-1",
      flowNome: "Contato via Web Widget",
      workspaceId: "ws-1",
      criadoPor: "sistema",
      conversationId: "conv-widget-1",
      motivoForcado: "frustracao-critica",
      agora: AGORA,
    });

    expect(ticket.conversationId).toBe("conv-widget-1");
    expect(ticket.motivo).toBe("frustracao-critica");
  });
});
