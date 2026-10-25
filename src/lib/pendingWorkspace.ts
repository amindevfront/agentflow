// Fallback otimista de onboarding (ver docs/architecture/adr-0003 e
// src/lib/workspace.tsx). Quando a gravação em Firestore de um workspace
// recém-criado não confirma a tempo (rede lenta/instável), guardamos aqui o
// perfil que JÁ foi mostrado ao usuário, para que um refresh/nova navegação
// na mesma aba não o jogue de volta para `/onboarding` enquanto a
// sincronização em segundo plano ainda não terminou.
//
// Escopo deliberadamente limitado a `sessionStorage` (não `localStorage`):
// é um estado transitório de UMA sessão de onboarding, nunca uma fonte de
// verdade — a fonte de verdade é sempre o documento em `users/{uid}` no
// Firestore. Se `sessionStorage` não estiver disponível (SSR, navegador
// restritivo), cai para um mapa em memória — ainda correto dentro do mesmo
// carregamento de página, só não sobrevive a um refresh.

import type { AppUser, Workspace } from "@/types";

export interface PendingProfile {
  appUser: AppUser;
  workspace: Workspace;
  /** ISO timestamp de quando o fallback foi registrado — usado para expirar entradas antigas. */
  criadoEm: string;
}

const PREFIX = "agentflow:pendingWorkspace:";
const TTL_MS = 30 * 60 * 1000; // 30min — além disso, confiar num perfil não sincronizado é arriscado demais.

const memoryFallback = new Map<string, string>();

function storage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    // Acesso a sessionStorage pode lançar (modo privado restrito) — cai para memória.
  }
  return {
    getItem: (key: string) => memoryFallback.get(key) ?? null,
    setItem: (key: string, value: string) => memoryFallback.set(key, value),
    removeItem: (key: string) => memoryFallback.delete(key),
  };
}

export function savePendingProfile(uid: string, profile: Omit<PendingProfile, "criadoEm">): void {
  try {
    storage().setItem(PREFIX + uid, JSON.stringify({ ...profile, criadoEm: new Date().toISOString() }));
  } catch {
    // Falha ao persistir o fallback não pode derrubar o fluxo principal.
  }
}

export function readPendingProfile(uid: string): PendingProfile | null {
  try {
    const raw = storage().getItem(PREFIX + uid);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingProfile;
    if (Date.now() - new Date(parsed.criadoEm).getTime() > TTL_MS) {
      clearPendingProfile(uid);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingProfile(uid: string): void {
  try {
    storage().removeItem(PREFIX + uid);
  } catch {
    // Nada a fazer — pior caso é a entrada expirar pelo TTL.
  }
}
