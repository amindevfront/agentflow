// Cache local (não-otimista) do último perfil CONFIRMADO em `users/{uid}`
// (ver src/lib/workspace.tsx e ADR-0003). Diferente de `pendingWorkspace.ts`
// — que guarda uma gravação ainda não confirmada — este módulo só grava o
// que o Firestore já respondeu com sucesso, e serve de fallback quando uma
// leitura SUBSEQUENTE falha por timeout/rede: se o documento já existiu uma
// vez para este navegador, uma instabilidade pontual de rede não deve forçar
// o usuário a um estado de erro bloqueante nem arriscar mandá-lo de volta
// para `/onboarding` como se o workspace não existisse.
//
// `localStorage` (não `sessionStorage`): precisa sobreviver a uma nova aba/
// sessão do navegador, já que o cenário que justifica existir é justamente
// "a rede falhou agora", não "o perfil é transitório desta sessão".

import type { AppUser } from "@/types";

const PREFIX = "agentflow:confirmedProfile:";
// Generoso o bastante para cobrir instabilidades de rede reais, mas finito —
// depois disso, preferimos que uma leitura fresca (ou erro recuperável)
// decida, em vez de confiar indefinidamente numa cópia local.
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

interface CachedProfile {
  appUser: AppUser;
  confirmadoEm: string;
}

const memoryFallback = new Map<string, string>();

// Mesmo padrão de fallback de `pendingWorkspace.ts`: sem `localStorage`
// (SSR, navegador restritivo, ambiente de teste em Node) cai para um mapa em
// memória — ainda correto dentro do mesmo carregamento, só não sobrevive a
// um refresh real do navegador.
function storage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Acesso a localStorage pode lançar (modo privado restrito) — cai para memória.
  }
  return {
    getItem: (key: string) => memoryFallback.get(key) ?? null,
    setItem: (key: string, value: string) => memoryFallback.set(key, value),
    removeItem: (key: string) => memoryFallback.delete(key),
  };
}

export function saveConfirmedProfile(uid: string, appUser: AppUser): void {
  try {
    storage().setItem(PREFIX + uid, JSON.stringify({ appUser, confirmadoEm: new Date().toISOString() }));
  } catch {
    // Falha ao persistir o cache não pode derrubar o fluxo principal.
  }
}

export function readConfirmedProfile(uid: string): AppUser | null {
  try {
    const raw = storage().getItem(PREFIX + uid);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedProfile;
    if (Date.now() - new Date(parsed.confirmadoEm).getTime() > TTL_MS) {
      storage().removeItem(PREFIX + uid);
      return null;
    }
    return parsed.appUser;
  } catch {
    return null;
  }
}
