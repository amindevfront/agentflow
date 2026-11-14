// Persistência dos dossiês monitorados pelo Fleet & SPOT Driver Onboarding —
// mesmo padrão de `@/lib/documentosPendentes`. O motor de decisão em si
// (`avaliarDossieMotoristaSpot`, `decidirProximaAcaoOnboardingSpot`) vive em
// `@/lib/spotDriverOnboarding`, puro e sem Firestore — este arquivo só
// lê/escreve os registros e mantém `status`/`pendencias` sempre coerentes
// com os documentos recém-atualizados (recomputado aqui, nunca confiado do
// chamador, mesmo racional de validação server-side que o resto do produto
// aplica a dado que entra pelo cliente).

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
import type { DocumentoMotoristaSpot, DossieMotoristaSpot, TipoDocumentoMotoristaSpot } from "@/types";
import { DOCUMENTOS_OBRIGATORIOS_SPOT, avaliarDossieMotoristaSpot } from "./spotDriverOnboarding";
import { auth, db } from "./firebase";
import { DEFAULT_WORKSPACE_ID, requireDb } from "./firestore";
import { enfileirarEscrita } from "./offlineQueue";

const COLECAO = "motoristasSpot";

function novoId(): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `motorista_${aleatorio}`;
}

export interface CriarMotoristaSpotInput {
  nomeMotorista: string;
  placaVeiculo?: string | null;
  workspaceId?: string;
}

export async function criarMotoristaSpot(entrada: CriarMotoristaSpotInput): Promise<DossieMotoristaSpot> {
  return enfileirarEscrita("Cadastrar motorista SPOT", async () => {
    const database = requireDb();
    const agoraIso = new Date().toISOString();
    const dossie: DossieMotoristaSpot = {
      id: novoId(),
      workspaceId: entrada.workspaceId ?? DEFAULT_WORKSPACE_ID,
      nomeMotorista: entrada.nomeMotorista,
      placaVeiculo: entrada.placaVeiculo ?? null,
      documentos: [],
      status: "amarelo",
      pendencias: ["Nenhum documento recebido ainda."],
      ticketAbertoEm: null,
      criadoEm: agoraIso,
      atualizadoEm: agoraIso,
    };
    await setDoc(doc(database, COLECAO, dossie.id), dossie);
    return dossie;
  });
}

export function subscribeMotoristasSpot(
  onChange: (dossies: DossieMotoristaSpot[]) => void,
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
      onChange(snapshot.docs.map((d: QueryDocumentSnapshot) => ({ ...(d.data() as DossieMotoristaSpot), id: d.id }))),
    (erro) => {
      console.error("[motoristasSpot] falha ao assinar dossiês de motoristas SPOT:", erro);
      onChange([]);
    }
  );
}

/**
 * Registra/atualiza UM documento do dossiê e recomputa `status`/`pendencias`
 * a partir do conjunto completo — nunca um patch parcial que deixaria o
 * semáforo desatualizado. `ticketAbertoEm` é zerado sempre que o `status`
 * muda, para que o tick (`@/lib/server/spotDriverOnboardingAdmin`) saiba que
 * esta é uma transição NOVA e precise decidir de novo.
 */
export async function atualizarDocumentoMotoristaSpot(
  dossie: DossieMotoristaSpot,
  documento: Pick<DocumentoMotoristaSpot, "tipo" | "status" | "validadeEm">
): Promise<void> {
  return enfileirarEscrita("Atualizar documento de motorista SPOT", async () => {
    const database = requireDb();
    const outros = dossie.documentos.filter((d) => d.tipo !== documento.tipo);
    const documentos: DocumentoMotoristaSpot[] = [
      ...outros,
      { ...documento, recebidoEm: new Date().toISOString() },
    ];
    const avaliacao = avaliarDossieMotoristaSpot(documentos);

    await updateDoc(doc(database, COLECAO, dossie.id), {
      documentos,
      status: avaliacao.status,
      pendencias: avaliacao.pendencias,
      atualizadoEm: new Date().toISOString(),
      ...(avaliacao.status !== dossie.status ? { ticketAbertoEm: null } : {}),
    });
  });
}

/**
 * Aprovação humana de 1 clique — fecha o ciclo do dossiê já validado pelo
 * Shield-Layer (`status: "verde"`): a partir daqui `decidirProximaAcaoOnboardingSpot`
 * passa a devolver sempre `aguardar-documentos` (ver `dossie.aprovadoEm`) e o
 * tick nunca mais reabre ticket para este motorista. `aprovadoPor` registra
 * quem liberou a frota — mesma exigência de trilha auditável de
 * `resolverTicket` (`@/lib/humanInTheLoop`), aqui como campo direto do
 * dossiê em vez de ticket, porque a aprovação é uma ação sobre o CADASTRO do
 * motorista, não sobre o ticket HITL que apenas a sinalizou.
 */
export async function aprovarMotoristaSpot(dossie: DossieMotoristaSpot): Promise<void> {
  return enfileirarEscrita("Aprovar motorista SPOT", async () => {
    const uid = auth?.currentUser?.uid;
    if (!uid) throw new Error("É necessário estar autenticado para aprovar um motorista SPOT.");

    const database = requireDb();
    await updateDoc(doc(database, COLECAO, dossie.id), {
      aprovadoEm: new Date().toISOString(),
      aprovadoPor: uid,
      atualizadoEm: new Date().toISOString(),
    });
  });
}

/** Tipos de documento ainda sem entrada no dossiê — guia o próximo passo da triagem (ver `gerarMensagemSolicitacaoDocumento`). */
export function documentosFaltantes(dossie: Pick<DossieMotoristaSpot, "documentos">): TipoDocumentoMotoristaSpot[] {
  const presentes = new Set(dossie.documentos.map((d) => d.tipo));
  return DOCUMENTOS_OBRIGATORIOS_SPOT.filter((tipo) => !presentes.has(tipo));
}
