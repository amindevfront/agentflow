// Custo de Agenda Vazia — exposição financeira real de no-show (nichos
// Clínicas, Salão de Beleza & Barbearia, Serviços de Luxo).
//
// Por que isto existe: é uma lacuna documentada pelo próprio produto — o
// preset "no-show-agendamento" do Onboarding Cognitivo (`@/lib/onboardingQuiz`)
// avisa explicitamente que esta versão não tinha um módulo dedicado de custo
// de no-show, só lembretes de confirmação. Pesquisa de mercado sobre
// no-show em salões/clínicas (outubro de 2026) documenta taxa média de
// 15% a 30% sem automação — caindo para 5% ou menos com lembrete +
// confirmação + depósito — e que o custo de UM no-show isolado já cobre
// aluguel/insumos do horário vazio, além do próprio procedimento perdido.
// Este módulo fecha a lacuna: transforma "o cliente não veio" num número de
// receita perdida, igual ao que `@/lib/distrato` e `@/lib/demurrage` já
// fazem para os respectivos nichos deles.
//
// Honestidade do número (mesma regra de todo módulo financeiro deste
// produto): um agendamento sem `valorProcedimentoBrl` configurado entra no
// contador de volume, nunca no total financeiro — a fração exposta fica em
// `cobertura`. Cancelamentos (`status: "cancelado"`) NUNCA somam ao custo:
// diferente de um no-show, um cancelamento avisado pode ter sido reagendado
// para o mesmo horário, e contá-lo como perda certa inflaria o número.
//
// Puro e determinístico: mesma lista de agendamentos, mesmo resultado
// sempre — testável sem Firestore.

import type { Appointment } from "@/types";

export type NivelAlertaNoShow = "saudavel" | "atencao" | "critico";

/** A partir de qual taxa de no-show o alerta vira "atenção" — abaixo do piso documentado do setor sem automação (15%). */
const LIMIAR_ATENCAO = 0.1;
/** A partir de qual taxa de no-show o alerta vira "crítico" — dentro da faixa documentada do setor sem automação (15%-30%). */
const LIMIAR_CRITICO = 0.2;

export interface CustoAgendaVaziaResultado {
  totalAgendamentos: number;
  totalNoShow: number;
  totalRealizados: number;
  totalCancelados: number;
  /** No-shows sobre o total de desfechos "comparecimento decidido" (realizado + no-show) — cancelamento avisado fica fora do denominador, de propósito. */
  taxaNoShow: number;
  custoNoShowBrl: number;
  /** No-shows sem `valorProcedimentoBrl` configurado — não entraram em `custoNoShowBrl`. */
  agendamentosSemValorConfigurado: number;
  /** Fração dos no-shows que de fato sustenta `custoNoShowBrl` — avisa quando o número está parcial. */
  cobertura: number;
  nivelAlerta: NivelAlertaNoShow;
}

function arredondar(valor: number, casas = 2): number {
  const fator = 10 ** casas;
  return Math.round(valor * fator) / fator;
}

function razaoSegura(numerador: number, denominador: number): number {
  if (!Number.isFinite(numerador) || !Number.isFinite(denominador) || denominador === 0) return 0;
  return numerador / denominador;
}

/**
 * Calcula a exposição financeira de no-show sobre um conjunto de
 * agendamentos (tipicamente já filtrado por período pelo chamador, no mesmo
 * espírito de `periodoMesAtual` em `@/lib/roi`).
 */
export function calcularCustoAgendaVazia(agendamentos: Appointment[]): CustoAgendaVaziaResultado {
  let totalNoShow = 0;
  let totalRealizados = 0;
  let totalCancelados = 0;
  let custoNoShowBrl = 0;
  let noShowComValor = 0;

  for (const agendamento of agendamentos) {
    if (agendamento.status === "realizado") {
      totalRealizados += 1;
    } else if (agendamento.status === "cancelado") {
      totalCancelados += 1;
    } else if (agendamento.status === "no-show") {
      totalNoShow += 1;
      const valor = agendamento.valorProcedimentoBrl;
      if (typeof valor === "number" && Number.isFinite(valor) && valor > 0) {
        custoNoShowBrl += valor;
        noShowComValor += 1;
      }
    }
  }

  const taxaNoShow = razaoSegura(totalNoShow, totalRealizados + totalNoShow);

  let nivelAlerta: NivelAlertaNoShow;
  if (taxaNoShow >= LIMIAR_CRITICO) nivelAlerta = "critico";
  else if (taxaNoShow >= LIMIAR_ATENCAO) nivelAlerta = "atencao";
  else nivelAlerta = "saudavel";

  return {
    totalAgendamentos: agendamentos.length,
    totalNoShow,
    totalRealizados,
    totalCancelados,
    taxaNoShow: arredondar(taxaNoShow, 4),
    custoNoShowBrl: arredondar(custoNoShowBrl),
    agendamentosSemValorConfigurado: totalNoShow - noShowComValor,
    cobertura: arredondar(razaoSegura(noShowComValor, totalNoShow), 4),
    nivelAlerta,
  };
}
