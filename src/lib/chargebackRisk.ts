// Radar de Risco de Chargeback & Devolução (nicho E-commerce).
//
// Por que isto existe: nenhum módulo de nicho cobria E-commerce até agora —
// só o perfil de atendimento em `@/lib/nichePrompts`. Pesquisa de mercado
// sobre reclamações de lojistas em comunidades de e-commerce (outubro de
// 2026) documenta dois ralos de caixa que o lojista raramente vê somados num
// único número:
//
//   1. Até ~7,5% das transações online carregam algum tipo de
//      fraude/contestação/não-entrega — o lojista perde o produto SEM
//      receber por ele.
//   2. A taxa de processamento do pagamento (ordem de 2,9% + valor fixo,
//      padrão documentado de gateways como Shopify Payments) frequentemente
//      NÃO é devolvida ao lojista mesmo quando o pedido é reembolsado — e
//      ainda existe uma taxa fixa adicional por disputa de chargeback.
//
// Este módulo soma os três: produto perdido + taxa de processamento retida
// + taxa fixa de disputa — o número completo que nenhum extrato de gateway
// mostra de uma vez só.
//
// Honestidade do número (mesma regra de todo módulo financeiro deste
// produto): os percentuais de taxa/disputa são parâmetros do workspace —
// cada adquirente/gateway cobra diferente. Sem configuração explícita, usa-se
// o valor de referência documentado na pesquisa de origem (nunca um "custo
// zero" silencioso, que esconderia o problema do lojista).
//
// Puro e determinístico: mesma lista de pedidos, mesma configuração, mesmo
// resultado sempre — testável sem Firestore.

import type { PedidoEcommerce } from "@/types";

export type NivelAlertaChargeback = "saudavel" | "atencao" | "critico";

/** Referência de mercado: taxa de processamento retida mesmo em reembolso (ex.: Shopify Payments, ~2,9% + fixo). */
export const PERCENTUAL_TAXA_RETIDA_PADRAO = 0.029;
/** Referência de mercado: taxa fixa cobrada por disputa de chargeback pela adquirente. */
export const TAXA_FIXA_CHARGEBACK_BRL_PADRAO = 80;
/** A partir de qual taxa combinada (chargeback + devolução) o alerta vira "atenção". */
const LIMIAR_ATENCAO = 0.04;
/** A partir de qual taxa combinada o alerta vira "crítico" — na faixa documentada de incidentes do e-commerce em geral (~7,5%). */
const LIMIAR_CRITICO = 0.075;

export interface ConfigExposicaoChargeback {
  percentualTaxaRetida?: number;
  taxaFixaChargebackBrl?: number;
}

export interface ExposicaoChargebackResultado {
  totalPedidos: number;
  totalChargeback: number;
  totalDevolvido: number;
  /** (chargeback + devolução) sobre os pedidos elegíveis (exclui cancelados antes do pagamento seguir adiante). */
  taxaChargebackEDevolucao: number;
  custoProdutoPerdidoBrl: number;
  custoTaxasRetidasBrl: number;
  custoTaxasFixasChargebackBrl: number;
  custoTotalBrl: number;
  nivelAlerta: NivelAlertaChargeback;
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
 * Calcula a exposição financeira combinada de chargeback e devolução sobre
 * um conjunto de pedidos (tipicamente já filtrado por período pelo
 * chamador, no mesmo espírito de `periodoMesAtual` em `@/lib/roi`).
 */
export function calcularExposicaoChargebackDevolucao(
  pedidos: PedidoEcommerce[],
  config: ConfigExposicaoChargeback = {}
): ExposicaoChargebackResultado {
  const percentualTaxaRetida = config.percentualTaxaRetida ?? PERCENTUAL_TAXA_RETIDA_PADRAO;
  const taxaFixaChargeback = config.taxaFixaChargebackBrl ?? TAXA_FIXA_CHARGEBACK_BRL_PADRAO;

  let totalChargeback = 0;
  let totalDevolvido = 0;
  let custoProdutoPerdidoBrl = 0;
  let custoTaxasRetidasBrl = 0;

  // Cancelado antes de seguir adiante nunca chegou a cobrar do cliente nem a
  // gerar taxa de processamento — fora do denominador, de propósito (mesmo
  // raciocínio de "cancelado" em `@/lib/noShowCost`: não é uma perda certa).
  const elegiveis = pedidos.filter((pedido) => pedido.status !== "cancelado");

  for (const pedido of elegiveis) {
    const valor = Math.max(0, pedido.valorBrl);
    if (pedido.status === "chargeback") {
      totalChargeback += 1;
      custoProdutoPerdidoBrl += valor;
      custoTaxasRetidasBrl += valor * percentualTaxaRetida;
    } else if (pedido.status === "devolvido") {
      totalDevolvido += 1;
      custoTaxasRetidasBrl += valor * percentualTaxaRetida;
    }
  }

  const custoTaxasFixasChargebackBrl = totalChargeback * taxaFixaChargeback;
  const custoTotalBrl = custoProdutoPerdidoBrl + custoTaxasRetidasBrl + custoTaxasFixasChargebackBrl;
  const taxaChargebackEDevolucao = razaoSegura(totalChargeback + totalDevolvido, elegiveis.length);

  let nivelAlerta: NivelAlertaChargeback;
  if (taxaChargebackEDevolucao >= LIMIAR_CRITICO) nivelAlerta = "critico";
  else if (taxaChargebackEDevolucao >= LIMIAR_ATENCAO) nivelAlerta = "atencao";
  else nivelAlerta = "saudavel";

  return {
    totalPedidos: pedidos.length,
    totalChargeback,
    totalDevolvido,
    taxaChargebackEDevolucao: arredondar(taxaChargebackEDevolucao, 4),
    custoProdutoPerdidoBrl: arredondar(custoProdutoPerdidoBrl),
    custoTaxasRetidasBrl: arredondar(custoTaxasRetidasBrl),
    custoTaxasFixasChargebackBrl: arredondar(custoTaxasFixasChargebackBrl),
    custoTotalBrl: arredondar(custoTotalBrl),
    nivelAlerta,
  };
}
