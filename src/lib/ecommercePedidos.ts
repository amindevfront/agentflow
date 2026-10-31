// Pedidos de E-commerce — base de dados real para o Radar de Risco de
// Chargeback & Devolução (`@/lib/chargebackRisk`).
//
// Mesma honestidade arquitetural do resto do app: ferramenta de registro
// manual nesta versão — a integração real com um gateway de pagamento
// (Shopify, Stripe, Mercado Pago, etc.) é trabalho futuro (conector
// dedicado). Isto garante que o radar tenha dados estruturados reais para
// calcular sobre, no mesmo espírito de `criarCarga` (`@/lib/shipments`) e
// `criarAgendamento` (`@/lib/appointments`).

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
import type { PedidoEcommerce, StatusPedidoEcommerce } from "@/types";
import { db } from "./firebase";
import { DEFAULT_WORKSPACE_ID, requireDb } from "./firestore";
import { enfileirarEscrita } from "./offlineQueue";

const COLECAO = "pedidosEcommerce";

function novoId(): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `pedido_${aleatorio}`;
}

export interface CriarPedidoInput {
  numeroPedido: string;
  valorBrl: number;
  status?: StatusPedidoEcommerce;
  workspaceId?: string;
}

/** Cria um registro de pedido — nasce como "pago" por padrão, salvo indicação em contrário. */
export async function criarPedido(entrada: CriarPedidoInput): Promise<PedidoEcommerce> {
  return enfileirarEscrita("Criar pedido", async () => {
    const database = requireDb();
    const pedido: PedidoEcommerce = {
      id: novoId(),
      workspaceId: entrada.workspaceId ?? DEFAULT_WORKSPACE_ID,
      numeroPedido: entrada.numeroPedido.trim(),
      valorBrl: Math.max(0, entrada.valorBrl),
      status: entrada.status ?? "pago",
      motivoChargeback: null,
      criadoEm: new Date().toISOString(),
    };
    await setDoc(doc(database, COLECAO, pedido.id), pedido);
    return pedido;
  });
}

/**
 * Atualiza o status de um pedido. `motivoChargeback` só é persistido quando
 * o novo status é "chargeback" — transicionar para qualquer outro status
 * nunca deixa um motivo "fantasma" de uma disputa anterior gravado no
 * documento.
 */
export async function atualizarStatusPedido(
  pedido: PedidoEcommerce,
  novoStatus: StatusPedidoEcommerce,
  motivoChargeback?: string
): Promise<void> {
  return enfileirarEscrita("Atualizar status do pedido", async () => {
    const database = requireDb();
    await updateDoc(doc(database, COLECAO, pedido.id), {
      status: novoStatus,
      motivoChargeback: novoStatus === "chargeback" ? motivoChargeback?.trim() || null : null,
    });
  });
}

export function subscribePedidos(
  onChange: (pedidos: PedidoEcommerce[]) => void,
  workspaceId = DEFAULT_WORKSPACE_ID
): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const consulta = query(collection(db, COLECAO), where("workspaceId", "==", workspaceId));
  return onSnapshot(
    consulta,
    (snapshot) => onChange(snapshot.docs.map((d: QueryDocumentSnapshot) => ({ ...(d.data() as PedidoEcommerce), id: d.id }))),
    (erro) => {
      console.error("[ecommercePedidos] falha ao assinar pedidos:", erro);
      onChange([]);
    }
  );
}
