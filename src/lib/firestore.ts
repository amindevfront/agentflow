import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import { NICHE_PRESETS } from "./niches";
import type {
  AppUser,
  Connector,
  Flow,
  FlowRun,
  Invite,
  NicheKey,
  TeamMember,
  Workspace,
} from "@/types";

// Identificador do workspace seedado antes do onboarding por nicho existir
// (ver docs/architecture/adr-0001-workspace-model.md). Mantido apenas como
// fallback de leitura para instalações antigas — outros módulos (roi, inbox,
// credentials, auditLog, humanInTheLoop, campaigns) ainda o usam como default
// de parâmetros opcionais. Workspaces criados via /onboarding recebem um id
// próprio gerado pelo Firestore (ver `prepareWorkspace`), nunca este valor.
export const DEFAULT_WORKSPACE_ID = "default";

function requireDb() {
  if (!db) {
    throw new Error(
      "Firestore não configurado. Preencha .env.local com as credenciais do Firebase."
    );
  }
  return db;
}

/**
 * Monta a referência e o payload de um novo workspace (tenant) SEM
 * gravá-los — `doc(collection(...))` gera o id no cliente, sem round-trip de
 * rede. Isso permite ao onboarding conhecer o `workspaceId` definitivo
 * imediatamente e navegar de forma otimista enquanto `persistWorkspace`
 * confirma a escrita em segundo plano (ver ADR-0003 e `src/lib/workspace.tsx`)
 * — sem esse desacoplamento, uma gravação lenta resultaria em dois ids
 * diferentes (o otimista e o que o Firestore de fato persistiu).
 */
export function prepareWorkspace(nome: string, setor: NicheKey) {
  const database = requireDb();
  const ref = doc(collection(database, "workspaces"));
  const workspace: Workspace = {
    id: ref.id,
    nome,
    setor,
    criadoEm: new Date().toISOString(),
    playbooksSugeridos: NICHE_PRESETS[setor].playbooksSugeridos,
  };
  return { ref, workspace };
}

export async function persistWorkspace(
  ref: ReturnType<typeof prepareWorkspace>["ref"],
  workspace: Workspace
): Promise<void> {
  await setDoc(ref, workspace);
}

/** Referência a um workspace de id conhecido — para reconciliar uma gravação otimista pendente (ver ADR-0003). */
export function workspaceRef(workspaceId: string) {
  return doc(requireDb(), "workspaces", workspaceId);
}

export async function getWorkspace(workspaceId: string): Promise<Workspace | null> {
  const database = requireDb();
  const snap = await getDoc(doc(database, "workspaces", workspaceId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Workspace) : null;
}

export async function updateWorkspaceName(workspaceId: string, nome: string): Promise<void> {
  const database = requireDb();
  await setDoc(doc(database, "workspaces", workspaceId), { nome }, { merge: true });
}

export async function upsertAppUser(user: AppUser): Promise<void> {
  const database = requireDb();
  await setDoc(doc(database, "users", user.uid), user, { merge: true });
}

export async function getAppUser(uid: string): Promise<AppUser | null> {
  const database = requireDb();
  const snap = await getDoc(doc(database, "users", uid));
  return snap.exists() ? (snap.data() as AppUser) : null;
}

// ---------- Invites ----------

export async function getInviteById(inviteId: string): Promise<Invite | null> {
  const database = requireDb();
  const snap = await getDoc(doc(database, "invites", inviteId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Invite) : null;
}

export async function createInvite(
  email: string,
  papel: Invite["papel"],
  workspaceId: string,
  criadoPor: string
): Promise<string> {
  const database = requireDb();
  const ref = await addDoc(collection(database, "invites"), {
    email,
    papel,
    workspaceId,
    status: "pendente" satisfies Invite["status"],
    criadoPor,
    criadoEm: new Date().toISOString(),
  });
  return ref.id;
}

export async function markInviteAccepted(inviteId: string): Promise<void> {
  const database = requireDb();
  await updateDoc(doc(database, "invites", inviteId), { status: "aceito" });
}

// ---------- Flows ----------

export function subscribeFlows(workspaceId: string, onChange: (flows: Flow[]) => void): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const q = query(
    collection(db, "flows"),
    where("workspaceId", "==", workspaceId),
    orderBy("atualizadoEm", "desc")
  );
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Flow));
  });
}

export async function createFlow(
  workspaceId: string,
  input: Omit<Flow, "id" | "workspaceId" | "atualizadoEm">
): Promise<string> {
  const database = requireDb();
  const ref = await addDoc(collection(database, "flows"), {
    ...input,
    workspaceId,
    atualizadoEm: new Date().toISOString(),
  });
  return ref.id;
}

export async function updateFlow(flowId: string, patch: Partial<Flow>): Promise<void> {
  const database = requireDb();
  await updateDoc(doc(database, "flows", flowId), {
    ...patch,
    atualizadoEm: new Date().toISOString(),
  });
}

// ---------- Flow Runs ----------
// Execuções reais são criadas pelo motor de orquestração (fora do escopo desta v1 de UI —
// ver "Riscos" em docs/prd/agentflow-project-brief.md). O simulador de payload roda
// isolado no cliente e NUNCA grava em flowRuns.

export function subscribeFlowRuns(workspaceId: string, onChange: (runs: FlowRun[]) => void): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const q = query(
    collection(db, "flowRuns"),
    where("workspaceId", "==", workspaceId),
    orderBy("iniciadoEm", "desc")
  );
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FlowRun));
  });
}

// ---------- Connectors ----------

export function subscribeConnectors(
  workspaceId: string,
  onChange: (connectors: Connector[]) => void
): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const q = query(collection(db, "connectors"), where("workspaceId", "==", workspaceId));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Connector));
  });
}

export async function createConnector(
  workspaceId: string,
  input: Omit<Connector, "id" | "workspaceId" | "atualizadoEm">
): Promise<string> {
  const database = requireDb();
  const ref = await addDoc(collection(database, "connectors"), {
    ...input,
    workspaceId,
    atualizadoEm: new Date().toISOString(),
  });
  return ref.id;
}

// ---------- Team ----------

export function subscribeTeamMembers(
  workspaceId: string,
  onChange: (members: TeamMember[]) => void
): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const q = query(collection(db, "users"), where("workspaceId", "==", workspaceId));
  return onSnapshot(q, (snap) => {
    onChange(
      snap.docs.map((d) => {
        const data = d.data() as AppUser;
        return {
          id: d.id,
          workspaceId: data.workspaceId,
          nome: data.nome,
          email: data.email,
          papel: data.papel,
          avatarUrl: data.avatarUrl,
        } satisfies TeamMember;
      })
    );
  });
}

export function subscribePendingInvites(
  workspaceId: string,
  onChange: (invites: Invite[]) => void
): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const q = query(
    collection(db, "invites"),
    where("workspaceId", "==", workspaceId),
    where("status", "==", "pendente")
  );
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Invite));
  });
}

export { serverTimestamp, getDocs, requireDb };
