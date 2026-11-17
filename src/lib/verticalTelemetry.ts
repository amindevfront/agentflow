// Motores Verticais Preditivos — contrato de dados e telemetria por vertical.
//
// Por que isto existe: `@/lib/roi` responde "quanto custo evitamos" e
// `@/lib/server/roiDashboard` responde "quanto pipeline geramos", ambos com
// um vocabulário GENÉRICO (atendimentos, agendamentos, horas). Nenhum dos
// dois fala a língua da diretoria da vertical: um incorporador de alto padrão
// não pergunta "quantos agendamentos confirmados", pergunta "quanto VGV está
// em negociação agora"; uma transportadora não pergunta "quantas conversas
// resolvidas", pergunta "quantas cotações saíram em menos de 30 segundos e
// quanta demurrage o radar expôs antes da fatura".
//
// Este módulo é a camada de TRADUÇÃO entre os dois: puro, determinístico e
// SERVER-SAFE (nenhum import de React nem de Firestore — só tipos e dois
// motores já puros, `@/lib/inbox/revenueRescue` e `@/lib/demurrage`). A UI
// reativa que o consome vive em `@/lib/verticalEngine` (hook client-side) e
// `@/components/governance/VerticalTelemetryPanel`.
//
// Honestidade do número (mesma regra de `@/lib/roi`): toda métrica aqui tem
// uma base de cálculo rastreável a um documento real do workspace
// (conversa, ticket HITL, execução de fluxo, carga). Os ÚNICOS parâmetros
// não derivados de dado são os do CONTRATO DE DADOS da vertical (VGV médio,
// comissão média, SLA de cotação) — valores de referência declarados,
// configuráveis por workspace e sempre exibidos junto do número que
// produzem, nunca multiplicadores silenciosos (Artigo IV — No Invention).

import type { Conversation, FlowRun, HandoffTicket, NicheKey, RoiPeriodo, Shipment } from "@/types";
import { foraDoExpediente, type JanelaExpediente } from "@/lib/inbox/revenueRescue";
import { calcularRiscoDemurrage } from "@/lib/demurrage";

// ---------------------------------------------------------------------------
// Contrato de dados por vertical
// ---------------------------------------------------------------------------

export type VerticalEngineId = "imobiliario-alto-padrao" | "logistica-b2b";

/**
 * Janela de madrugada — faixa [0h, 6h), o recorte de "lead que chegou quando
 * a empresa estaria fechada". Declarada aqui (em vez de importada de
 * `@/lib/server/roiDashboard`) porque aquele módulo é SERVER-ONLY: puxá-lo
 * para cá levaria o Admin SDK inteiro para o bundle do cliente.
 *
 * `foraDoExpediente` marca como "fora" tudo que cai FORA de
 * `[inicioHora, fimHora)` — com [6h, 24h) configurado e todos os dias
 * marcados como úteis, "fora" é exatamente [0h, 6h).
 */
export const JANELA_MADRUGADA_VERTICAL: JanelaExpediente = {
  inicioHora: 6,
  fimHora: 24,
  diasUteis: [0, 1, 2, 3, 4, 5, 6],
};

/**
 * Contrato de dados do Motor Vertical A — Imobiliário de Alto Padrão
 * (Itajaí / Balneário Camboriú / Praia Brava).
 *
 * `vgvMedioUnidadeBrl` e `comissaoMediaBrl` são os dois parâmetros que
 * traduzem VOLUME (visitas agendadas) em LINGUAGEM DE DIRETORIA (VGV em
 * pipeline, comissão projetada). São valores de REFERÊNCIA de mercado para
 * a praça-alvo, não uma medição — por isso aparecem sempre no `detalhe` da
 * métrica que ajudam a produzir.
 */
export interface ContratoVerticalImobiliario {
  readonly id: "imobiliario-alto-padrao";
  /** VGV médio de uma unidade de alto padrão na praça-alvo, em BRL. */
  readonly vgvMedioUnidadeBrl: number;
  /** Comissão média bruta por unidade vendida, em BRL. */
  readonly comissaoMediaBrl: number;
  /** Praças cobertas por esta configuração — usado só em rótulo/dica, nunca em cálculo. */
  readonly pracasAlvo: readonly string[];
}

/**
 * Contrato de dados do Motor Vertical B — Logística & Supply Chain B2B.
 *
 * `contratosRecorrentesMes` é deliberadamente `0` por padrão: o número de
 * contratos de frete recorrente é um dado do CLIENTE, não do AgentFlow —
 * zero significa "ainda não informado", e a métrica que dependeria dele diz
 * isso explicitamente em vez de estimar.
 */
export interface ContratoVerticalLogistica {
  readonly id: "logistica-b2b";
  /** SLA de referência para uma cotação/resposta automática ser considerada instantânea, em segundos. */
  readonly slaCotacaoSegundos: number;
  /** Contratos de frete recorrente/mês declarados pelo cliente. `0` = não informado. */
  readonly contratosRecorrentesMes: number;
}

export type ContratoVertical = ContratoVerticalImobiliario | ContratoVerticalLogistica;

/** Contrato de produção do Motor Vertical A — baseline de alto padrão Itajaí/BC. */
export const CONTRATO_IMOBILIARIO_ALTO_PADRAO: ContratoVerticalImobiliario = {
  id: "imobiliario-alto-padrao",
  vgvMedioUnidadeBrl: 1_500_000,
  comissaoMediaBrl: 75_000,
  pracasAlvo: ["Itajaí", "Balneário Camboriú", "Praia Brava"],
};

/** Contrato de produção do Motor Vertical B — operação de frete recorrente. */
export const CONTRATO_LOGISTICA_B2B: ContratoVerticalLogistica = {
  id: "logistica-b2b",
  slaCotacaoSegundos: 30,
  contratosRecorrentesMes: 0,
};

/**
 * Qual Motor Vertical responde por cada nicho. Ausente = o nicho não tem
 * motor preditivo dedicado e cai no painel genérico (Oportunidade &
 * Pipeline) — nunca um motor "aproximado" emprestado de outra vertical.
 */
export const MOTOR_POR_NICHO: Partial<Record<NicheKey, ContratoVertical>> = {
  "construtora-imobiliaria": CONTRATO_IMOBILIARIO_ALTO_PADRAO,
  "logistica-portuaria": CONTRATO_LOGISTICA_B2B,
};

/** Rótulo de vitrine de cada motor — usado no seletor e no cabeçalho do painel. */
export const ROTULO_MOTOR: Record<VerticalEngineId, string> = {
  "imobiliario-alto-padrao": "Imobiliário de Alto Padrão (Itajaí / Balneário Camboriú)",
  "logistica-b2b": "Logística & Supply Chain B2B (Fretes & Operações)",
};

/** Contrato do motor dedicado deste nicho, ou `null` quando não há um. */
export function obterContratoVertical(setor: NicheKey | null | undefined): ContratoVertical | null {
  if (!setor) return null;
  return MOTOR_POR_NICHO[setor] ?? null;
}

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------

export type FormatoMetrica = "inteiro" | "moeda-brl" | "duracao-segundos";
export type TomMetrica = "neutro" | "positivo" | "atencao" | "erro" | "marca";

export interface MetricaVertical {
  id: string;
  rotulo: string;
  valor: number;
  formato: FormatoMetrica;
  /** Base de cálculo em uma linha — sempre exibida sob o valor. */
  detalhe: string;
  /** Explicação longa da origem do número (atributo `title` do cartão). */
  dica: string;
  tom: TomMetrica;
}

export interface EntradaTelemetriaVertical {
  contrato: ContratoVertical;
  periodo: RoiPeriodo;
  /** Conversas do workspace. Conversas de Sandbox devem ser filtradas pelo chamador quando o painel for de produção. */
  conversas: Conversation[];
  tickets: HandoffTicket[];
  execucoes: FlowRun[];
  cargas: Shipment[];
  janelaMadrugada?: JanelaExpediente;
  referencia?: Date;
}

function dentroDoPeriodo(iso: string | undefined | null, periodo: RoiPeriodo): boolean {
  if (!iso) return false;
  const instante = new Date(iso).getTime();
  if (!Number.isFinite(instante)) return false;
  return instante >= new Date(periodo.inicio).getTime() && instante <= new Date(periodo.fim).getTime();
}

/** Duração total de uma execução — soma dos passos que registraram duração. `null` quando nenhum registrou. */
export function duracaoExecucaoMs(execucao: FlowRun): number | null {
  let soma = 0;
  let houve = false;
  for (const passo of execucao.steps) {
    if (typeof passo.duracaoMs === "number" && Number.isFinite(passo.duracaoMs) && passo.duracaoMs >= 0) {
      soma += passo.duracaoMs;
      houve = true;
    }
  }
  return houve ? soma : null;
}

/**
 * Motivos de ticket que representam uma VISITA PRESENCIAL confirmada pelo
 * próprio lead. Espelha `MOTIVOS_AGENDAMENTO_VALIDADO`
 * (`@/lib/server/hitlStore`) recortado à vertical imobiliária — aqui a
 * pergunta não é "houve agendamento", é "houve visita ao imóvel", que é o
 * único evento que move VGV.
 */
const MOTIVOS_VISITA_IMOVEL = new Set<HandoffTicket["motivo"]>(["agendamento-visita-presencial"]);

function metricasImobiliario(
  entrada: EntradaTelemetriaVertical,
  contrato: ContratoVerticalImobiliario
): MetricaVertical[] {
  const janela = entrada.janelaMadrugada ?? JANELA_MADRUGADA_VERTICAL;

  const conversasPeriodo = entrada.conversas.filter((c) => dentroDoPeriodo(c.criadaEm, entrada.periodo));

  const leadsMadrugada = conversasPeriodo.filter(
    (c) => (c.totalMensagensCliente ?? 0) > 0 && foraDoExpediente(new Date(c.criadaEm), janela)
  );
  const leadsMadrugadaAltoPadrao = leadsMadrugada.filter((c) => c.leadAltoPadrao === true).length;

  const visitas = entrada.tickets.filter(
    (t) =>
      dentroDoPeriodo(t.criadoEm, entrada.periodo) &&
      t.status !== "cancelado" &&
      MOTIVOS_VISITA_IMOVEL.has(t.motivo)
  ).length;

  const vgvPipelineBrl = visitas * contrato.vgvMedioUnidadeBrl;
  const comissaoProjetadaBrl = visitas * contrato.comissaoMediaBrl;

  const pracas = contrato.pracasAlvo.join(" / ");

  return [
    {
      id: "leads-madrugada",
      rotulo: "Leads qualificados de madrugada",
      valor: leadsMadrugada.length,
      formato: "inteiro",
      detalhe:
        leadsMadrugadaAltoPadrao > 0
          ? `${leadsMadrugadaAltoPadrao} com sinal de alto padrão · janela 0h–6h`
          : "janela 0h–6h, com resposta do cliente",
      dica:
        "Conversas abertas entre 0h e 6h que tiveram ao menos uma mensagem do cliente — o contato que, sem " +
        "atendimento autônomo, esperaria o próximo dia útil. O sinal de alto padrão vem do detector " +
        "determinístico de capacidade de investimento + urgência (@/lib/inbox/highEndLead), nunca de uma " +
        "inferência livre do modelo.",
      tom: "atencao",
    },
    {
      id: "visitas-agendadas",
      rotulo: `Visitas agendadas (${pracas})`,
      valor: visitas,
      formato: "inteiro",
      detalhe: "transbordos de visita presencial confirmados",
      dica:
        "Tickets de transbordo com motivo de agendamento de visita presencial criados no período e não " +
        "cancelados — cada um é um lead que pediu explicitamente para visitar o imóvel e foi passado a um " +
        "corretor humano.",
      tom: "positivo",
    },
    {
      id: "vgv-pipeline",
      rotulo: "VGV em pipeline ativo",
      valor: vgvPipelineBrl,
      formato: "moeda-brl",
      detalhe: `${visitas} visita(s) × VGV médio de ${formatarMoedaBrl(contrato.vgvMedioUnidadeBrl)}`,
      dica:
        "Oportunidade ESTIMADA em pipeline, nunca receita realizada: visitas presenciais confirmadas " +
        "multiplicadas pelo VGV médio por unidade configurado para a praça-alvo. Recalibre o VGV médio ao " +
        "ticket real do empreendimento — este é um valor de referência declarado, não uma medição.",
      tom: "marca",
    },
    {
      id: "comissao-projetada",
      rotulo: "Comissão projetada",
      valor: comissaoProjetadaBrl,
      formato: "moeda-brl",
      detalhe: `${visitas} visita(s) × comissão média de ${formatarMoedaBrl(contrato.comissaoMediaBrl)}`,
      dica:
        "Comissão bruta ESTIMADA correspondente ao VGV em pipeline, no mesmo critério: só visitas confirmadas " +
        "entram, e o valor por unidade é o parâmetro de referência configurado — nunca uma projeção de fechamento.",
      tom: "marca",
    },
  ];
}

function metricasLogistica(
  entrada: EntradaTelemetriaVertical,
  contrato: ContratoVerticalLogistica
): MetricaVertical[] {
  const referencia = entrada.referencia ?? new Date();
  const limiteMs = contrato.slaCotacaoSegundos * 1000;

  const execucoesPeriodo = entrada.execucoes.filter(
    (e) => dentroDoPeriodo(e.iniciadoEm, entrada.periodo) && e.status === "concluido"
  );
  const execucoesComDuracao = execucoesPeriodo
    .map((e) => duracaoExecucaoMs(e))
    .filter((ms): ms is number => ms !== null);
  const sub30s = execucoesComDuracao.filter((ms) => ms <= limiteMs).length;

  const conversasPeriodo = entrada.conversas.filter((c) => dentroDoPeriodo(c.criadaEm, entrada.periodo));
  const resolucoesAutonomas = conversasPeriodo.filter(
    (c) => c.status === "resolvida" && !c.slaTicketId && c.circuitBreakerAtivo !== true
  ).length;

  const riskShieldBrl = entrada.tickets.reduce((acc, t) => {
    if (!t.riscoPrevenido) return acc;
    if (!dentroDoPeriodo(t.criadoEm, entrada.periodo)) return acc;
    return acc + t.riscoPrevenido.prejuizoEstimadoBrl;
  }, 0);

  const demurrageExpostoBrl = entrada.cargas.reduce((acc, carga) => {
    const risco = calcularRiscoDemurrage(carga, referencia);
    if (!risco || risco.nivelAlerta !== "acumulando-custo") return acc;
    return acc + risco.custoProjetadoBrl;
  }, 0);

  const cargasMonitoradas = entrada.cargas.filter(
    (carga) => calcularRiscoDemurrage(carga, referencia) !== null
  ).length;

  return [
    {
      id: "cotacoes-sub-30s",
      rotulo: `Cotações & respostas sub-${contrato.slaCotacaoSegundos}s`,
      valor: sub30s,
      formato: "inteiro",
      detalhe:
        execucoesComDuracao.length > 0
          ? `de ${execucoesComDuracao.length} execução(ões) com telemetria de duração`
          : "nenhuma execução com telemetria de duração no período",
      dica:
        `Execuções de fluxo concluídas no período cuja duração total registrada ficou em ${contrato.slaCotacaoSegundos} ` +
        "segundos ou menos (soma da duração dos passos, gravada pelo motor de orquestração). Execuções sem " +
        "telemetria de duração ficam fora do numerador E do denominador — nunca contadas como se tivessem sido rápidas.",
      tom: "positivo",
    },
    {
      id: "resolucoes-autonomas",
      rotulo: "Rastreios & ocorrências autônomos",
      valor: resolucoesAutonomas,
      formato: "inteiro",
      detalhe: `de ${conversasPeriodo.length} atendimento(s) no período`,
      dica:
        "Conversas resolvidas no período SEM transbordo humano e sem Circuit Breaker acionado — consultas de " +
        "status/CT-e e ocorrências que o agente fechou de ponta a ponta. Qualquer conversa com ticket de SLA " +
        "vinculado é excluída, mesmo que tenha sido resolvida depois.",
      tom: "positivo",
    },
    {
      id: "risk-shield",
      rotulo: "Risk Shield — passivo prevenido",
      valor: riskShieldBrl,
      formato: "moeda-brl",
      detalhe:
        demurrageExpostoBrl > 0
          ? `+ ${formatarMoedaBrl(demurrageExpostoBrl)} de demurrage já exposta pelo radar`
          : "nenhuma demurrage acumulando custo agora",
      dica:
        "Estimativa conservadora de passivo fiscal/multa e erosão de margem evitados por bloqueios do guardrail " +
        "(tabela de referência em @/lib/governance/marginGuard). O complemento no detalhe é o custo de demurrage " +
        "JÁ EM CURSO que o Demurrage Clock expôs antes da fatura chegar — custo real medido, não evitado, por " +
        "isso somado à parte e nunca dentro do mesmo número.",
      tom: riskShieldBrl > 0 ? "positivo" : "marca",
    },
    {
      id: "cargas-monitoradas",
      rotulo: "Cargas sob Demurrage Clock",
      valor: cargasMonitoradas,
      formato: "inteiro",
      detalhe:
        contrato.contratosRecorrentesMes > 0
          ? `contrato declarado: ${contrato.contratosRecorrentesMes} frete(s) recorrente(s)/mês`
          : "cargas com free time e custo diário configurados",
      dica:
        "Cargas com termos de demurrage (free time + custo diário) preenchidos e já chegadas à aduana — as " +
        "únicas em que o relógio de sobre-estadia pode de fato ser calculado. Cargas sem termos contratados " +
        "nunca entram aqui, em vez de receberem um free time típico inventado.",
      tom: "neutro",
    },
  ];
}

/**
 * Calcula as métricas do motor vertical ativo. Função PURA: mesmo input,
 * mesmo output — testável sem Firestore, como `calcularRoi` (`@/lib/roi`).
 */
export function calcularTelemetriaVertical(entrada: EntradaTelemetriaVertical): MetricaVertical[] {
  switch (entrada.contrato.id) {
    case "imobiliario-alto-padrao":
      return metricasImobiliario(entrada, entrada.contrato);
    case "logistica-b2b":
      return metricasLogistica(entrada, entrada.contrato);
  }
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

export function formatarMoedaBrl(valor: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(valor) ? valor : 0);
}

/** Valor já formatado para exibição, conforme o `formato` declarado na métrica. */
export function formatarValorMetrica(metrica: MetricaVertical): string {
  switch (metrica.formato) {
    case "moeda-brl":
      return formatarMoedaBrl(metrica.valor);
    case "duracao-segundos":
      return `${Math.round(metrica.valor)}s`;
    case "inteiro":
      return String(Math.round(metrica.valor));
  }
}
