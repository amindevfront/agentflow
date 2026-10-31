// Health Score Preventivo — radar de risco de churn do workspace, para o
// OPERADOR do AgentFlow (quem vendeu e implantou), não para o cliente final.
//
// Por que isto existe (ver ADR-0007, seção "Pendências / Roadmap"): pesquisa
// de mercado sobre customer success em SaaS B2B (2026) documenta a adoção de
// modelos preditivos de churn saltando de 38% para 65% das grandes empresas
// entre 2023 e 2026, com redução de 15% a 30% em atrição quando o risco é
// identificado ANTES do cliente cancelar — a reclamação mais citada contra
// fornecedores de automação é justamente "depois que contratei, sumiram":
// ninguém do lado do fornecedor percebeu o problema a tempo.
//
// Decisão deliberada de desenho: nada de modelo de IA/ML aqui. Mesma
// filosofia de `@/lib/guardrails/compliancePreventivo` — sinais com peso,
// determinísticos e auditáveis, sem rede. Um score que o operador não
// consegue reconstruir manualmente não gera confiança, só mais um número
// place a ser contestado na primeira conversa difícil com o cliente. E
// nenhuma instrumentação nova é necessária: os três sinais abaixo já existem
// nos dados do produto (execuções, tickets de transbordo, conversas) — isto
// é pura agregação sobre o que já é coletado, não um novo sensor.
//
// Os três sinais sempre avaliados, e por que cada um é um preditor real de
// churn documentado:
//   1. Taxa de sucesso de execuções caindo → o produto está falhando na
//      frente do cliente, não só "sem engajamento".
//   2. Tickets de transbordo abertos há muito tempo sem resposta → exatamente
//      o padrão "fornecedor sumiu" que as reclamações de mercado descrevem.
//   3. Dias sem nenhuma atividade (execução OU conversa) → sinal mais citado
//      de todos nos estudos de churn preditivo: uso caindo PRECEDE o
//      cancelamento, quase sempre por semanas.
//
// Um quarto sinal, OPCIONAL e específico de nicho: taxa de chargeback e
// devolução (`@/lib/chargebackRisk`), só avaliado quando o chamador passa
// `pedidos` — hoje, só o painel de Governança de um workspace de E-commerce
// faz isso (ver `HealthScorePanel`). Racional: um lojista sangrando em
// chargeback está perdendo dinheiro com o PRÓPRIO negócio, independente de o
// AgentFlow estar rodando bem — é um sinal de risco que a tríade genérica
// acima não captura, mas que prediz churn do cliente tão bem quanto os
// outros três (empresa em aperto financeiro corta ferramenta antes de
// cortar o próprio produto). Reaproveita os MESMOS limiares de alerta já
// usados no Radar de Chargeback — nunca inventa um segundo critério.
//
// Puro e determinístico: mesmos dados, mesma referência de tempo, mesmo
// resultado sempre — testável sem Firestore.

import type { Conversation, FlowRun, HandoffTicket, PedidoEcommerce } from "@/types";
import { calcularExposicaoChargebackDevolucao } from "./chargebackRisk";

export type NivelHealthScore = "saudavel" | "atencao" | "risco";

export interface SinalHealthScore {
  descricao: string;
  penalidade: number;
}

export interface HealthScoreResultado {
  /** 0 (risco máximo de churn) a 100 (saudável). */
  score: number;
  nivel: NivelHealthScore;
  /** `null` quando não há execução terminal (concluída/falhou) nos últimos 30 dias — nunca uma taxa inventada sobre zero dados. */
  taxaSucessoExecucoes: number | null;
  totalExecucoesConsideradas: number;
  ticketsAbertosVencidos: number;
  /** `null` quando o workspace nunca teve execução nem conversa registrada — pior sinal possível, tratado à parte da contagem de dias. */
  diasSemAtividade: number | null;
  /** `null` quando `pedidos` não foi informado ou está vazio — sinal específico de E-commerce, nunca avaliado para outros nichos. */
  taxaChargebackEDevolucao: number | null;
  /** Cada fator que pesou no score, em ordem de aplicação — a base de "por que este número", exibida no painel. */
  sinais: SinalHealthScore[];
}

/** Janela considerada para a taxa de sucesso de execuções. */
const JANELA_ATIVIDADE_DIAS = 30;
/** A partir de quantas horas sem decisão um ticket aberto/em análise conta como "vencido" para o score (não é o SLA formal do ticket — é um sinal de atenção mais cedo que isso). */
const LIMIAR_TICKET_VENCIDO_HORAS = 48;

const LIMIAR_SUCESSO_CRITICO = 0.7;
const PENALIDADE_SUCESSO_CRITICO = 30;
const LIMIAR_SUCESSO_ATENCAO = 0.9;
const PENALIDADE_SUCESSO_ATENCAO = 15;

const LIMIAR_TICKETS_CRITICO = 3;
const PENALIDADE_TICKETS_CRITICO = 30;
const PENALIDADE_TICKETS_ATENCAO = 15;

const PENALIDADE_NUNCA_TEVE_ATIVIDADE = 40;
const LIMIAR_INATIVIDADE_CRITICA_DIAS = 14;
const PENALIDADE_INATIVIDADE_CRITICA = 35;
const LIMIAR_INATIVIDADE_ATENCAO_DIAS = 7;
const PENALIDADE_INATIVIDADE_ATENCAO = 15;

const LIMIAR_NIVEL_SAUDAVEL = 70;
const LIMIAR_NIVEL_ATENCAO = 40;

/** Mesmos limiares de `@/lib/chargebackRisk` (4%/7,5%) — nunca um segundo critério inventado aqui. */
const PENALIDADE_CHARGEBACK_CRITICO = 25;
const PENALIDADE_CHARGEBACK_ATENCAO = 10;

function dataMaisRecente(isos: Array<string | undefined>): Date | null {
  let maisRecente: Date | null = null;
  for (const iso of isos) {
    if (!iso) continue;
    const data = new Date(iso);
    if (!Number.isFinite(data.getTime())) continue;
    if (!maisRecente || data.getTime() > maisRecente.getTime()) maisRecente = data;
  }
  return maisRecente;
}

export interface CalcularHealthScoreInput {
  execucoes: FlowRun[];
  tickets: HandoffTicket[];
  conversas: Conversation[];
  /** Opcional e específico de E-commerce — ver nota de topo. Ausente ou vazio: o sinal de chargeback simplesmente não é avaliado (nunca penaliza por falta de dado). */
  pedidos?: PedidoEcommerce[];
  referencia?: Date;
}

export function calcularHealthScore(input: CalcularHealthScoreInput): HealthScoreResultado {
  const referencia = input.referencia ?? new Date();
  const inicioJanela = referencia.getTime() - JANELA_ATIVIDADE_DIAS * 24 * 60 * 60 * 1000;

  const execucoesNaJanela = input.execucoes.filter((run) => {
    const instante = new Date(run.iniciadoEm).getTime();
    return Number.isFinite(instante) && instante >= inicioJanela && instante <= referencia.getTime();
  });
  const terminais = execucoesNaJanela.filter((run) => run.status === "concluido" || run.status === "falhou");
  const concluidas = terminais.filter((run) => run.status === "concluido").length;
  const taxaSucessoExecucoes = terminais.length > 0 ? concluidas / terminais.length : null;

  const ticketsAbertosVencidos = input.tickets.filter((ticket) => {
    if (ticket.status !== "aberto" && ticket.status !== "em-analise") return false;
    const idadeHoras = (referencia.getTime() - new Date(ticket.criadoEm).getTime()) / (60 * 60 * 1000);
    return Number.isFinite(idadeHoras) && idadeHoras >= LIMIAR_TICKET_VENCIDO_HORAS;
  }).length;

  const ultimaAtividade = dataMaisRecente([
    ...input.execucoes.map((run) => run.iniciadoEm),
    ...input.conversas.map((conversa) => conversa.ultimaMensagemEm ?? conversa.criadaEm),
  ]);
  const diasSemAtividade = ultimaAtividade
    ? Math.max(0, Math.round((referencia.getTime() - ultimaAtividade.getTime()) / (24 * 60 * 60 * 1000)))
    : null;

  let score = 100;
  const sinais: SinalHealthScore[] = [];

  if (taxaSucessoExecucoes !== null && taxaSucessoExecucoes < LIMIAR_SUCESSO_CRITICO) {
    score -= PENALIDADE_SUCESSO_CRITICO;
    sinais.push({
      descricao: `Taxa de sucesso de execuções abaixo de ${Math.round(LIMIAR_SUCESSO_CRITICO * 100)}% nos últimos ${JANELA_ATIVIDADE_DIAS} dias`,
      penalidade: PENALIDADE_SUCESSO_CRITICO,
    });
  } else if (taxaSucessoExecucoes !== null && taxaSucessoExecucoes < LIMIAR_SUCESSO_ATENCAO) {
    score -= PENALIDADE_SUCESSO_ATENCAO;
    sinais.push({
      descricao: `Taxa de sucesso de execuções abaixo de ${Math.round(LIMIAR_SUCESSO_ATENCAO * 100)}% nos últimos ${JANELA_ATIVIDADE_DIAS} dias`,
      penalidade: PENALIDADE_SUCESSO_ATENCAO,
    });
  }

  if (ticketsAbertosVencidos >= LIMIAR_TICKETS_CRITICO) {
    score -= PENALIDADE_TICKETS_CRITICO;
    sinais.push({
      descricao: `${ticketsAbertosVencidos} tickets de transbordo abertos há mais de ${LIMIAR_TICKET_VENCIDO_HORAS}h, sem decisão`,
      penalidade: PENALIDADE_TICKETS_CRITICO,
    });
  } else if (ticketsAbertosVencidos >= 1) {
    score -= PENALIDADE_TICKETS_ATENCAO;
    sinais.push({
      descricao: `${ticketsAbertosVencidos} ticket(s) de transbordo aberto(s) há mais de ${LIMIAR_TICKET_VENCIDO_HORAS}h, sem decisão`,
      penalidade: PENALIDADE_TICKETS_ATENCAO,
    });
  }

  if (diasSemAtividade === null) {
    score -= PENALIDADE_NUNCA_TEVE_ATIVIDADE;
    sinais.push({ descricao: "Nenhuma execução ou conversa registrada ainda neste workspace", penalidade: PENALIDADE_NUNCA_TEVE_ATIVIDADE });
  } else if (diasSemAtividade > LIMIAR_INATIVIDADE_CRITICA_DIAS) {
    score -= PENALIDADE_INATIVIDADE_CRITICA;
    sinais.push({
      descricao: `${diasSemAtividade} dias sem nenhuma execução ou conversa`,
      penalidade: PENALIDADE_INATIVIDADE_CRITICA,
    });
  } else if (diasSemAtividade > LIMIAR_INATIVIDADE_ATENCAO_DIAS) {
    score -= PENALIDADE_INATIVIDADE_ATENCAO;
    sinais.push({
      descricao: `${diasSemAtividade} dias sem nenhuma execução ou conversa`,
      penalidade: PENALIDADE_INATIVIDADE_ATENCAO,
    });
  }

  const chargeback =
    input.pedidos && input.pedidos.length > 0 ? calcularExposicaoChargebackDevolucao(input.pedidos) : null;

  if (chargeback !== null) {
    if (chargeback.nivelAlerta === "critico") {
      score -= PENALIDADE_CHARGEBACK_CRITICO;
      sinais.push({
        descricao: `${Math.round(chargeback.taxaChargebackEDevolucao * 100)}% dos pedidos do mês em chargeback/devolução — acima da média documentada de incidentes do e-commerce (~7,5%)`,
        penalidade: PENALIDADE_CHARGEBACK_CRITICO,
      });
    } else if (chargeback.nivelAlerta === "atencao") {
      score -= PENALIDADE_CHARGEBACK_ATENCAO;
      sinais.push({
        descricao: `${Math.round(chargeback.taxaChargebackEDevolucao * 100)}% dos pedidos do mês em chargeback/devolução — já em nível de atenção`,
        penalidade: PENALIDADE_CHARGEBACK_ATENCAO,
      });
    }
  }

  score = Math.max(0, Math.min(100, score));
  const nivel: NivelHealthScore =
    score >= LIMIAR_NIVEL_SAUDAVEL ? "saudavel" : score >= LIMIAR_NIVEL_ATENCAO ? "atencao" : "risco";

  return {
    score,
    nivel,
    taxaSucessoExecucoes: taxaSucessoExecucoes !== null ? Math.round(taxaSucessoExecucoes * 10000) / 10000 : null,
    totalExecucoesConsideradas: terminais.length,
    ticketsAbertosVencidos,
    diasSemAtividade,
    taxaChargebackEDevolucao: chargeback !== null ? chargeback.taxaChargebackEDevolucao : null,
    sinais,
  };
}
