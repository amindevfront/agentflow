// Catálogo de anexos rápidos por nicho — memorial descritivo, plantas e
// tabela de disponibilidade (Imobiliário/Construtoras). Guardado como LINKS,
// não upload de arquivo — ver a nota em `@/types` (`NicheAttachment`) sobre
// por que Storage não é usado nesta versão.

import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  deleteDoc,
  where,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import type { NicheAttachment, NicheAttachmentTipo } from "@/types";
import { db } from "./firebase";
import { DEFAULT_WORKSPACE_ID, requireDb } from "./firestore";
import { sanitizeText, sanitizeUrl } from "./sanitize";
import { enfileirarEscrita } from "./offlineQueue";

const COLECAO = "nicheAttachments";

function novoId(): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `natt_${aleatorio}`;
}

export const ROTULO_TIPO_ANEXO: Record<NicheAttachmentTipo, string> = {
  "memorial-descritivo": "Memorial descritivo",
  planta: "Planta",
  "tabela-disponibilidade": "Tabela de disponibilidade",
  outro: "Outro",
};

export interface CriarAnexoInput {
  nome: string;
  tipo: NicheAttachmentTipo;
  url: string;
  workspaceId?: string;
  criadoPor: string;
}

export async function criarAnexoDeNicho(entrada: CriarAnexoInput): Promise<NicheAttachment> {
  return enfileirarEscrita("Adicionar anexo rápido", async () => {
    const database = requireDb();
    const anexo: NicheAttachment = {
      id: novoId(),
      workspaceId: entrada.workspaceId ?? DEFAULT_WORKSPACE_ID,
      nome: sanitizeText(entrada.nome, 120),
      tipo: entrada.tipo,
      url: sanitizeUrl(entrada.url),
      criadoEm: new Date().toISOString(),
      criadoPor: entrada.criadoPor,
    };
    await setDoc(doc(database, COLECAO, anexo.id), anexo);
    return anexo;
  });
}

export function subscribeNicheAttachments(
  onChange: (anexos: NicheAttachment[]) => void,
  workspaceId = DEFAULT_WORKSPACE_ID
): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const consulta = query(
    collection(db, COLECAO),
    where("workspaceId", "==", workspaceId),
    orderBy("criadoEm", "desc")
  );
  return onSnapshot(
    consulta,
    (snapshot) => onChange(snapshot.docs.map((d: QueryDocumentSnapshot) => ({ ...(d.data() as NicheAttachment), id: d.id }))),
    (erro) => {
      console.error("[nicheAttachments] falha ao assinar anexos:", erro);
      onChange([]);
    }
  );
}

export async function removerAnexoDeNicho(id: string): Promise<void> {
  return enfileirarEscrita("Remover anexo rápido", async () => {
    const database = requireDb();
    await deleteDoc(doc(database, COLECAO, id));
  });
}

/** Formata o anexo para inserção rápida na caixa de resposta da Neural Inbox. */
export function formatarAnexoParaMensagem(anexo: NicheAttachment): string {
  return `${ROTULO_TIPO_ANEXO[anexo.tipo]} — ${anexo.nome}: ${anexo.url}`;
}
