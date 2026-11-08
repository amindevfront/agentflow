// Persistência dos documentos/faturas monitorados pelo AR Recovery Engine —
// mesmo padrão de `@/lib/contratosImobiliarios`. O motor de decisão em si
// (`decidirProximaAcaoCobranca`, `classificarUrgenciaCobranca`) vive em
// `@/lib/server/arRecoveryEngine`, puro e sem Firestore — este arquivo só
// lê/escreve os registros.

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
import type { DocumentoPendente, StatusDocumentoPendente } from "@/types";
import { db } from "./firebase";
import { DEFAULT_WORKSPACE_ID, requireDb } from "./firestore";
import { enfileirarEscrita } from "./offlineQueue";

const COLECAO = "documentosPendentes";

function novoId(): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `doc_${aleatorio}`;
}

export interface CriarDocumentoPendenteInput {
  tipo: DocumentoPendente["tipo"];
  referencia: string;
  devedorNome: string;
  devedorContato?: string | null;
  valorBrl?: number | null;
  vencimentoEm: string;
  workspaceId?: string;
}

export async function criarDocumentoPendente(entrada: CriarDocumentoPendenteInput): Promise<DocumentoPendente> {
  return enfileirarEscrita("Cadastrar documento pendente", async () => {
    const database = requireDb();
    const documento: DocumentoPendente = {
      id: novoId(),
      workspaceId: entrada.workspaceId ?? DEFAULT_WORKSPACE_ID,
      tipo: entrada.tipo,
      referencia: entrada.referencia,
      devedorNome: entrada.devedorNome,
      devedorContato: entrada.devedorContato ?? null,
      valorBrl: entrada.valorBrl ?? null,
      vencimentoEm: entrada.vencimentoEm,
      status: "pendente",
      tentativasCobranca: 0,
      ultimaCobrancaEm: null,
      criadoEm: new Date().toISOString(),
    };
    await setDoc(doc(database, COLECAO, documento.id), documento);
    return documento;
  });
}

export function subscribeDocumentosPendentes(
  onChange: (documentos: DocumentoPendente[]) => void,
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
      onChange(snapshot.docs.map((d: QueryDocumentSnapshot) => ({ ...(d.data() as DocumentoPendente), id: d.id }))),
    (erro) => {
      console.error("[documentosPendentes] falha ao assinar documentos pendentes:", erro);
      onChange([]);
    }
  );
}

/** Baixa manual (ex.: pagamento confirmado fora da automação) — sempre uma decisão explícita do operador. */
export async function atualizarStatusDocumentoPendente(
  documento: DocumentoPendente,
  status: StatusDocumentoPendente
): Promise<void> {
  return enfileirarEscrita("Atualizar status de documento pendente", async () => {
    const database = requireDb();
    await updateDoc(doc(database, COLECAO, documento.id), { status });
  });
}
