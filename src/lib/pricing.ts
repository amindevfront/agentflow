// Tabela de preços de referência e estimativa de custo de tokens — puro.
//
// Isomórfico por desenho: usado pelo motor de ROI no cliente (`@/lib/roi`,
// que o reexporta por compatibilidade) e pelo motor de orquestração no
// servidor (`@/lib/server/orchestratorAdmin`), sem que nenhum dos dois lados
// precise importar o SDK de cliente do Firebase só para obter uma tabela de
// preços e uma multiplicação. Extraído deliberadamente para fora de
// `@/lib/roi` (que importa `firebase/firestore` para suas funções de
// assinatura/persistência) — um módulo server-only nunca deveria arrastar o
// SDK de cliente do Firebase para dentro do bundle do servidor só por causa
// de um import transitivo não relacionado.

import type { ModelPricing } from "@/types";

/**
 * Tabela de preços de referência, em USD por 1 milhão de tokens.
 *
 * É um *default*, não uma verdade fixa: tabelas de preço mudam e o AgentFlow é
 * agnóstico de provedor. `RoiConfig.precoModeloPadrao` sobrepõe estes valores, e
 * execuções que reportam `custoModeloUsd` real sempre têm precedência sobre
 * qualquer estimativa.
 */
export const PRECOS_REFERENCIA: Record<string, ModelPricing> = {
  "claude-opus-5": { modelo: "claude-opus-5", entradaUsdPorMilhao: 5, saidaUsdPorMilhao: 25 },
  "claude-sonnet-5": { modelo: "claude-sonnet-5", entradaUsdPorMilhao: 2, saidaUsdPorMilhao: 10 },
  "claude-haiku-4-5": { modelo: "claude-haiku-4-5", entradaUsdPorMilhao: 1, saidaUsdPorMilhao: 5 },
};

/** Estima o custo em USD de uma execução a partir da contagem de tokens. */
export function estimarCustoModeloUsd(
  tokensEntrada: number,
  tokensSaida: number,
  preco: ModelPricing
): number {
  const entrada = Math.max(0, tokensEntrada) / 1_000_000;
  const saida = Math.max(0, tokensSaida) / 1_000_000;
  return entrada * preco.entradaUsdPorMilhao + saida * preco.saidaUsdPorMilhao;
}
