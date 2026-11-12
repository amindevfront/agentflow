import { describe, expect, it } from "vitest";
import type { SolicitacaoTransbordo } from "@/lib/guardrails";
import type { HandoffTicket, ResumoExecutivoB2B, ResumoExecutivoClinico, ResumoExecutivoHandoff } from "@/types";
import {
  SLA_MINUTOS,
  construirTicketAdmin,
  derivarMotivo,
  derivarPrioridade,
  slaRestanteMsAdmin,
  slaVioladoAdmin,
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

  it("mapeia a Proteção de Caixa (preco-comercial-nao-autorizado) para preco-nao-autorizado", () => {
    expect(
      derivarMotivo(
        [{ regra: "preco-comercial-nao-autorizado", severidade: "critica", mensagem: "" }],
        "bloqueado"
      )
    ).toBe("preco-nao-autorizado");
  });

  it("mapeia o Guardrail Clínico/Ético (diagnostico-ou-resultado-nao-autorizado) para diagnostico-nao-autorizado", () => {
    expect(
      derivarMotivo(
        [{ regra: "diagnostico-ou-resultado-nao-autorizado", severidade: "critica", mensagem: "" }],
        "bloqueado"
      )
    ).toBe("diagnostico-nao-autorizado");
  });

  it("mapeia o Guardrail Ético-Profissional (garantia-exito-nao-autorizada) para exito-nao-autorizado", () => {
    expect(
      derivarMotivo(
        [{ regra: "garantia-exito-nao-autorizada", severidade: "critica", mensagem: "" }],
        "bloqueado"
      )
    ).toBe("exito-nao-autorizado");
  });

  it("mapeia o Motor de Pre-Deal Compliance & Margin Guard para risco-fiscal-margem-nao-autorizado", () => {
    expect(
      derivarMotivo(
        [{ regra: "informalidade-fiscal-nao-autorizada", severidade: "critica", mensagem: "" }],
        "bloqueado"
      )
    ).toBe("risco-fiscal-margem-nao-autorizado");
    expect(
      derivarMotivo(
        [{ regra: "desconto-acima-limite-sem-aprovacao", severidade: "critica", mensagem: "" }],
        "bloqueado"
      )
    ).toBe("risco-fiscal-margem-nao-autorizado");
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

  it("carrega resumoExecutivo quando informado (Handoff com Resumo Executivo Mastigado) e o omite quando ausente", () => {
    const resumoExecutivo: ResumoExecutivoHandoff = {
      nome: "Marina",
      faixaOrcamento: "até 1,5 milhão",
      imovelInteresse: "cobertura",
      objecaoMapeada: null,
    };

    const comResumo = construirTicketAdmin({
      solicitacao: solicitacao({ severidade: "media" }),
      flowId: "conv-widget-2",
      flowNome: "Contato via Web Widget",
      workspaceId: "ws-1",
      criadoPor: "sistema",
      conversationId: "conv-widget-2",
      motivoForcado: "agendamento-visita-presencial",
      resumoExecutivo,
      agora: AGORA,
    });
    expect(comResumo.resumoExecutivo).toEqual(resumoExecutivo);

    const semResumo = construirTicketAdmin({
      solicitacao: solicitacao({ severidade: "media" }),
      flowId: "flow-1",
      flowNome: "Faturamento",
      workspaceId: "ws-1",
      criadoPor: "sistema",
      agora: AGORA,
    });
    expect(semResumo.resumoExecutivo).toBeUndefined();
  });

  it("carrega resumoExecutivoClinico quando informado (Handoff com Resumo Executivo Clínico) e o omite quando ausente", () => {
    const resumoExecutivoClinico: ResumoExecutivoClinico = {
      nome: "Carla",
      queixaPrincipal: "harmonização facial",
      historicoResumido: "já fez botox antes",
      objecaoMapeada: null,
    };

    const comResumo = construirTicketAdmin({
      solicitacao: solicitacao({ severidade: "media" }),
      flowId: "conv-widget-3",
      flowNome: "Contato via Web Widget",
      workspaceId: "ws-1",
      criadoPor: "sistema",
      conversationId: "conv-widget-3",
      motivoForcado: "confirmacao-agendamento-clinico",
      resumoExecutivoClinico,
      agora: AGORA,
    });
    expect(comResumo.resumoExecutivoClinico).toEqual(resumoExecutivoClinico);

    const semResumo = construirTicketAdmin({
      solicitacao: solicitacao({ severidade: "media" }),
      flowId: "flow-1",
      flowNome: "Faturamento",
      workspaceId: "ws-1",
      criadoPor: "sistema",
      agora: AGORA,
    });
    expect(semResumo.resumoExecutivoClinico).toBeUndefined();
  });

  it("carrega resumoExecutivoB2B quando informado (Handoff com Resumo Executivo B2B) e o omite quando ausente", () => {
    const resumoExecutivoB2B: ResumoExecutivoB2B = {
      nome: "Ricardo",
      perfilLead: "Pessoa jurídica",
      porteCaso: "Startup",
      objetivoMapeado: "due diligence",
    };

    const comResumo = construirTicketAdmin({
      solicitacao: solicitacao({ severidade: "media" }),
      flowId: "conv-widget-4",
      flowNome: "Contato via Web Widget",
      workspaceId: "ws-1",
      criadoPor: "sistema",
      conversationId: "conv-widget-4",
      motivoForcado: "confirmacao-reuniao-diagnostico-b2b",
      resumoExecutivoB2B,
      agora: AGORA,
    });
    expect(comResumo.resumoExecutivoB2B).toEqual(resumoExecutivoB2B);

    const semResumo = construirTicketAdmin({
      solicitacao: solicitacao({ severidade: "media" }),
      flowId: "flow-1",
      flowNome: "Faturamento",
      workspaceId: "ws-1",
      criadoPor: "sistema",
      agora: AGORA,
    });
    expect(semResumo.resumoExecutivoB2B).toBeUndefined();
  });
});

describe("slaRestanteMsAdmin / slaVioladoAdmin (servidor) — paridade com o cliente", () => {
  function ticketComSla(slaExpiraEm: string, status: HandoffTicket["status"] = "aberto"): HandoffTicket {
    const base = construirTicketAdmin({
      solicitacao: solicitacao(),
      flowId: "flow-1",
      flowNome: "Faturamento",
      workspaceId: "ws-1",
      criadoPor: "sistema",
      agora: AGORA,
    });
    return { ...base, slaExpiraEm, status };
  }

  it("calcula milissegundos restantes positivos antes do vencimento e negativos depois", () => {
    const ticket = ticketComSla(new Date(AGORA.getTime() + 60_000).toISOString());

    expect(slaRestanteMsAdmin(ticket, AGORA)).toBe(60_000);
    expect(slaRestanteMsAdmin(ticket, new Date(AGORA.getTime() + 120_000))).toBe(-60_000);
  });

  it("considera violado apenas quando o prazo venceu e o ticket ainda está em aberto/em-análise", () => {
    const vencido = ticketComSla(new Date(AGORA.getTime() - 1_000).toISOString());

    expect(slaVioladoAdmin(vencido, AGORA)).toBe(true);
    expect(slaVioladoAdmin({ ...vencido, status: "resolvido" }, AGORA)).toBe(false);
    expect(slaVioladoAdmin({ ...vencido, status: "cancelado" }, AGORA)).toBe(false);
    expect(slaVioladoAdmin({ ...vencido, status: "em-analise" }, AGORA)).toBe(true);
  });

  it("nunca considera violado antes do prazo", () => {
    const dentroDoPrazo = ticketComSla(new Date(AGORA.getTime() + 1_000).toISOString());
    expect(slaVioladoAdmin(dentroDoPrazo, AGORA)).toBe(false);
  });
});
