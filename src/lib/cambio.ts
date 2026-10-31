// Radar de Exposição Cambial — custo oculto de variação do dólar no frete
// internacional (nicho Logística & Portos / Comex).
//
// Por que isto existe: no transporte marítimo internacional, o frete básico,
// os reajustes gerais (GRI), as sobretaxas de pico/combustível e boa parte
// das taxas de armador nascem em dólar — e, na importação FOB/FCA, é o
// importador brasileiro quem paga essa parcela em moeda estrangeira
// (pesquisa de mercado sobre comex, outubro de 2026). Quem não trava o
// câmbio no momento da contratação sente a alta inteira depois — e a alta
// pode ser rápida: a mesma pesquisa documenta o dólar subindo ~8% em poucos
// dias após uma eleição, inflando de uma vez só o frete, o AFRMM e a
// sobrestadia de uma operação já em andamento. É exatamente o tipo de
// instabilidade política que o dono de uma transportadora/importadora
// brasileira vive hoje — este módulo transforma essa instabilidade em um
// número de exposição financeira, enquanto a carga ainda está em trânsito,
// em vez de descobrir no fechamento da fatura.
//
// Honestidade do número (mesma regra de `@/lib/demurrage` e `@/lib/roi`):
// sem `valorFreteUsd` e `cambioContratadoBrl` configurados naquela carga
// específica, a função não estima nada. O "câmbio atual" é sempre recebido
// por parâmetro — este módulo nunca busca cotação em tempo real por conta
// própria; o chamador normalmente passa `RoiConfig.cambioUsdBrl` do próprio
// workspace (já configurável pelo cliente, ver `RoiConfigPanel`).
//
// Puro e determinístico: mesma carga, mesmo câmbio de referência, mesmo
// resultado sempre — testável sem Firestore.

import type { Shipment } from "@/types";

export type NivelAlertaCambial = "cambio-favoravel" | "dentro-da-margem" | "exposicao-relevante" | "exposicao-critica";

/** A partir de qual alta percentual do câmbio o alerta vira "exposição relevante". */
const LIMIAR_RELEVANTE = 0.05;
/**
 * A partir de qual alta percentual do câmbio o alerta vira "exposição
 * crítica" — mesma ordem de grandeza da alta de câmbio pós-eleitoral
 * documentada no mercado brasileiro (ver nota de topo).
 */
const LIMIAR_CRITICO = 0.08;

export interface ExposicaoCambial {
  custoContratadoBrl: number;
  custoAtualBrl: number;
  /** Positivo = custo subiu desde a contratação (exposição); negativo = câmbio ficou favorável. */
  variacaoBrl: number;
  variacaoPercentual: number;
  nivelAlerta: NivelAlertaCambial;
}

function arredondar(valor: number, casas = 2): number {
  const fator = 10 ** casas;
  return Math.round(valor * fator) / fator;
}

/**
 * Calcula a exposição cambial de uma carga com frete em USD.
 *
 * Devolve `null` quando `valorFreteUsd` ou `cambioContratadoBrl` não foram
 * configurados nesta carga, ou quando `cambioAtualBrl` recebido é inválido —
 * nunca assume um câmbio "típico" em silêncio.
 */
export function calcularExposicaoCambial(carga: Shipment, cambioAtualBrl: number): ExposicaoCambial | null {
  const valorFreteUsd = carga.valorFreteUsd;
  const cambioContratado = carga.cambioContratadoBrl;

  if (
    typeof valorFreteUsd !== "number" ||
    !Number.isFinite(valorFreteUsd) ||
    valorFreteUsd < 0 ||
    typeof cambioContratado !== "number" ||
    !Number.isFinite(cambioContratado) ||
    cambioContratado <= 0 ||
    !Number.isFinite(cambioAtualBrl) ||
    cambioAtualBrl <= 0
  ) {
    return null;
  }

  const custoContratadoBrl = arredondar(valorFreteUsd * cambioContratado);
  const custoAtualBrl = arredondar(valorFreteUsd * cambioAtualBrl);
  const variacaoBrl = arredondar(custoAtualBrl - custoContratadoBrl);
  const variacaoPercentual = arredondar((cambioAtualBrl - cambioContratado) / cambioContratado, 4);

  let nivelAlerta: NivelAlertaCambial;
  if (variacaoPercentual <= 0) nivelAlerta = "cambio-favoravel";
  else if (variacaoPercentual >= LIMIAR_CRITICO) nivelAlerta = "exposicao-critica";
  else if (variacaoPercentual >= LIMIAR_RELEVANTE) nivelAlerta = "exposicao-relevante";
  else nivelAlerta = "dentro-da-margem";

  return { custoContratadoBrl, custoAtualBrl, variacaoBrl, variacaoPercentual, nivelAlerta };
}
