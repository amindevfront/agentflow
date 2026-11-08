// Persistência dos documentos/contratos do Document AI Vault — mesmo
// padrão de `@/lib/contratosImobiliarios`. A análise em si (extração de
// cláusulas críticas, resumo executivo) vive em
// `@/lib/documentAiVault`, pura e sem Firestore — este arquivo só
// lê/escreve os registros. O texto já chega aqui MASCARADO pelo
// Shield-Layer (`interceptarMensagem`) — nunca o original em claro.

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
import type { ClausulaCritica, DocumentoContrato } from "@/types";
import { db } from "./firebase";
import { DEFAULT_WORKSPACE_ID, requireDb } from "./firestore";
import { enfileirarEscrita } from "./offlineQueue";

const COLECAO = "documentosContratos";

function novoId(): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `docvault_${aleatorio}`;
}

export interface SalvarDocumentoAnalisadoInput {
  nomeArquivo: string;
  textoMascarado: string;
  clausulasCriticas: ClausulaCritica[];
  resumoExecutivo: string | null;
  criadoPor: string;
  workspaceId?: string;
}

export async function salvarDocumentoAnalisado(entrada: SalvarDocumentoAnalisadoInput): Promise<DocumentoContrato> {
  return enfileirarEscrita("Salvar documento analisado", async () => {
    const database = requireDb();
    const agoraIso = new Date().toISOString();
    const documento: DocumentoContrato = {
      id: novoId(),
      workspaceId: entrada.workspaceId ?? DEFAULT_WORKSPACE_ID,
      nomeArquivo: entrada.nomeArquivo,
      status: "analisado",
      textoMascarado: entrada.textoMascarado,
      clausulasCriticas: entrada.clausulasCriticas,
      resumoExecutivo: entrada.resumoExecutivo,
      criadoEm: agoraIso,
      analisadoEm: agoraIso,
      criadoPor: entrada.criadoPor,
    };
    await setDoc(doc(database, COLECAO, documento.id), documento);
    return documento;
  });
}

export function subscribeDocumentosContratos(
  onChange: (documentos: DocumentoContrato[]) => void,
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
      onChange(
        snapshot.docs
          .map((d: QueryDocumentSnapshot) => ({ ...(d.data() as DocumentoContrato), id: d.id }))
          .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
      ),
    (erro) => {
      console.error("[documentosContratos] falha ao assinar documentos:", erro);
      onChange([]);
    }
  );
}
