// Demurrage Clock — radar de custo oculto de sobre-estadia (nicho Logística/Comex).
//
// Por que isto existe: a causa mais citada de custo NÃO PREVISTO numa
// importação não é o frete, é a demurrage — a cobrança diária que o armador
// aplica quando o contêiner fica retido além do free time contratado,
// geralmente por atraso na documentação/desembaraço aduaneiro. É um custo
// que cresce em silêncio, dia após dia, até a fatura chegar — o padrão
// documentado do setor é "a fatura é a primeira vez que alguém olha para
// isso". Este módulo torna esse relógio visível ENQUANTO ele ainda está
// correndo, não depois.
//
// Honestidade do número (mesma regra de `@/lib/roi`): sem `freeTimeDias` e
// `custoDiarioDemurrageBrl` configurados no contrato daquela carga
// específica, a função não estima nada — cada contrato de frete tem termos
// diferentes, e aplicar um valor "típico" aqui seria exatamente o tipo de
// estimativa silenciosa que rompe a confiança na primeira fatura real.
//
// Puro e determinístico: mesma carga, mesma referência de tempo, mesmo
// resultado sempre — testável sem Firestore.

import type { Shipment } from "@/types";

export type NivelAlertaDemurrage = "dentro-do-free-time" | "proximo-do-limite" | "acumulando-custo" | "evitado";

/** A partir de quantos dias restantes de free time o alerta vira "próximo do limite". */
const LIMIAR_PROXIMO_DO_LIMITE_DIAS = 2;

export interface RiscoDemurrage {
  /** Instante em que a carga entrou em "aduana" — início da contagem do free time. */
  chegadaAduanaEm: string;
  /** Dias já decorridos desde a chegada na aduana, até a referência (ou até a entrega, se já entregue). */
  diasDecorridos: number;
  /** Dias de free time ainda restantes — 0 quando já excedido. */
  diasLivresRestantes: number;
  /** Dias excedentes ao free time contratado — base da cobrança de demurrage. */
  diasExcedentes: number;
  /** Custo projetado/acumulado de demurrage, em BRL. */
  custoProjetadoBrl: number;
  nivelAlerta: NivelAlertaDemurrage;
}

/** Primeiro instante em que a carga entrou em status "aduana", segundo o histórico. */
function instanteChegadaAduana(carga: Shipment): Date | null {
  const evento = carga.historico.find((e) => e.status === "aduana");
  if (!evento) return null;
  const instante = new Date(evento.ocorridoEm);
  return Number.isFinite(instante.getTime()) ? instante : null;
}

/**
 * Calcula o risco de demurrage de uma carga, a partir dos termos de free
 * time/custo diário configurados nela.
 *
 * Devolve `null` quando:
 *  - `freeTimeDias` ou `custoDiarioDemurrageBrl` não foram configurados (sem
 *    termo de contrato, sem estimativa — ver nota de honestidade acima);
 *  - a carga ainda não chegou à aduana (o relógio nem começou a correr).
 *
 * Carga já entregue: o cálculo CONGELA no instante da entrega (mesmo padrão
 * de `calcularDesvioSla` em `@/lib/shipments`) — depois que o contêiner foi
 * devolvido, o relógio da demurrage parou, ele não continua crescendo.
 */
export function calcularRiscoDemurrage(carga: Shipment, referencia = new Date()): RiscoDemurrage | null {
  const freeTimeDias = carga.freeTimeDias;
  const custoDiarioBrl = carga.custoDiarioDemurrageBrl;
  if (
    typeof freeTimeDias !== "number" ||
    !Number.isFinite(freeTimeDias) ||
    freeTimeDias < 0 ||
    typeof custoDiarioBrl !== "number" ||
    !Number.isFinite(custoDiarioBrl) ||
    custoDiarioBrl < 0
  ) {
    return null;
  }

  const chegada = instanteChegadaAduana(carga);
  if (!chegada) return null;

  const eventoEntrega = carga.historico.find((e) => e.status === "entregue");
  const instanteComparacao =
    carga.status === "entregue" && eventoEntrega ? new Date(eventoEntrega.ocorridoEm) : referencia;

  const diasDecorridosBrutos = (instanteComparacao.getTime() - chegada.getTime()) / (24 * 60 * 60 * 1000);
  const diasDecorridos = Math.max(0, Math.round(diasDecorridosBrutos * 10) / 10);

  const diasExcedentes = Math.max(0, Math.round((diasDecorridos - freeTimeDias) * 10) / 10);
  const diasLivresRestantes = Math.max(0, Math.round((freeTimeDias - diasDecorridos) * 10) / 10);
  const custoProjetadoBrl = Math.round(diasExcedentes * custoDiarioBrl * 100) / 100;

  let nivelAlerta: NivelAlertaDemurrage;
  if (carga.status === "entregue") {
    nivelAlerta = diasExcedentes > 0 ? "acumulando-custo" : "evitado";
  } else if (diasExcedentes > 0) {
    nivelAlerta = "acumulando-custo";
  } else if (diasLivresRestantes <= LIMIAR_PROXIMO_DO_LIMITE_DIAS) {
    nivelAlerta = "proximo-do-limite";
  } else {
    nivelAlerta = "dentro-do-free-time";
  }

  return {
    chegadaAduanaEm: chegada.toISOString(),
    diasDecorridos,
    diasLivresRestantes,
    diasExcedentes,
    custoProjetadoBrl,
    nivelAlerta,
  };
}
