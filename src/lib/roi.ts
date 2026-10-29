// Motor de ROI e métricas financeiras.
//
// `calcularRoi` é uma função pura: recebe execuções, tickets e configuração, e
// devolve o snapshot. Nenhuma chamada de rede, nenhuma leitura de relógio além
// do parâmetro `referencia`. Isso é condição para que um número financeiro
// mostrado ao cliente seja auditável — dado o mesmo input, o resultado é sempre
// o mesmo, e cada valor pode ser reconferido manualmente.
//
// Honestidade do número é regra de produto aqui: execuções sem telemetria de
// custo não entram nos agregados financeiros, e o campo `cobertura` informa que
// fração dos dados sustenta o resultado. Um painel de ROI que infla a economia
// com estimativas silenciosas destrói a confiança na primeira auditoria.

import { doc, getDoc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import type {
  Campaign,
  ComposicaoCustoClt,
  ComposicaoCustoPayroll,
  Conversation,
  FlowRun,
  HandoffTicket,
  Moeda,
  RegimeEncargos,
  RoiConfig,
  RoiPeriodo,
  RoiSnapshot,
} from "@/types";
import { db } from "./firebase";
import { DEFAULT_WORKSPACE_ID, requireDb } from "./firestore";
import { PRECOS_REFERENCIA, estimarCustoModeloUsd } from "./pricing";

// Reexportados por compatibilidade: a tabela de preços e o estimador de custo
// vivem em `@/lib/pricing` (puro, sem o SDK de cliente do Firebase) desde que
// o motor de orquestração no servidor (`@/lib/server/orchestratorAdmin`)
// passou a precisar deles sem arrastar `firebase/firestore` para o bundle do
// servidor. Nenhum comportamento muda para quem já importava daqui.
export { PRECOS_REFERENCIA, estimarCustoModeloUsd };

/**
 * Decomposição padrão do custo-hora em encargos CLT — estimativa de
 * referência do regime geral (empregador fora do Simples Nacional), NÃO uma
 * tabela fiscal oficial embutida como fato:
 *
 *  - INSS patronal: 20% sobre a folha (regime geral);
 *  - FGTS: 8% mensal;
 *  - 13º salário: 1/12 do salário ≈ 8,33%;
 *  - Férias + 1/3 constitucional: (1/12 + 1/3 de 1/12) ≈ 11,11%;
 *  - Provisão de rescisão: multa de 40% sobre o FGTS depositado (40% × 8%) = 3,2%.
 *
 * Some os cinco e restam ~49,4% do custo-hora como salário base — a outra
 * metade é o "Tax Shield" que o painel de OpEx expõe. Cada workspace com
 * regime tributário diferente (ex.: Simples Nacional, que recolhe o INSS
 * patronal dentro de uma alíquota única) deve recalibrar estes percentuais.
 */
export const COMPOSICAO_CLT_PADRAO: ComposicaoCustoClt = {
  percentualInssPatronal: 0.2,
  percentualFgts: 0.08,
  percentualDecimoTerceiro: 0.0833,
  percentualFerias: 0.1111,
  percentualProvisaoRescisao: 0.032,
};

/**
 * Decomposição padrão em Payroll Tax EUA/Reino Unido — estimativa de
 * referência, não tabela fiscal oficial:
 *
 *  - FICA patronal: 7,65% (Social Security 6,2% + Medicare 1,45% — base legal fixa nos EUA);
 *  - FUTA/SUTA (seguro-desemprego federal + estadual, média combinada): 3%;
 *  - Workers' compensation: 1,5%;
 *  - Benefícios (saúde, dental, aposentadoria, carga típica de SMB): 12%;
 *  - Overhead de BPO/call center terceirizado: 8%.
 *
 * Soma ≈ 32,15% do custo-hora — o residual (~67,85%) é salário base. Cada
 * workspace deve recalibrar ao seu próprio arranjo (W2 próprio vs. BPO).
 */
export const COMPOSICAO_PAYROLL_PADRAO: ComposicaoCustoPayroll = {
  percentualFicaPatronal: 0.0765,
  percentualFutaSuta: 0.03,
  percentualWorkersComp: 0.015,
  percentualBeneficios: 0.12,
  percentualBpoOverhead: 0.08,
};

export const ROI_CONFIG_PADRAO: RoiConfig = {
  // Custo-hora totalmente carregado de um analista de operações no Brasil
  // (salário + encargos + benefícios + overhead). Valor de partida conservador;
  // cada workspace ajusta ao seu próprio custo real.
  custoHoraOperadorBrl: 62,
  composicaoClt: COMPOSICAO_CLT_PADRAO,
  composicaoPayroll: COMPOSICAO_PAYROLL_PADRAO,
  regimeEncargos: "clt-br",
  cambioGbpBrl: 6.9,
  minutosManuaisPorExecucao: 12,
  minutosRevisaoHumana: 8,
  // Uma conversa de chat manual típica (ler, entender, responder, registrar)
  // — mais curta que um fluxo completo, mais longa que um único envio.
  minutosManuaisPorConversa: 10,
  // Um único envio de campanha manual: colar o número, personalizar, enviar.
  minutosManuaisPorEnvioCampanha: 1,
  cambioUsdBrl: 5.4,
  custoPlataformaMensalBrl: 0,
  moedaExibicao: "BRL",
  precoModeloPadrao: PRECOS_REFERENCIA["claude-sonnet-5"],
};

/** Período do mês corrente, em horário local. */
export function periodoMesAtual(referencia = new Date()): RoiPeriodo {
  const inicio = new Date(referencia.getFullYear(), referencia.getMonth(), 1, 0, 0, 0, 0);
  const fim = new Date(referencia.getFullYear(), referencia.getMonth() + 1, 0, 23, 59, 59, 999);
  return {
    inicio: inicio.toISOString(),
    fim: fim.toISOString(),
    rotulo: inicio.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
  };
}

/** Período dos últimos `dias` dias, útil para comparação de tendência. */
export function periodoUltimosDias(dias: number, referencia = new Date()): RoiPeriodo {
  const fim = new Date(referencia);
  const inicio = new Date(referencia.getTime() - dias * 86_400_000);
  return {
    inicio: inicio.toISOString(),
    fim: fim.toISOString(),
    rotulo: `últimos ${dias} dias`,
  };
}

function dentroDoPeriodo(iso: string | undefined, periodo: RoiPeriodo): boolean {
  if (!iso) return false;
  const instante = new Date(iso).getTime();
  if (!Number.isFinite(instante)) return false;
  return instante >= new Date(periodo.inicio).getTime() && instante <= new Date(periodo.fim).getTime();
}

/** Dias cobertos pelo período, usado para ratear o custo fixo da plataforma. */
function diasDoPeriodo(periodo: RoiPeriodo): number {
  const duracao = new Date(periodo.fim).getTime() - new Date(periodo.inicio).getTime();
  if (!Number.isFinite(duracao) || duracao <= 0) return 1;
  return Math.max(1, duracao / 86_400_000);
}

/** Protege divisões: evita `Infinity` e `NaN` chegarem à UI. */
function razaoSegura(numerador: number, denominador: number): number {
  if (!Number.isFinite(numerador) || !Number.isFinite(denominador) || denominador === 0) return 0;
  return numerador / denominador;
}

function arredondar(valor: number, casas = 2): number {
  const fator = 10 ** casas;
  return Math.round(valor * fator) / fator;
}

/**
 * Normaliza a decomposição CLT: cada percentual é limitado a 0..1, e se a
 * soma dos cinco encargos exceder 95% (deixando menos de 5% para o salário
 * base — um sinal claro de configuração malformada), todos são escalados
 * proporcionalmente até caber no teto. Isso impede que uma configuração ruim
 * no Firestore produza um "salário base negativo" no painel de Tax Shield.
 */
function composicaoCltValida(bruta: Partial<ComposicaoCustoClt> | undefined): ComposicaoCustoClt {
  const base = { ...COMPOSICAO_CLT_PADRAO, ...(bruta ?? {}) };
  const clamp01 = (valor: unknown, padrao: number): number => {
    const numero = Number(valor);
    if (!Number.isFinite(numero) || numero < 0) return padrao;
    return Math.min(numero, 1);
  };

  const normalizado: ComposicaoCustoClt = {
    percentualInssPatronal: clamp01(base.percentualInssPatronal, COMPOSICAO_CLT_PADRAO.percentualInssPatronal),
    percentualFgts: clamp01(base.percentualFgts, COMPOSICAO_CLT_PADRAO.percentualFgts),
    percentualDecimoTerceiro: clamp01(base.percentualDecimoTerceiro, COMPOSICAO_CLT_PADRAO.percentualDecimoTerceiro),
    percentualFerias: clamp01(base.percentualFerias, COMPOSICAO_CLT_PADRAO.percentualFerias),
    percentualProvisaoRescisao: clamp01(base.percentualProvisaoRescisao, COMPOSICAO_CLT_PADRAO.percentualProvisaoRescisao),
  };

  const soma =
    normalizado.percentualInssPatronal +
    normalizado.percentualFgts +
    normalizado.percentualDecimoTerceiro +
    normalizado.percentualFerias +
    normalizado.percentualProvisaoRescisao;

  if (soma <= 0.95) return normalizado;

  const fator = 0.95 / soma;
  return {
    percentualInssPatronal: normalizado.percentualInssPatronal * fator,
    percentualFgts: normalizado.percentualFgts * fator,
    percentualDecimoTerceiro: normalizado.percentualDecimoTerceiro * fator,
    percentualFerias: normalizado.percentualFerias * fator,
    percentualProvisaoRescisao: normalizado.percentualProvisaoRescisao * fator,
  };
}

/** Mesma normalização de `composicaoCltValida`, para a decomposição Payroll EUA/Reino Unido. */
function composicaoPayrollValida(bruta: Partial<ComposicaoCustoPayroll> | undefined): ComposicaoCustoPayroll {
  const base = { ...COMPOSICAO_PAYROLL_PADRAO, ...(bruta ?? {}) };
  const clamp01 = (valor: unknown, padrao: number): number => {
    const numero = Number(valor);
    if (!Number.isFinite(numero) || numero < 0) return padrao;
    return Math.min(numero, 1);
  };

  const normalizado: ComposicaoCustoPayroll = {
    percentualFicaPatronal: clamp01(base.percentualFicaPatronal, COMPOSICAO_PAYROLL_PADRAO.percentualFicaPatronal),
    percentualFutaSuta: clamp01(base.percentualFutaSuta, COMPOSICAO_PAYROLL_PADRAO.percentualFutaSuta),
    percentualWorkersComp: clamp01(base.percentualWorkersComp, COMPOSICAO_PAYROLL_PADRAO.percentualWorkersComp),
    percentualBeneficios: clamp01(base.percentualBeneficios, COMPOSICAO_PAYROLL_PADRAO.percentualBeneficios),
    percentualBpoOverhead: clamp01(base.percentualBpoOverhead, COMPOSICAO_PAYROLL_PADRAO.percentualBpoOverhead),
  };

  const soma =
    normalizado.percentualFicaPatronal +
    normalizado.percentualFutaSuta +
    normalizado.percentualWorkersComp +
    normalizado.percentualBeneficios +
    normalizado.percentualBpoOverhead;

  if (soma <= 0.95) return normalizado;

  const fator = 0.95 / soma;
  return {
    percentualFicaPatronal: normalizado.percentualFicaPatronal * fator,
    percentualFutaSuta: normalizado.percentualFutaSuta * fator,
    percentualWorkersComp: normalizado.percentualWorkersComp * fator,
    percentualBeneficios: normalizado.percentualBeneficios * fator,
    percentualBpoOverhead: normalizado.percentualBpoOverhead * fator,
  };
}

function regimeEncargosValido(bruto: unknown): RegimeEncargos {
  return bruto === "payroll-us-uk" ? "payroll-us-uk" : "clt-br";
}

function configuracaoValida(bruta: Partial<RoiConfig> | undefined): RoiConfig {
  const base = { ...ROI_CONFIG_PADRAO, ...(bruta ?? {}) };
  // Configuração vem do Firestore e é entrada não confiável: um valor negativo
  // ou NaN produziria uma economia absurda no painel.
  const positivo = (valor: unknown, padrao: number, maximo: number): number => {
    const numero = Number(valor);
    if (!Number.isFinite(numero) || numero < 0) return padrao;
    return Math.min(numero, maximo);
  };

  return {
    composicaoClt: composicaoCltValida(base.composicaoClt),
    composicaoPayroll: composicaoPayrollValida(base.composicaoPayroll),
    regimeEncargos: regimeEncargosValido(base.regimeEncargos),
    cambioGbpBrl: positivo(base.cambioGbpBrl, ROI_CONFIG_PADRAO.cambioGbpBrl, 1000),
    custoHoraOperadorBrl: positivo(base.custoHoraOperadorBrl, ROI_CONFIG_PADRAO.custoHoraOperadorBrl, 100_000),
    minutosManuaisPorExecucao: positivo(base.minutosManuaisPorExecucao, ROI_CONFIG_PADRAO.minutosManuaisPorExecucao, 10_080),
    minutosRevisaoHumana: positivo(base.minutosRevisaoHumana, ROI_CONFIG_PADRAO.minutosRevisaoHumana, 10_080),
    minutosManuaisPorConversa: positivo(
      base.minutosManuaisPorConversa,
      ROI_CONFIG_PADRAO.minutosManuaisPorConversa,
      10_080
    ),
    minutosManuaisPorEnvioCampanha: positivo(
      base.minutosManuaisPorEnvioCampanha,
      ROI_CONFIG_PADRAO.minutosManuaisPorEnvioCampanha,
      1_440
    ),
    cambioUsdBrl: positivo(base.cambioUsdBrl, ROI_CONFIG_PADRAO.cambioUsdBrl, 1000),
    custoPlataformaMensalBrl: positivo(base.custoPlataformaMensalBrl, 0, 10_000_000),
    moedaExibicao:
      base.moedaExibicao === "USD" || base.moedaExibicao === "GBP" ? base.moedaExibicao : "BRL",
    precoModeloPadrao: {
      modelo: base.precoModeloPadrao?.modelo ?? ROI_CONFIG_PADRAO.precoModeloPadrao.modelo,
      entradaUsdPorMilhao: positivo(
        base.precoModeloPadrao?.entradaUsdPorMilhao,
        ROI_CONFIG_PADRAO.precoModeloPadrao.entradaUsdPorMilhao,
        10_000
      ),
      saidaUsdPorMilhao: positivo(
        base.precoModeloPadrao?.saidaUsdPorMilhao,
        ROI_CONFIG_PADRAO.precoModeloPadrao.saidaUsdPorMilhao,
        10_000
      ),
    },
  };
}

export interface CalcularRoiInput {
  execucoes: FlowRun[];
  tickets?: HandoffTicket[];
  /** Conversas da Neural Inbox — ver "Unificação financeira" abaixo. */
  conversas?: Conversation[];
  /** Campanhas de disparo em massa — ver "Unificação financeira" abaixo. */
  campanhas?: Campaign[];
  config?: Partial<RoiConfig>;
  periodo?: RoiPeriodo;
  referencia?: Date;
}

/** Custo em USD de uma telemetria de IA, com a mesma regra de precedência em todo o painel. */
function custoUsdDeMetrica(
  metrica: { tokensEntrada: number; tokensSaida: number; custoModeloUsd?: number; modelo?: string },
  config: RoiConfig
): number {
  const preco = metrica.modelo ? PRECOS_REFERENCIA[metrica.modelo] ?? config.precoModeloPadrao : config.precoModeloPadrao;
  return typeof metrica.custoModeloUsd === "number" && Number.isFinite(metrica.custoModeloUsd)
    ? Math.max(0, metrica.custoModeloUsd)
    : estimarCustoModeloUsd(metrica.tokensEntrada ?? 0, metrica.tokensSaida ?? 0, preco);
}

/**
 * Calcula o snapshot de ROI do período.
 *
 * Definições usadas (importam para a leitura correta do painel):
 *
 *  - **execução terminal**: concluída ou falha. Execuções em andamento contam no
 *    volume, mas não no denominador das taxas — incluí-las faria a taxa de
 *    sucesso oscilar só porque algo acabou de ser disparado.
 *  - **hora economizada**: tempo que um humano gastaria para fazer o mesmo
 *    trabalho, creditado apenas em execuções CONCLUÍDAS. Execução que falhou não
 *    economizou nada; frequentemente até custou retrabalho.
 *  - **zero-touch**: concluída, sem transbordo e sem intervenção registrada.
 *  - **economia líquida**: custo humano evitado menos (custo de IA + custo da
 *    revisão humana + rateio da plataforma). É o número que vai ao CFO.
 *
 *  - **Unificação financeira (Neural Inbox e campanhas)**: `horasEconomizadasBrutas`,
 *    `custoIaBrl`, `tokensTotais`, `economiaLiquidaBrl` e `roiPercentual` somam a
 *    contribuição de `execucoes` + `conversas` resolvidas + `campanhas` concluídas —
 *    hora é hora e real é real, independente da origem do trabalho automatizado.
 *    Já `execucoesTotais`/`execucoesConcluidas`/`taxaZeroTouch`/`taxaSucesso`
 *    permanecem escopados a `execucoes` (o contrato histórico, intocado) — somar
 *    contagens de unidades heterogêneas (uma conversa não é um fluxo) numa única
 *    métrica de volume seria exatamente o tipo de número que infla sem informar.
 *    O detalhamento por origem vive nos campos `conversas*`/`campanhas*` dedicados.
 *    Conversas sem `metricaIA` (atendimento 100% humano) NÃO contam em
 *    `execucoesSemTelemetria`/`cobertura` — a ausência de custo de IA ali é normal,
 *    não uma lacuna de dados; aquele par de campos continua escopado a `execucoes`.
 */
export function calcularRoi(entrada: CalcularRoiInput): RoiSnapshot {
  const config = configuracaoValida(entrada.config);
  const referencia = entrada.referencia ?? new Date();
  const periodo = entrada.periodo ?? periodoMesAtual(referencia);

  const execucoes = (entrada.execucoes ?? []).filter((run) =>
    dentroDoPeriodo(run.metrica?.concluidoEm ?? run.iniciadoEm, periodo)
  );

  let concluidas = 0;
  let falhas = 0;
  let emAndamento = 0;
  let comIntervencao = 0;
  let tokensEntrada = 0;
  let tokensSaida = 0;
  let custoIaUsd = 0;
  let minutosManuais = 0;
  let semTelemetria = 0;

  for (const run of execucoes) {
    const metrica = run.metrica;

    switch (run.status) {
      case "concluido":
        concluidas += 1;
        break;
      case "falhou":
        falhas += 1;
        break;
      default:
        emAndamento += 1;
        break;
    }

    if (!metrica) {
      semTelemetria += 1;
      // Sem telemetria não há como estimar custo de token com honestidade; a
      // execução fica fora dos agregados financeiros, e `cobertura` denuncia isso.
      if (run.status === "concluido") {
        minutosManuais += config.minutosManuaisPorExecucao;
      }
      continue;
    }

    tokensEntrada += Math.max(0, metrica.tokensEntrada ?? 0);
    tokensSaida += Math.max(0, metrica.tokensSaida ?? 0);
    // Custo reportado pelo provedor tem precedência sobre a estimativa.
    custoIaUsd += custoUsdDeMetrica(metrica, config);

    if (metrica.intervencaoHumana) comIntervencao += 1;

    if (run.status === "concluido") {
      minutosManuais += metrica.minutosManuaisEvitados ?? config.minutosManuaisPorExecucao;
    }
  }

  // --- Neural Inbox: conversas resolvidas somam às mesmas horas/custo acima ---
  const conversasPeriodo = (entrada.conversas ?? []).filter((c) =>
    dentroDoPeriodo(c.resolvidaEm ?? c.ultimaMensagemEm, periodo)
  );
  let conversasResolvidas = 0;
  let conversasComFrustracaoCritica = 0;
  let mensagensProcessadas = 0;

  for (const conversa of conversasPeriodo) {
    mensagensProcessadas += Math.max(0, conversa.totalMensagens ?? 0);
    if (conversa.circuitBreakerAtivo) conversasComFrustracaoCritica += 1;

    if (conversa.status !== "resolvida") continue;
    conversasResolvidas += 1;
    minutosManuais += config.minutosManuaisPorConversa;
    // Deliberadamente NÃO soma a `comIntervencao`/`execucoesComIntervencao`:
    // aquele contador é escopado a `execucoes` (FlowRun) e alimenta
    // `taxaZeroTouch` como uma taxa só de fluxos. Misturar uma "conversa
    // atendida por humano" ali inflaria artificialmente o denominador de uma
    // taxa que não fala sobre conversas — exatamente o tipo de número que
    // parece mais completo e na prática é menos confiável.

    if (conversa.metricaIA) {
      tokensEntrada += Math.max(0, conversa.metricaIA.tokensEntrada ?? 0);
      tokensSaida += Math.max(0, conversa.metricaIA.tokensSaida ?? 0);
      custoIaUsd += custoUsdDeMetrica(conversa.metricaIA, config);
    }
  }

  // --- Campanhas concluídas somam às mesmas horas/custo acima ---
  const campanhasPeriodo = (entrada.campanhas ?? []).filter((c) =>
    dentroDoPeriodo(c.concluidaEm ?? c.criadaEm, periodo)
  );
  let campanhasExecutadas = 0;
  let enviosCampanhaRealizados = 0;
  let enviosCampanhaBloqueados = 0;

  for (const campanha of campanhasPeriodo) {
    enviosCampanhaBloqueados += Math.max(0, campanha.totalBloqueados ?? 0);
    if (campanha.status !== "concluida") continue;

    campanhasExecutadas += 1;
    enviosCampanhaRealizados += Math.max(0, campanha.totalEnviados ?? 0);
    minutosManuais += config.minutosManuaisPorEnvioCampanha * Math.max(0, campanha.totalEnviados ?? 0);
    // Falhas de entrega da campanha NÃO somam a `falhas`/`execucoesFalhas`: por
    // esse mesmo motivo — aquele contador e `taxaSucesso` são escopados a
    // `execucoes`. A taxa de entrega da própria campanha (enviados vs.
    // destinatários vs. falhas) é visível pelos campos do documento da
    // campanha na UI, sem precisar corromper a taxa de sucesso dos fluxos.

    if (campanha.metrica) {
      tokensEntrada += Math.max(0, campanha.metrica.tokensEntrada ?? 0);
      tokensSaida += Math.max(0, campanha.metrica.tokensSaida ?? 0);
      custoIaUsd += custoUsdDeMetrica(campanha.metrica, config);
    }
  }

  // --- Custo da revisão humana, a partir dos tickets de transbordo ---
  const ticketsPeriodo = (entrada.tickets ?? []).filter((t) => dentroDoPeriodo(t.criadoEm, periodo));
  let minutosRevisao = 0;
  const idsComTicket = new Set<string>();

  for (const ticket of ticketsPeriodo) {
    if (ticket.runId) idsComTicket.add(ticket.runId);

    if (ticket.status === "resolvido" && ticket.decididoEm) {
      // Tempo real de atendimento quando disponível; é mais fiel que a média
      // configurada e capta a diferença entre um caso trivial e um complexo.
      const inicio = new Date(ticket.criadoEm).getTime();
      const fim = new Date(ticket.decididoEm).getTime();
      const decorrido = (fim - inicio) / 60_000;
      minutosRevisao += Number.isFinite(decorrido) && decorrido > 0
        ? Math.min(decorrido, config.minutosRevisaoHumana * 10)
        : config.minutosRevisaoHumana;
    } else if (ticket.status !== "cancelado") {
      minutosRevisao += config.minutosRevisaoHumana;
    }
  }

  // Um transbordo também quebra o zero-touch de execuções que não registraram
  // `intervencaoHumana` na própria telemetria.
  const intervencoesPorTicket = execucoes.filter(
    (run) => idsComTicket.has(run.id) && !run.metrica?.intervencaoHumana
  ).length;
  comIntervencao += intervencoesPorTicket;

  const terminais = concluidas + falhas;
  const horasEconomizadasBrutas = minutosManuais / 60;
  const horasGastasEmRevisao = minutosRevisao / 60;
  const horasLiquidas = Math.max(0, horasEconomizadasBrutas - horasGastasEmRevisao);

  const custoHumanoEvitadoBrl = horasEconomizadasBrutas * config.custoHoraOperadorBrl;
  const custoIaBrl = custoIaUsd * config.cambioUsdBrl;
  const custoRevisaoHumanaBrl = horasGastasEmRevisao * config.custoHoraOperadorBrl;
  const custoPlataformaBrl = (config.custoPlataformaMensalBrl / 30) * diasDoPeriodo(periodo);

  const custoTotalAutomacao = custoIaBrl + custoRevisaoHumanaBrl + custoPlataformaBrl;
  const economiaLiquidaBrl = custoHumanoEvitadoBrl - custoTotalAutomacao;

  const zeroTouch = Math.max(0, concluidas - comIntervencao);

  // --- Tax Shield: decompõe o custo humano evitado nos encargos CLT ---
  const encargosInssBrl = custoHumanoEvitadoBrl * config.composicaoClt.percentualInssPatronal;
  const encargosFgtsBrl = custoHumanoEvitadoBrl * config.composicaoClt.percentualFgts;
  const encargosDecimoTerceiroBrl = custoHumanoEvitadoBrl * config.composicaoClt.percentualDecimoTerceiro;
  const encargosFeriasBrl = custoHumanoEvitadoBrl * config.composicaoClt.percentualFerias;
  const encargosProvisaoRescisaoBrl = custoHumanoEvitadoBrl * config.composicaoClt.percentualProvisaoRescisao;
  const encargosTotaisBrl =
    encargosInssBrl + encargosFgtsBrl + encargosDecimoTerceiroBrl + encargosFeriasBrl + encargosProvisaoRescisaoBrl;
  const salarioBaseEvitadoBrl = Math.max(0, custoHumanoEvitadoBrl - encargosTotaisBrl);

  // --- Dual-Region Tax Shield: mesma decomposição, lente Payroll EUA/Reino
  // Unido — sempre calculada, independente de `config.regimeEncargos`. ---
  const encargosFicaBrl = custoHumanoEvitadoBrl * config.composicaoPayroll.percentualFicaPatronal;
  const encargosFutaSutaBrl = custoHumanoEvitadoBrl * config.composicaoPayroll.percentualFutaSuta;
  const encargosWorkersCompBrl = custoHumanoEvitadoBrl * config.composicaoPayroll.percentualWorkersComp;
  const encargosBeneficiosBrl = custoHumanoEvitadoBrl * config.composicaoPayroll.percentualBeneficios;
  const encargosBpoOverheadBrl = custoHumanoEvitadoBrl * config.composicaoPayroll.percentualBpoOverhead;
  const encargosTotaisPayrollBrl =
    encargosFicaBrl + encargosFutaSutaBrl + encargosWorkersCompBrl + encargosBeneficiosBrl + encargosBpoOverheadBrl;
  const salarioBaseEvitadoPayrollBrl = Math.max(0, custoHumanoEvitadoBrl - encargosTotaisPayrollBrl);

  return {
    execucoesTotais: execucoes.length,
    execucoesConcluidas: concluidas,
    execucoesFalhas: falhas,
    execucoesEmAndamento: emAndamento,
    execucoesComIntervencao: comIntervencao,

    horasEconomizadasBrutas: arredondar(horasEconomizadasBrutas, 1),
    horasGastasEmRevisao: arredondar(horasGastasEmRevisao, 1),
    horasEconomizadasLiquidas: arredondar(horasLiquidas, 1),

    custoHumanoEvitadoBrl: arredondar(custoHumanoEvitadoBrl),
    custoIaBrl: arredondar(custoIaBrl),
    custoRevisaoHumanaBrl: arredondar(custoRevisaoHumanaBrl),
    custoPlataformaBrl: arredondar(custoPlataformaBrl),
    economiaLiquidaBrl: arredondar(economiaLiquidaBrl),
    reducaoOpexPercentual: arredondar(razaoSegura(economiaLiquidaBrl, custoHumanoEvitadoBrl), 4),
    custoPorExecucaoBrl: arredondar(razaoSegura(custoTotalAutomacao, terminais)),
    roiPercentual: arredondar(razaoSegura(economiaLiquidaBrl, custoTotalAutomacao), 4),

    salarioBaseEvitadoBrl: arredondar(salarioBaseEvitadoBrl),
    encargosInssBrl: arredondar(encargosInssBrl),
    encargosFgtsBrl: arredondar(encargosFgtsBrl),
    encargosDecimoTerceiroBrl: arredondar(encargosDecimoTerceiroBrl),
    encargosFeriasBrl: arredondar(encargosFeriasBrl),
    encargosProvisaoRescisaoBrl: arredondar(encargosProvisaoRescisaoBrl),
    encargosTotaisBrl: arredondar(encargosTotaisBrl),

    salarioBaseEvitadoPayrollBrl: arredondar(salarioBaseEvitadoPayrollBrl),
    encargosFicaBrl: arredondar(encargosFicaBrl),
    encargosFutaSutaBrl: arredondar(encargosFutaSutaBrl),
    encargosWorkersCompBrl: arredondar(encargosWorkersCompBrl),
    encargosBeneficiosBrl: arredondar(encargosBeneficiosBrl),
    encargosBpoOverheadBrl: arredondar(encargosBpoOverheadBrl),
    encargosTotaisPayrollBrl: arredondar(encargosTotaisPayrollBrl),

    taxaZeroTouch: arredondar(razaoSegura(zeroTouch, terminais), 4),
    taxaSucesso: arredondar(razaoSegura(concluidas, terminais), 4),

    tokensEntrada,
    tokensSaida,
    tokensTotais: tokensEntrada + tokensSaida,
    execucoesSemTelemetria: semTelemetria,
    cobertura: arredondar(razaoSegura(execucoes.length - semTelemetria, execucoes.length), 4),

    conversasTotais: conversasPeriodo.length,
    conversasResolvidas,
    conversasComFrustracaoCritica,
    mensagensProcessadas,

    campanhasExecutadas,
    enviosCampanhaRealizados,
    enviosCampanhaBloqueados,

    periodo,
    moeda: config.moedaExibicao,
    atualizadoEm: referencia.toISOString(),
  };
}

/**
 * Variação percentual entre dois valores do mesmo agregado (ex.: economia
 * líquida da semana atual vs. da semana anterior) — usada pelo badge de
 * crescimento do Portal do Cliente. Sem baseline real (`anterior <= 0`),
 * devolve `null`: mostrar "+X%" sem denominador real seria inventar o
 * número, o que viola a mesma regra de honestidade de `calcularRoi`.
 */
export function calcularVariacaoPercentual(atual: number, anterior: number): number | null {
  if (!Number.isFinite(atual) || !Number.isFinite(anterior) || anterior <= 0) return null;
  return arredondar(((atual - anterior) / anterior) * 100, 1);
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

/**
 * Formata um valor monetário.
 *
 * O snapshot é calculado sempre em BRL; a exibição em USD aplica o câmbio na
 * apresentação. Isso mantém uma única moeda de referência nos cálculos e evita
 * erro de arredondamento acumulado por conversões intermediárias.
 */
const LOCALE_POR_MOEDA: Record<Moeda, string> = {
  BRL: "pt-BR",
  USD: "en-US",
  GBP: "en-GB",
};

/**
 * Taxa de conversão (1 unidade da moeda → BRL) a aplicar na exibição.
 * BRL é a moeda de cálculo interna — sempre 1. Centraliza a escolha entre
 * `cambioUsdBrl`/`cambioGbpBrl` para que nenhum componente repita a mesma
 * ternária em cada card.
 */
export function cambioParaMoeda(config: Pick<RoiConfig, "cambioUsdBrl" | "cambioGbpBrl">, moeda: Moeda): number {
  if (moeda === "USD") return config.cambioUsdBrl;
  if (moeda === "GBP") return config.cambioGbpBrl;
  return 1;
}

/**
 * Formata um valor monetário.
 *
 * O snapshot é calculado sempre em BRL; `cambioParaBrl` é "quantos BRL vale 1
 * unidade de `moeda`" — passe `config.cambioUsdBrl`/`config.cambioGbpBrl`
 * (ou use `cambioParaMoeda`) de acordo com a moeda escolhida. BRL nunca
 * converte, qualquer que seja o valor passado aqui.
 */
export function formatarMoeda(valorBrl: number, moeda: Moeda, cambioParaBrl = ROI_CONFIG_PADRAO.cambioUsdBrl): string {
  const valor = moeda === "BRL" ? valorBrl : valorBrl / (cambioParaBrl || 1);
  const seguro = Number.isFinite(valor) ? valor : 0;

  return new Intl.NumberFormat(LOCALE_POR_MOEDA[moeda], {
    style: "currency",
    currency: moeda,
    maximumFractionDigits: Math.abs(seguro) >= 1000 ? 0 : 2,
  }).format(seguro);
}

export function formatarPercentual(razao: number, casas = 1): string {
  const seguro = Number.isFinite(razao) ? razao : 0;
  return `${(seguro * 100).toFixed(casas)}%`;
}

export function formatarHoras(horas: number): string {
  const seguro = Number.isFinite(horas) ? horas : 0;
  if (seguro < 1) return `${Math.round(seguro * 60)} min`;
  if (seguro < 100) return `${seguro.toFixed(1)} h`;
  return `${Math.round(seguro)} h`;
}

export function formatarTokens(tokens: number): string {
  const seguro = Number.isFinite(tokens) ? tokens : 0;
  if (seguro < 1000) return String(Math.round(seguro));
  if (seguro < 1_000_000) return `${(seguro / 1000).toFixed(1)}k`;
  return `${(seguro / 1_000_000).toFixed(2)}M`;
}

// ---------------------------------------------------------------------------
// Persistência da configuração
// ---------------------------------------------------------------------------

/**
 * Assina a configuração de ROI do workspace.
 *
 * A configuração vive no próprio documento do workspace (campo `roiConfig`), e
 * não em coleção separada: é um objeto único por workspace, lido junto com o
 * nome na mesma assinatura, o que evita uma segunda leitura por sessão.
 */
export function subscribeRoiConfig(
  onChange: (config: RoiConfig) => void,
  workspaceId = DEFAULT_WORKSPACE_ID
): Unsubscribe {
  if (!db) {
    onChange(ROI_CONFIG_PADRAO);
    return () => {};
  }

  return onSnapshot(
    doc(db, "workspaces", workspaceId),
    (snapshot) => {
      const bruta = snapshot.data()?.roiConfig as Partial<RoiConfig> | undefined;
      onChange(configuracaoValida(bruta));
    },
    (erro) => {
      console.error("[roi] falha ao assinar a configuração:", erro);
      onChange(ROI_CONFIG_PADRAO);
    }
  );
}

export async function lerRoiConfig(workspaceId = DEFAULT_WORKSPACE_ID): Promise<RoiConfig> {
  const database = requireDb();
  const snapshot = await getDoc(doc(database, "workspaces", workspaceId));
  return configuracaoValida(snapshot.data()?.roiConfig as Partial<RoiConfig> | undefined);
}

/** Salva a configuração de ROI, normalizando os valores antes de persistir. */
export async function salvarRoiConfig(
  config: Partial<RoiConfig>,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<RoiConfig> {
  const database = requireDb();
  const normalizada = configuracaoValida(config);
  await setDoc(doc(database, "workspaces", workspaceId), { roiConfig: normalizada }, { merge: true });
  return normalizada;
}

/** Exposta para teste e para a UI de configuração. */
export { configuracaoValida as normalizarRoiConfig };
