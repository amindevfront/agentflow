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
  Conversation,
  FlowRun,
  HandoffTicket,
  Moeda,
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

export const ROI_CONFIG_PADRAO: RoiConfig = {
  // Custo-hora totalmente carregado de um analista de operações no Brasil
  // (salário + encargos + benefícios + overhead). Valor de partida conservador;
  // cada workspace ajusta ao seu próprio custo real.
  custoHoraOperadorBrl: 62,
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
    moedaExibicao: base.moedaExibicao === "USD" ? "USD" : "BRL",
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
export function formatarMoeda(valorBrl: number, moeda: Moeda, cambioUsdBrl = ROI_CONFIG_PADRAO.cambioUsdBrl): string {
  const valor = moeda === "USD" ? valorBrl / (cambioUsdBrl || 1) : valorBrl;
  const seguro = Number.isFinite(valor) ? valor : 0;

  return new Intl.NumberFormat(moeda === "USD" ? "en-US" : "pt-BR", {
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
