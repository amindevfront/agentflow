import { describe, expect, it } from "vitest";
import type { Conversation, ConversionOutcome } from "@/types";
import { calcularInsightsConversao, gerarContextoConversaoIA } from "@/lib/inbox/conversionFeedback";

function conversa(desfecho: ConversionOutcome | null, id: string): Conversation {
  return {
    id,
    workspaceId: "default",
    canal: "whatsapp",
    participante: { nome: "Cliente Teste", identificadorMascarado: "[[PII:TELEFONE:1]]" },
    assunto: "Orçamento",
    status: "resolvida",
    prioridade: "p3",
    atribuidoTipo: "humano",
    frustrationIndex: 0,
    frustrationTendencia: "estavel",
    circuitBreakerAtivo: false,
    desfechoConversao: desfecho,
    ultimaMensagemPreview: "",
    ultimaMensagemEm: "2026-03-15T12:00:00.000Z",
    criadaEm: "2026-03-15T12:00:00.000Z",
    totalMensagens: 1,
    totalMensagensCliente: 1,
  };
}

describe("calcularInsightsConversao", () => {
  it("devolve zeros quando nenhuma conversa tem desfecho registrado", () => {
    const insights = calcularInsightsConversao([conversa(null, "c1"), conversa(null, "c2")]);
    expect(insights.totalComDesfecho).toBe(0);
    expect(insights.taxaFechamento).toBe(0);
  });

  it("agrega corretamente os três desfechos possíveis", () => {
    const insights = calcularInsightsConversao([
      conversa("fechado-venda", "c1"),
      conversa("fechado-venda", "c2"),
      conversa("perdido-preco", "c3"),
      conversa("perdido-sem-agenda", "c4"),
      conversa(null, "c5"), // sem desfecho — não entra no total
    ]);

    expect(insights.totalComDesfecho).toBe(4);
    expect(insights.fechado).toBe(2);
    expect(insights.perdidoPreco).toBe(1);
    expect(insights.perdidoSemAgenda).toBe(1);
    expect(insights.taxaFechamento).toBe(0.5);
    expect(insights.taxaPerdaPorPreco).toBe(0.25);
    expect(insights.taxaPerdaPorAgenda).toBe(0.25);
  });
});

describe("gerarContextoConversaoIA", () => {
  it("devolve null quando não há nenhum desfecho registrado — nunca um texto vazio fingindo ser contexto", () => {
    const insights = calcularInsightsConversao([]);
    expect(gerarContextoConversaoIA(insights, "Clínica de Alto Padrão")).toBeNull();
  });

  it("resume os números sem recomendação quando a amostra é pequena demais", () => {
    const insights = calcularInsightsConversao([conversa("perdido-preco", "c1"), conversa("perdido-preco", "c2")]);
    const texto = gerarContextoConversaoIA(insights, "Clínica de Alto Padrão");

    expect(texto).toContain("Clínica de Alto Padrão");
    expect(texto).toContain("2 atendimento(s)");
    expect(texto).not.toContain("Recomendação");
  });

  it("recomenda reforçar valor quando perda por preço domina com amostra suficiente", () => {
    const insights = calcularInsightsConversao([
      conversa("perdido-preco", "c1"),
      conversa("perdido-preco", "c2"),
      conversa("fechado-venda", "c3"),
    ]);
    const texto = gerarContextoConversaoIA(insights, "E-commerce");

    expect(texto).toContain("Recomendação: reforce o valor entregue");
  });

  it("recomenda oferecer horários quando perda por falta de agenda domina com amostra suficiente", () => {
    const insights = calcularInsightsConversao([
      conversa("perdido-sem-agenda", "c1"),
      conversa("perdido-sem-agenda", "c2"),
      conversa("fechado-venda", "c3"),
    ]);
    const texto = gerarContextoConversaoIA(insights, "Clínica de Alto Padrão");

    expect(texto).toContain("Recomendação: ofereça horários alternativos");
  });

  it("não recomenda nada quando o fechamento domina — não há motivo de perda a corrigir", () => {
    const insights = calcularInsightsConversao([
      conversa("fechado-venda", "c1"),
      conversa("fechado-venda", "c2"),
      conversa("fechado-venda", "c3"),
    ]);
    const texto = gerarContextoConversaoIA(insights, "E-commerce");

    expect(texto).not.toContain("Recomendação");
  });
});
