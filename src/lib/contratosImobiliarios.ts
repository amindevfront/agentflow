// Persistência dos contratos de compra de unidade — Radar de Risco de
// Distrato (nicho Construtora/Incorporadora). O cálculo financeiro em si
// (`calcularExposicaoFinanceiraDistrato`) vive em `@/lib/distrato`, puro e
// sem Firestore — este arquivo só lê/escreve os registros.

import {
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import type { ContratoImobiliario, StatusContratoImobiliario } from "@/types";
import { db } from "./firebase";
import { DEFAULT_WORKSPACE_ID, requireDb } from "./firestore";
import { enfileirarEscrita } from "./offlineQueue";
import { PROXIMO_STATUS_DISTRATO } from "./distrato";

const COLECAO = "contratosImobiliarios";

/** Tolerância padrão sugerida no formulário — editável pelo operador, nunca aplicada em silêncio no cálculo (ver `@/lib/distrato`). */
export const TOLERANCIA_ATRASO_SUGERIDA_DIAS = 180;

function novoId(): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `contrato_${aleatorio}`;
}

export interface CriarContratoInput {
  compradorNome: string;
  unidade: string;
  valorContratoBrl: number;
  valorPagoBrl: number;
  dataPrevistaEntrega: string;
  toleranciaAtrasoDias?: number;
  patrimonioDeAfetacao?: boolean;
  conversationId?: string | null;
  workspaceId?: string;
  criadoPor: string;
}

export async function criarContratoImobiliario(entrada: CriarContratoInput): Promise<ContratoImobiliario> {
  return enfileirarEscrita("Criar contrato imobiliário", async () => {
    const database = requireDb();
    const contrato: ContratoImobiliario = {
      id: novoId(),
      workspaceId: entrada.workspaceId ?? DEFAULT_WORKSPACE_ID,
      conversationId: entrada.conversationId ?? null,
      compradorNome: entrada.compradorNome,
      unidade: entrada.unidade,
      valorContratoBrl: entrada.valorContratoBrl,
      valorPagoBrl: entrada.valorPagoBrl,
      dataPrevistaEntrega: entrada.dataPrevistaEntrega,
      dataEntregaRealizadaEm: null,
      toleranciaAtrasoDias: entrada.toleranciaAtrasoDias ?? TOLERANCIA_ATRASO_SUGERIDA_DIAS,
      patrimonioDeAfetacao: entrada.patrimonioDeAfetacao ?? false,
      status: "ativo",
      distratoSolicitadoEm: null,
      criadoEm: new Date().toISOString(),
      criadoPor: entrada.criadoPor,
    };
    await setDoc(doc(database, COLECAO, contrato.id), contrato);
    return contrato;
  });
}

export function subscribeContratosImobiliarios(
  onChange: (contratos: ContratoImobiliario[]) => void,
  workspaceId = DEFAULT_WORKSPACE_ID
): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const consulta = query(collection(db, COLECAO), where("workspaceId", "==", workspaceId));
  return onSnapshot(
    consulta,
    (snapshot) =>
      onChange(snapshot.docs.map((d: QueryDocumentSnapshot) => ({ ...(d.data() as ContratoImobiliario), id: d.id }))),
    (erro) => {
      console.error("[contratosImobiliarios] falha ao assinar contratos:", erro);
      onChange([]);
    }
  );
}

/**
 * Avança o status do contrato para a próxima etapa do fluxo de distrato
 * (ativo → distrato-solicitado → distrato-formalizado). Registra o instante
 * em `distratoSolicitadoEm` na primeira transição — nunca sobrescrito nas
 * seguintes, para preservar quando o pedido chegou de fato.
 */
export async function avancarStatusDistrato(contrato: ContratoImobiliario): Promise<void> {
  const proximo = PROXIMO_STATUS_DISTRATO[contrato.status];
  if (!proximo) return;

  return enfileirarEscrita("Avançar status de distrato", async () => {
    const database = requireDb();
    const campos: Partial<ContratoImobiliario> & { status: StatusContratoImobiliario } = { status: proximo };
    if (proximo === "distrato-solicitado" && !contrato.distratoSolicitadoEm) {
      campos.distratoSolicitadoEm = new Date().toISOString();
    }
    await updateDoc(doc(database, COLECAO, contrato.id), campos);
  });
}

/** Registra a entrega efetiva da unidade — congela o cálculo de atraso no instante informado. */
export async function registrarEntregaUnidade(contrato: ContratoImobiliario, entregueEm = new Date()): Promise<void> {
  return enfileirarEscrita("Registrar entrega da unidade", async () => {
    const database = requireDb();
    await updateDoc(doc(database, COLECAO, contrato.id), { dataEntregaRealizadaEm: entregueEm.toISOString() });
  });
}
