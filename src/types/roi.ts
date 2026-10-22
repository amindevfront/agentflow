// Tipos do motor de ROI e métricas financeiras.

export type Moeda = "BRL" | "USD";

/**
 * Preço de um modelo em USD por 1 milhão de tokens.
 * Mantido como dado de configuração (não constante de código) porque tabelas de
 * preço mudam e o AgentFlow é agnóstico de provedor.
 */
export interface ModelPricing {
  modelo: string;
  entradaUsdPorMilhao: number;
  saidaUsdPorMilhao: number;
}

/**
 * Parâmetros econômicos do workspace. Persistido em
 * `workspaces/{id}.roiConfig` e editável por administradores.
 */
export interface RoiConfig {
  /** Custo total por hora de um operador humano (salário + encargos + overhead). */
  custoHoraOperadorBrl: number;
  /** Minutos que um humano gastaria para executar manualmente um fluxo. */
  minutosManuaisPorExecucao: number;
  /** Minutos consumidos por um operador em cada transbordo (custo da revisão). */
  minutosRevisaoHumana: number;
  /** Minutos que um humano gastaria para atender manualmente uma conversa resolvida na Neural Inbox. */
  minutosManuaisPorConversa: number;
  /** Minutos que um humano gastaria para disparar manualmente um envio de campanha. */
  minutosManuaisPorEnvioCampanha: number;
  /** Taxa de conversão USD → BRL aplicada aos custos de token. */
  cambioUsdBrl: number;
  /** Custo fixo mensal da plataforma, usado no ROI líquido. */
  custoPlataformaMensalBrl: number;
  moedaExibicao: Moeda;
  /** Preço do modelo usado como padrão quando a execução não informa custo. */
  precoModeloPadrao: ModelPricing;
}

/**
 * Métricas de custo de uma execução, gravadas pelo motor de orquestração.
 * Opcional em `FlowRun`: execuções legadas simplesmente não contribuem para
 * os agregados de custo, sem quebrar o cálculo.
 */
export interface RunCostMetrics {
  tokensEntrada: number;
  tokensSaida: number;
  /** Custo real reportado pelo provedor. Preferido sobre a estimativa. */
  custoModeloUsd?: number;
  /** Sobrescreve `minutosManuaisPorExecucao` para este fluxo específico. */
  minutosManuaisEvitados?: number;
  /** `true` quando a execução precisou de transbordo — quebra o zero-touch. */
  intervencaoHumana?: boolean;
  modelo?: string;
  concluidoEm?: string;
}

export interface RoiPeriodo {
  inicio: string;
  fim: string;
  rotulo: string;
}

export interface RoiSnapshot {
  // Volume — unificado: fluxos (FlowRun) + conversas da Neural Inbox +
  // envios de campanha, todos contribuindo para a MESMA pergunta de negócio
  // ("quanto trabalho a automação completou, e quanto isso economizou").
  // `execucoesTotais`/`execucoesConcluidas`/etc. preservam o nome histórico
  // (contrato já em produção, cobrindo o painel e os testes existentes) —
  // os campos abaixo, em "Inbox omnichannel" e "Campanhas", dão o detalhamento
  // por origem para quem precisa do drill-down.
  execucoesTotais: number;
  execucoesConcluidas: number;
  execucoesFalhas: number;
  execucoesEmAndamento: number;
  execucoesComIntervencao: number;

  // (a) Horas humanas economizadas
  horasEconomizadasBrutas: number;
  horasGastasEmRevisao: number;
  horasEconomizadasLiquidas: number;

  // (b) Redução de OpEx
  custoHumanoEvitadoBrl: number;
  custoIaBrl: number;
  custoRevisaoHumanaBrl: number;
  custoPlataformaBrl: number;
  economiaLiquidaBrl: number;
  /** Economia líquida ÷ custo humano evitado (0..1). */
  reducaoOpexPercentual: number;
  custoPorExecucaoBrl: number;
  /** Retorno sobre o investimento: economia líquida ÷ custo total da automação. */
  roiPercentual: number;

  // (c) Autonomia
  /** Execuções concluídas sem nenhuma intervenção humana ÷ execuções terminais. */
  taxaZeroTouch: number;
  taxaSucesso: number;

  // Insumos
  tokensEntrada: number;
  tokensSaida: number;
  tokensTotais: number;
  /** Execuções sem métricas de custo — mede a confiança do snapshot. */
  execucoesSemTelemetria: number;
  cobertura: number;

  // Inbox omnichannel — drill-down das conversas que contribuíram acima.
  conversasTotais: number;
  conversasResolvidas: number;
  /** Conversas em que o circuit breaker de frustração chegou a disparar. */
  conversasComFrustracaoCritica: number;
  mensagensProcessadas: number;

  // Campanhas — drill-down dos envios que contribuíram acima.
  campanhasExecutadas: number;
  enviosCampanhaRealizados: number;
  enviosCampanhaBloqueados: number;

  periodo: RoiPeriodo;
  moeda: Moeda;
  atualizadoEm: string;
}
