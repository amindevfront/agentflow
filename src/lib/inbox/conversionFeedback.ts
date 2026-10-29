// Auto-Feedback de Conversão — a IA aprende com o negócio.
//
// Pipeline, em ordem:
//   1. o operador registra o desfecho comercial ao concluir o atendimento
//      (`Conversation.desfechoConversao`, via `registrarDesfechoConversao`
//      em `@/lib/inbox/firestore`);
//   2. este módulo agrega os desfechos do workspace (função pura, sem
//      Firestore) e gera um texto de contexto determinístico;
//   3. esse texto é persistido em `Workspace.insightsConversaoTexto` — o
//      "parâmetro contextual do workspace";
//   4. `montarPrompt` (`@/lib/server/orchestrator`) injeta esse texto na
//      próxima chamada de IA do MESMO workspace/nicho.
//
// Honestidade do número (mesma regra de `@/lib/roi` e
// `@/lib/inbox/revenueRescue`): nenhuma recomendação é inventada além do que
// os próprios desfechos sustentam — sem amostra suficiente, nenhum texto é
// gerado (`null`), em vez de uma recomendação genérica sem base.

import type { Conversation } from "@/types";

/** Abaixo deste total de desfechos registrados, uma recomendação específica seria estatisticamente vazia. */
const MINIMO_AMOSTRAS_PARA_RECOMENDACAO = 3;

/** Fração de perdas por um motivo específico a partir da qual ele se torna o padrão dominante, digno de recomendação. */
const LIMIAR_MOTIVO_DOMINANTE = 0.4;

export interface InsightsConversao {
  totalComDesfecho: number;
  fechado: number;
  perdidoPreco: number;
  perdidoSemAgenda: number;
  /** Fração de fechamento sobre o total COM desfecho registrado (0..1). */
  taxaFechamento: number;
  /** Fração de perda por preço sobre o total COM desfecho registrado (0..1). */
  taxaPerdaPorPreco: number;
  /** Fração de perda por falta de agenda sobre o total COM desfecho registrado (0..1). */
  taxaPerdaPorAgenda: number;
}

/**
 * Agrega os desfechos de conversão de um conjunto de conversas.
 *
 * Função pura — mesma garantia de `calcularRoi`: dado o mesmo input, o
 * resultado é sempre idêntico e auditável. Conversas sem desfecho registrado
 * (`undefined`/`null`) não entram no total, por desenho: elas ainda não
 * informam nada sobre taxa de fechamento.
 */
export function calcularInsightsConversao(conversas: Conversation[]): InsightsConversao {
  let fechado = 0;
  let perdidoPreco = 0;
  let perdidoSemAgenda = 0;

  for (const conversa of conversas) {
    switch (conversa.desfechoConversao) {
      case "fechado-venda":
        fechado += 1;
        break;
      case "perdido-preco":
        perdidoPreco += 1;
        break;
      case "perdido-sem-agenda":
        perdidoSemAgenda += 1;
        break;
      default:
        break;
    }
  }

  const totalComDesfecho = fechado + perdidoPreco + perdidoSemAgenda;

  return {
    totalComDesfecho,
    fechado,
    perdidoPreco,
    perdidoSemAgenda,
    taxaFechamento: totalComDesfecho > 0 ? fechado / totalComDesfecho : 0,
    taxaPerdaPorPreco: totalComDesfecho > 0 ? perdidoPreco / totalComDesfecho : 0,
    taxaPerdaPorAgenda: totalComDesfecho > 0 ? perdidoSemAgenda / totalComDesfecho : 0,
  };
}

/**
 * Gera o texto de contexto injetado em `Workspace.insightsConversaoTexto`.
 *
 * `null` sem nenhum desfecho registrado — um contexto vazio não deveria ser
 * gravado como se fosse informação. Recomendações específicas só aparecem
 * com amostra mínima E um motivo claramente dominante; caso contrário, o
 * texto se limita ao resumo numérico, sem inventar causa.
 */
export function gerarContextoConversaoIA(insights: InsightsConversao, nicheLabel: string): string | null {
  if (insights.totalComDesfecho === 0) return null;

  const partes = [
    `Histórico de conversão em ${nicheLabel} (${insights.totalComDesfecho} atendimento(s) com desfecho registrado): ` +
      `${Math.round(insights.taxaFechamento * 100)}% fechados, ` +
      `${Math.round(insights.taxaPerdaPorPreco * 100)}% perdidos por preço, ` +
      `${Math.round(insights.taxaPerdaPorAgenda * 100)}% perdidos por falta de agenda.`,
  ];

  if (insights.totalComDesfecho >= MINIMO_AMOSTRAS_PARA_RECOMENDACAO) {
    if (insights.taxaPerdaPorPreco >= LIMIAR_MOTIVO_DOMINANTE) {
      partes.push(
        "Recomendação: reforce o valor entregue antes de apresentar preço — perda por preço é o motivo dominante recente."
      );
    } else if (insights.taxaPerdaPorAgenda >= LIMIAR_MOTIVO_DOMINANTE) {
      partes.push(
        "Recomendação: ofereça horários alternativos mais cedo na conversa — falta de agenda é o motivo dominante recente de perda."
      );
    }
  }

  return partes.join(" ");
}
