"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth";
import { getAppUser, getWorkspace, persistWorkspace, workspaceRef } from "./firestore";
import { withTimeout, retryWithTimeout } from "./promiseUtils";
import { readPendingProfile, clearPendingProfile } from "./pendingWorkspace";
import type { AppUser } from "@/types";

const READ_TIMEOUT_MS = 3000;

type Status = "loading" | "ready" | "error";

interface WorkspaceContextValue {
  appUser: AppUser | null;
  workspaceId: string | null;
  loading: boolean;
  /** `true` enquanto existe gravação de workspace/perfil ainda não confirmada no Firestore. */
  pendingSync: boolean;
  /** Falha definitiva (timeout/erro) sem nenhum perfil — nem confirmado, nem otimista — para mostrar. */
  error: boolean;
  retry: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

const RECONCILE_MAX_ATTEMPTS = 4;
const RECONCILE_TIMEOUT_MS = 5000;
const RECONCILE_BASE_DELAY_MS = 2000;

/**
 * Resolve o perfil (`AppUser`) e o workspace do usuário autenticado —
 * com resiliência de rede de ponta a ponta (ver ADR-0003):
 *
 *   1. Lê `users/{uid}` com limite de 3s (`withTimeout`).
 *   2. Doc não existe (resposta rápida e definitiva) → sem fallback pendente
 *      → é onboarding de verdade, manda para `/onboarding`.
 *   3. Doc não existe/timeout/erro, MAS existe um perfil otimista local
 *      (gravado por `/onboarding` quando a sincronização com o Firestore
 *      não confirmou a tempo) → usa esse perfil imediatamente. A app nunca
 *      trava em "Carregando…" por causa disso.
 *   4. Doc EXISTE (perfil confirmado) mas ainda há um registro pendente para
 *      este uid → o perfil já é real, só o workspace pode não ter
 *      confirmado a própria gravação (ex.: a aba foi recarregada no meio da
 *      sincronização em segundo plano do onboarding, que não sobrevive a um
 *      reload). Continua tentando `persistWorkspace` em segundo plano até
 *      confirmar, sem bloquear a navegação.
 *   5. Timeout/erro SEM perfil otimista (ex.: usuário antigo, rede ruim) →
 *      estado de erro recuperável (`retry`) — nunca um spinner infinito, e
 *      nunca um redirecionamento "cego" para `/onboarding` (que arriscaria
 *      criar um SEGUNDO workspace para quem já tem um).
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [pendingSync, setPendingSync] = useState(false);
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    setStatus("loading");

    withTimeout(getAppUser(user.uid), READ_TIMEOUT_MS)
      .then(async (found) => {
        if (cancelled) return;

        if (found) {
          setAppUser(found);
          setStatus("ready");

          const pending = readPendingProfile(user.uid);
          if (!pending) {
            setPendingSync(false);
            return;
          }
          // Perfil já é real; falta só confirmar se o workspace em si
          // chegou a ser gravado (ver item 4 do docblock acima).
          setPendingSync(true);
          const existing = await getWorkspace(found.workspaceId).catch(() => null);
          if (cancelled) return;
          if (existing) {
            clearPendingProfile(user.uid);
            setPendingSync(false);
            return;
          }
          const result = await retryWithTimeout(
            () => persistWorkspace(workspaceRef(found.workspaceId), pending.workspace),
            {
              maxAttempts: RECONCILE_MAX_ATTEMPTS,
              timeoutMs: RECONCILE_TIMEOUT_MS,
              baseDelayMs: RECONCILE_BASE_DELAY_MS,
            }
          );
          if (cancelled) return;
          if (result.ok) {
            clearPendingProfile(user.uid);
            setPendingSync(false);
          } else {
            console.error("[workspace] reconciliação em segundo plano esgotou as tentativas:", result.error);
          }
          return;
        }

        const pending = readPendingProfile(user.uid);
        if (pending) {
          setAppUser(pending.appUser);
          setPendingSync(true);
          setStatus("ready");
          return;
        }
        router.replace("/onboarding");
      })
      .catch(() => {
        if (cancelled) return;
        const pending = readPendingProfile(user.uid);
        if (pending) {
          setAppUser(pending.appUser);
          setPendingSync(true);
          setStatus("ready");
          return;
        }
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [user, authLoading, router, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const loading = authLoading || !user || status === "loading";

  return (
    <WorkspaceContext.Provider
      value={{
        appUser,
        workspaceId: appUser?.workspaceId ?? null,
        loading,
        pendingSync,
        error: status === "error",
        retry,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace deve ser usado dentro de <WorkspaceProvider>");
  return ctx;
}
