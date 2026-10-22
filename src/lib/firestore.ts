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
import type {
  AppUser,
  Connector,
  Flow,
  FlowRun,
  Invite,
  TeamMember,
  Workspace,
} from "@/types";

// Workspace único seedado para a v1 (ver docs/architecture/adr-0001-workspace-model.md).
// Todas as queries filtram por workspaceId mesmo havendo apenas um workspace hoje,
// para que a evolução para multi-tenant não exija migração de schema.
export const DEFAULT_WORKSPACE_ID = "default";

function requireDb() {
  if (!db) {
    throw new Error(
      "Firestore não configurado. Preencha .env.local com as credenciais do Firebase."
    );
  }
  return db;
}

/** Garante que o workspace default existe (idempotente). Chamado após o primeiro login. */
export async function ensureDefaultWorkspace(): Promise<Workspace> {
  const database = requireDb();
  const ref = doc(database, "workspaces", DEFAULT_WORKSPACE_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { nome: "AgentFlow" });
  }
  return { id: DEFAULT_WORKSPACE_ID, nome: snap.data()?.nome ?? "AgentFlow" };
}

export async function updateWorkspaceName(nome: string): Promise<void> {
  const database = requireDb();
  await setDoc(doc(database, "workspaces", DEFAULT_WORKSPACE_ID), { nome }, { merge: true });
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
  criadoPor: string
): Promise<string> {
  const database = requireDb();
  const ref = await addDoc(collection(database, "invites"), {
    email,
    papel,
    workspaceId: DEFAULT_WORKSPACE_ID,
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

export function subscribeFlows(onChange: (flows: Flow[]) => void): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const q = query(
    collection(db, "flows"),
    where("workspaceId", "==", DEFAULT_WORKSPACE_ID),
    orderBy("atualizadoEm", "desc")
  );
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Flow));
  });
}

export async function createFlow(input: Omit<Flow, "id" | "workspaceId" | "atualizadoEm">): Promise<string> {
  const database = requireDb();
  const ref = await addDoc(collection(database, "flows"), {
    ...input,
    workspaceId: DEFAULT_WORKSPACE_ID,
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

export function subscribeFlowRuns(onChange: (runs: FlowRun[]) => void): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const q = query(
    collection(db, "flowRuns"),
    where("workspaceId", "==", DEFAULT_WORKSPACE_ID),
    orderBy("iniciadoEm", "desc")
  );
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FlowRun));
  });
}

// ---------- Connectors ----------

export function subscribeConnectors(onChange: (connectors: Connector[]) => void): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const q = query(collection(db, "connectors"), where("workspaceId", "==", DEFAULT_WORKSPACE_ID));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Connector));
  });
}

export async function createConnector(
  input: Omit<Connector, "id" | "workspaceId" | "atualizadoEm">
): Promise<string> {
  const database = requireDb();
  const ref = await addDoc(collection(database, "connectors"), {
    ...input,
    workspaceId: DEFAULT_WORKSPACE_ID,
    atualizadoEm: new Date().toISOString(),
  });
  return ref.id;
}

// ---------- Team ----------

export function subscribeTeamMembers(onChange: (members: TeamMember[]) => void): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const q = query(collection(db, "users"), where("workspaceId", "==", DEFAULT_WORKSPACE_ID));
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

export function subscribePendingInvites(onChange: (invites: Invite[]) => void): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const q = query(
    collection(db, "invites"),
    where("workspaceId", "==", DEFAULT_WORKSPACE_ID),
    where("status", "==", "pendente")
  );
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Invite));
  });
}

export { serverTimestamp, getDocs, requireDb };
