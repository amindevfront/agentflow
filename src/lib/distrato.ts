// Radar de Risco de Distrato — exposição financeira real (nicho
// Construtora/Incorporadora).
//
// Por que isto existe: o padrão documentado de distrato imobiliário no
// Brasil (Lei 13.786/2018) tem duas faixas de desfecho MUITO diferentes:
//
//   - Comprador desiste sem culpa da construtora: a incorporadora pode
//     reter até 25% do valor pago (até 50% se a incorporação estiver sob
//     patrimônio de afetação) e devolve o restante em até 12 parcelas
//     mensais, a partir de 30 dias depois da formalização.
//   - Construtora atrasa a entrega além da tolerância contratual: a culpa
//     passa a ser da empresa, e o comprador tem direito a receber de volta
//     100% do que pagou — não há retenção.
//
// O detalhe que este módulo torna visível ANTES de alguém perguntar: a
// tolerância contratual (mercado pratica até 180 dias, mas cada contrato
// define o próprio prazo — por isso é um campo do contrato, nunca uma
// constante universal) corre em silêncio desde a data prevista de entrega.
// No dia em que ela se esgota, a exposição financeira da empresa salta de
// "25-50% retidos" para "100% devido" — automaticamente, mesmo que nenhum
// comprador tenha pedido nada ainda. É o mesmo tipo de relógio silencioso
// que o Demurrage Clock (`@/lib/demurrage`) torna visível na logística.
//
// Puro e determinístico: mesmo contrato, mesma referência de tempo, mesmo
// resultado sempre — testável sem Firestore.
//
// Decisão deliberada de escopo: este módulo calcula a exposição financeira,
// NUNCA gera um texto para enviar ao comprador. Diferente dos lembretes de
// agendamento ou da triagem de carga, dizer a um comprador "a empresa está
// em culpa, você tem direito a 100%" é uma afirmação jurídica que precisa de
// revisão humana/jurídica antes de qualquer envio — o painel mostra o
// número para o OPERADOR/jurídico decidir o que fazer, não sugere uma
// resposta automática de chat.

import type { ContratoImobiliario, StatusContratoImobiliario } from "@/types";

/** Percentual de retenção padrão (sem patrimônio de afetação), Lei 13.786/2018. */
export const PERCENTUAL_RETENCAO_PADRAO = 0.25;

/** Percentual de retenção quando a incorporação está sob patrimônio de afetação, Lei 13.786/2018. */
export const PERCENTUAL_RETENCAO_PATRIMONIO_AFETACAO = 0.5;

/** A partir de quantos dias restantes de tolerância o alerta vira "próximo do limite". */
const LIMIAR_PROXIMO_DO_LIMITE_DIAS = 30;

export type NivelAlertaDistrato =
  | "dentro-do-prazo"
  | "tolerancia-proxima-do-limite"
  | "culpa-construtora-configurada"
  | "distrato-em-andamento";

export interface ExposicaoFinanceiraDistrato {
  /** `true` quando o atraso de entrega já superou a tolerância contratual — a culpa deixou de ser do comprador. */
  culpaConstrutora: boolean;
  /** Dias de atraso ALÉM da tolerância contratual — 0 enquanto ainda dentro do prazo. */
  diasAtrasoAlemTolerancia: number;
  /** Dias restantes até a tolerância se esgotar — 0 quando já esgotada ou quando a unidade já foi entregue. */
  diasRestantesTolerancia: number;
  /** Percentual que a construtora pode reter do valor pago — 0 quando a culpa é da construtora. */
  percentualRetencao: number;
  valorRetidoBrl: number;
  /** Valor que a construtora deveria devolver ao comprador neste cenário. */
  valorAReembolsarBrl: number;
  nivelAlerta: NivelAlertaDistrato;
}

function arredondar(valor: number, casas = 2): number {
  const fator = 10 ** casas;
  return Math.round(valor * fator) / fator;
}

function diasEntre(msA: number, msB: number): number {
  return arredondar((msA - msB) / (24 * 60 * 60 * 1000), 1);
}

/**
 * Calcula a exposição financeira de um contrato sob risco de distrato.
 *
 * Unidade já entregue: o cálculo CONGELA no instante da entrega (mesmo
 * padrão de `calcularDesvioSla` e `calcularRiscoDemurrage`) — depois que a
 * unidade foi entregue, se a culpa já estava configurada por atraso, ela
 * permanece registrada; se não estava, não volta a correr.
 */
export function calcularExposicaoFinanceiraDistrato(
  contrato: ContratoImobiliario,
  referencia = new Date()
): ExposicaoFinanceiraDistrato {
  const prazoPrevisto = new Date(contrato.dataPrevistaEntrega).getTime();
  const toleranciaMs = Math.max(0, contrato.toleranciaAtrasoDias) * 24 * 60 * 60 * 1000;
  const prazoFinalTolerancia = prazoPrevisto + toleranciaMs;

  const entregue = Boolean(contrato.dataEntregaRealizadaEm);
  const instanteComparacao = entregue
    ? new Date(contrato.dataEntregaRealizadaEm as string).getTime()
    : referencia.getTime();

  const diasAtrasoAlemTolerancia = Math.max(0, diasEntre(instanteComparacao, prazoFinalTolerancia));
  const culpaConstrutora = diasAtrasoAlemTolerancia > 0;

  const diasRestantesTolerancia =
    !entregue && !culpaConstrutora ? Math.max(0, diasEntre(prazoFinalTolerancia, referencia.getTime())) : 0;

  const percentualRetencao = culpaConstrutora
    ? 0
    : contrato.patrimonioDeAfetacao
      ? PERCENTUAL_RETENCAO_PATRIMONIO_AFETACAO
      : PERCENTUAL_RETENCAO_PADRAO;

  const valorPago = Math.max(0, contrato.valorPagoBrl);
  const valorRetidoBrl = arredondar(valorPago * percentualRetencao);
  const valorAReembolsarBrl = arredondar(valorPago - valorRetidoBrl);

  let nivelAlerta: NivelAlertaDistrato;
  if (contrato.status !== "ativo") {
    nivelAlerta = "distrato-em-andamento";
  } else if (culpaConstrutora) {
    nivelAlerta = "culpa-construtora-configurada";
  } else if (!entregue && diasRestantesTolerancia <= LIMIAR_PROXIMO_DO_LIMITE_DIAS) {
    nivelAlerta = "tolerancia-proxima-do-limite";
  } else {
    nivelAlerta = "dentro-do-prazo";
  }

  return {
    culpaConstrutora,
    diasAtrasoAlemTolerancia,
    diasRestantesTolerancia,
    percentualRetencao,
    valorRetidoBrl,
    valorAReembolsarBrl,
    nivelAlerta,
  };
}

/** Transições de status válidas — nunca "ressuscita" um distrato formalizado de volta para ativo por engano. */
export const PROXIMO_STATUS_DISTRATO: Record<StatusContratoImobiliario, StatusContratoImobiliario | null> = {
  ativo: "distrato-solicitado",
  "distrato-solicitado": "distrato-formalizado",
  "distrato-formalizado": null,
};
