// Simulador de Contingência Macro — Plano de Contingência Anticrise.
//
// Projeta, sobre um horizonte de planejamento, os dois lados já REAIS e
// calculados por `calcularRoi` para o período de referência: o "Custo de
// Inércia" (o que a empresa voltaria a pagar em custo humano se desistisse
// da automação — `custoHumanoEvitadoBrl`) contra o ganho líquido de caixa
// que a infraestrutura autônoma do AgentFlow já produz
// (`economiaLiquidaBrl`).
//
// Projeção deliberadamente LINEAR — "mantendo o ritmo do período de
// referência" — nunca uma curva de crescimento de mercado inventada: mesma
// regra de honestidade de `@/lib/roi` ("um painel que infla a economia com
// estimativas silenciosas destrói a confiança na primeira auditoria").

import type { RoiSnapshot } from "@/types";

export type HorizonteContingencia = 3 | 6 | 12;

export interface SimulacaoContingenciaInput {
  /** Snapshot já calculado para UM mês de referência (ver `periodoMesAtual`) — a projeção assume este ritmo mensal constante. */
  snapshot: RoiSnapshot;
  horizonteMeses: HorizonteContingencia;
}

export interface SimulacaoContingenciaResultado {
  horizonteMeses: HorizonteContingencia;
  /** Custo humano que precisaria voltar a existir, projetado — "o preço de não automatizar". */
  custoInerciaProjetadoBrl: number;
  /** Ganho líquido de caixa acumulado, mantendo a automação no ritmo do período de referência. */
  ganhoLiquidoProjetadoBrl: number;
  /** Horas humanas que precisariam voltar a existir — base da Blindagem de Passivo Trabalhista. */
  horasInerciaProjetadas: number;
}

/**
 * Projeta o Custo de Inércia e o ganho líquido de caixa sobre um horizonte
 * de meses, a partir de um snapshot mensal já calculado.
 *
 * Função pura: nenhuma leitura de rede, nenhuma suposição de crescimento —
 * apenas multiplicação pelo horizonte escolhido.
 */
export function simularContingenciaMacro(input: SimulacaoContingenciaInput): SimulacaoContingenciaResultado {
  const { snapshot, horizonteMeses } = input;

  return {
    horizonteMeses,
    custoInerciaProjetadoBrl: snapshot.custoHumanoEvitadoBrl * horizonteMeses,
    ganhoLiquidoProjetadoBrl: snapshot.economiaLiquidaBrl * horizonteMeses,
    horasInerciaProjetadas: snapshot.horasEconomizadasBrutas * horizonteMeses,
  };
}
