// Tipos do motor de ROI e métricas financeiras.

export type Moeda = "BRL" | "USD" | "GBP";

/**
 * Regime de encargos usado para decompor o custo humano evitado.
 * - `clt-br`: INSS patronal, FGTS, 13º, férias, provisão de rescisão.
 * - `payroll-us-uk`: FICA patronal, FUTA/SUTA, workers' comp, benefícios e
 *   overhead de BPO (call center terceirizado) — ver `ComposicaoCustoPayroll`.
 *
 * As DUAS decomposições são sempre calculadas em `calcularRoi`, independente
 * deste campo — ele só escolhe qual lente o painel mostra por padrão.
 * Trocar o regime nunca recalcula nem descarta histórico: ambas as visões
 * derivam do mesmo `custoHumanoEvitadoBrl`.
 */
export type RegimeEncargos = "clt-br" | "payroll-us-uk";

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
 * Decomposição do custo-hora "totalmente carregado" (`custoHoraOperadorBrl`)
 * nos componentes do encargo patronal CLT — o que permite ao painel de OpEx
 * mostrar não só "quanto foi economizado", mas "em que isso se traduziria se
 * fosse um funcionário CLT": salário base vs. INSS patronal, FGTS, 13º,
 * férias e provisão de rescisão.
 *
 * Cada campo é um percentual (0..1) do custo-hora total. A soma dos cinco
 * encargos é subtraída de 1 para obter o percentual de salário base — por
 * isso não há um campo `percentualSalarioBase` separado, o que evitaria os
 * dois números divergirem.
 *
 * Os valores padrão (`COMPOSICAO_CLT_PADRAO`, em `@/lib/roi`) refletem uma
 * estimativa de referência do regime geral (CLT, sem Simples Nacional) —
 * documentada ali, não codificada como fato. Cada workspace deve ajustar ao
 * seu próprio regime tributário.
 */
export interface ComposicaoCustoClt {
  percentualInssPatronal: number;
  percentualFgts: number;
  percentualDecimoTerceiro: number;
  percentualFerias: number;
  percentualProvisaoRescisao: number;
}

/**
 * Decomposição equivalente de `ComposicaoCustoClt`, para operações em
 * regime de Payroll Tax dos EUA/Reino Unido (empregado W2 ou atendimento
 * terceirizado via BPO/call center). Mesma regra: cada campo é um percentual
 * (0..1) do custo-hora total; o residual é salário base.
 *
 * Valores padrão (`COMPOSICAO_PAYROLL_PADRAO`, em `@/lib/roi`) são estimativa
 * de referência (FICA patronal tem base legal — 7,65% —, os demais são
 * médias de mercado), documentada ali, não um dado fiscal fechado. Workers
 * classificados como 1099 (contractor) não têm a maior parte destes
 * encargos — o preset assume W2 por ser o caso que de fato gera passivo.
 */
export interface ComposicaoCustoPayroll {
  /** Social Security (6,2%) + Medicare (1,45%) — parte patronal, base legal nos EUA. */
  percentualFicaPatronal: number;
  /** FUTA (federal) + SUTA (estadual) — seguro-desemprego, média combinada. */
  percentualFutaSuta: number;
  /** Workers' compensation insurance. */
  percentualWorkersComp: number;
  /** Benefícios (saúde, dental, aposentadoria) — carga patronal típica de SMB. */
  percentualBeneficios: number;
  /** Overhead de gestão de BPO/call center terceirizado, quando aplicável. */
  percentualBpoOverhead: number;
}

/**
 * Parâmetros econômicos do workspace. Persistido em
 * `workspaces/{id}.roiConfig` e editável por administradores.
 */
export interface RoiConfig {
  /** Custo total por hora de um operador humano (salário + encargos + overhead). */
  custoHoraOperadorBrl: number;
  /** Decomposição do custo-hora acima em componentes de encargo CLT. */
  composicaoClt: ComposicaoCustoClt;
  /** Decomposição equivalente em Payroll Tax (EUA/Reino Unido). */
  composicaoPayroll: ComposicaoCustoPayroll;
  /** Lente padrão de exibição do Tax Shield — não afeta o cálculo, só a visão inicial. */
  regimeEncargos: RegimeEncargos;
  /** Taxa de conversão GBP → BRL, para exibição em libras. */
  cambioGbpBrl: number;
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

  // (Tax Shield) Decomposição de `custoHumanoEvitadoBrl` nos componentes do
  // encargo patronal CLT, via `composicaoClt` — ver `ComposicaoCustoClt`.
  salarioBaseEvitadoBrl: number;
  encargosInssBrl: number;
  encargosFgtsBrl: number;
  encargosDecimoTerceiroBrl: number;
  encargosFeriasBrl: number;
  encargosProvisaoRescisaoBrl: number;
  /** Soma dos cinco encargos acima — NÃO inclui o salário base. */
  encargosTotaisBrl: number;

  // (Dual-Region Tax Shield) Mesma decomposição acima, na lente Payroll
  // Tax EUA/Reino Unido — SEMPRE calculada a partir do mesmo
  // `custoHumanoEvitadoBrl`, em paralelo à decomposição CLT. Nenhum
  // histórico é perdido ao trocar `regimeEncargos`: as duas lentes convivem.
  salarioBaseEvitadoPayrollBrl: number;
  encargosFicaBrl: number;
  encargosFutaSutaBrl: number;
  encargosWorkersCompBrl: number;
  encargosBeneficiosBrl: number;
  encargosBpoOverheadBrl: number;
  encargosTotaisPayrollBrl: number;

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
