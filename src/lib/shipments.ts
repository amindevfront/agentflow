// Rastreio operacional inteligente — triagem de status de carga e desvio de
// SLA (nicho Logística). Cruza o código de rastreio informado pelo cliente
// contra os dados estruturados já no Firestore — não inventa status: se a
// carga não existe na base, a triagem diz isso explicitamente, nunca
// "adivinha" uma resposta plausível.

import {
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  where,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import type { Shipment, ShipmentStatus } from "@/types";
import { db } from "./firebase";
import { DEFAULT_WORKSPACE_ID, requireDb } from "./firestore";
import { enfileirarEscrita } from "./offlineQueue";

const COLECAO = "shipments";

/** Limites de severidade do desvio de SLA, em horas de atraso. */
const LIMIAR_BAIXA_H = 0;
const LIMIAR_MEDIA_H = 6;
const LIMIAR_ALTA_H = 24;

export type SeveridadeDesvio = "nenhum" | "baixa" | "media" | "alta";

export interface DesvioSla {
  emAtraso: boolean;
  /** Horas de desvio em relação à previsão de entrega — negativo nunca aparece (clamp em 0). */
  horasDesvio: number;
  severidade: SeveridadeDesvio;
}

function severidadePorHoras(horas: number): SeveridadeDesvio {
  if (horas <= LIMIAR_BAIXA_H) return "nenhum";
  if (horas < LIMIAR_MEDIA_H) return "baixa";
  if (horas < LIMIAR_ALTA_H) return "media";
  return "alta";
}

/**
 * Calcula o desvio de SLA de uma carga.
 *
 * Carga já entregue: compara o último evento do histórico contra a previsão
 * (desvio congelado no momento da entrega). Carga ainda em trânsito: compara
 * a referência (agora) contra a previsão — o desvio cresce enquanto a carga
 * não chega.
 */
export function calcularDesvioSla(carga: Shipment, referencia = new Date()): DesvioSla {
  const previsao = new Date(carga.previsaoEntrega).getTime();
  if (!Number.isFinite(previsao)) return { emAtraso: false, horasDesvio: 0, severidade: "nenhum" };

  const instanteComparacao =
    carga.status === "entregue"
      ? new Date(carga.historico[carga.historico.length - 1]?.ocorridoEm ?? carga.atualizadoEm).getTime()
      : referencia.getTime();

  if (!Number.isFinite(instanteComparacao)) return { emAtraso: false, horasDesvio: 0, severidade: "nenhum" };

  const horasDesvio = Math.max(0, (instanteComparacao - previsao) / (60 * 60 * 1000));
  return {
    emAtraso: horasDesvio > 0,
    horasDesvio: Math.round(horasDesvio * 10) / 10,
    severidade: severidadePorHoras(horasDesvio),
  };
}

/** Busca por código de rastreio — comparação case-insensitive e sem espaços nas pontas. */
export function buscarCargaPorCodigo(cargas: Shipment[], codigo: string): Shipment | null {
  const normalizado = codigo.trim().toUpperCase();
  if (!normalizado) return null;
  return cargas.find((c) => c.codigoRastreio.trim().toUpperCase() === normalizado) ?? null;
}

/**
 * Extrai um possível código de rastreio de um texto livre (mensagem do
 * cliente) — padrão genérico (2 a 5 letras + 5 a 12 dígitos, com ou sem
 * hífen), o formato mais comum entre transportadoras. Falha de forma
 * silenciosa (`null`) quando nada compatível é encontrado — nunca inventa
 * um código a partir de outro número qualquer na frase.
 */
export function extrairCodigoRastreio(texto: string): string | null {
  const encontrado = texto.match(/\b([A-Za-z]{2,5}-?\d{5,12})\b/);
  return encontrado ? encontrado[1].toUpperCase() : null;
}

export interface CriarCargaInput {
  codigoRastreio: string;
  origem: string;
  destino: string;
  previsaoEntrega: string;
  status?: ShipmentStatus;
  workspaceId?: string;
}

/**
 * Cria um registro de carga. Ferramenta de demonstração/operação manual
 * nesta versão — o cruzamento real com uma transportadora/TMS externo é
 * trabalho futuro (conector dedicado); isto só garante que a triagem tenha
 * dados estruturados reais para consultar, no mesmo espírito do
 * `PayloadSimulator` dos fluxos.
 */
export async function criarCarga(entrada: CriarCargaInput): Promise<Shipment> {
  return enfileirarEscrita("Criar carga", async () => {
    const database = requireDb();
    const agora = new Date().toISOString();
    const carga: Shipment = {
      id: `ship_${entrada.codigoRastreio.trim().toUpperCase()}`,
      workspaceId: entrada.workspaceId ?? DEFAULT_WORKSPACE_ID,
      codigoRastreio: entrada.codigoRastreio.trim().toUpperCase(),
      origem: entrada.origem,
      destino: entrada.destino,
      status: entrada.status ?? "coletado",
      previsaoEntrega: entrada.previsaoEntrega,
      atualizadoEm: agora,
      criadoEm: agora,
      historico: [{ status: entrada.status ?? "coletado", ocorridoEm: agora }],
    };
    await setDoc(doc(database, COLECAO, carga.id), carga);
    return carga;
  });
}

export function subscribeShipments(
  onChange: (cargas: Shipment[]) => void,
  workspaceId = DEFAULT_WORKSPACE_ID
): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const consulta = query(collection(db, COLECAO), where("workspaceId", "==", workspaceId));
  return onSnapshot(
    consulta,
    (snapshot) => onChange(snapshot.docs.map((d: QueryDocumentSnapshot) => ({ ...(d.data() as Shipment), id: d.id }))),
    (erro) => {
      console.error("[shipments] falha ao assinar cargas:", erro);
      onChange([]);
    }
  );
}
