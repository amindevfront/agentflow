"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth";
import { getAppUser, getWorkspace, persistWorkspace, workspaceRef } from "./firestore";
import { withTimeout, retryWithTimeout } from "./promiseUtils";
import { readPendingProfile, clearPendingProfile } from "./pendingWorkspace";
import { readConfirmedProfile, saveConfirmedProfile } from "./confirmedProfileCache";
import { codigoErroFirestore } from "./firestoreErrors";
import { reportarErro } from "./telemetry/errorReporting";
import type { AppUser } from "@/types";

const READ_TIMEOUT_MS = 3000;

interface WorkspaceContextValue {
  appUser: AppUser | null;
  workspaceId: string | null;
  loading: boolean;
  /** `true` enquanto existe gravação de workspace/perfil ainda não confirmada no Firestore. */
  pendingSync: boolean;
  /** Força uma nova tentativa de leitura/reconciliação — usado pelo banner de sincronização pendente. */
  retry: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

const RECONCILE_MAX_ATTEMPTS = 4;
const RECONCILE_TIMEOUT_MS = 5000;
const RECONCILE_BASE_DELAY_MS = 2000;

/**
 * Resolve o perfil (`AppUser`) e o workspace do usuário autenticado — com
 * resiliência de rede de ponta a ponta e SEM nenhum estado de erro
 * bloqueante (ver ADR-0006, que substitui o item 4 do ADR-0003):
 *
 *   1. Só dispara a leitura com o estado do Firebase Auth já resolvido
 *      (`onAuthStateChanged` concluído) e com `user` presente — nunca uma
 *      consulta órfã/não autenticada.
 *   2. Lê `users/{uid}` com limite rígido de 3s (`withTimeout`).
 *   3. Doc não existe (resposta definitiva) → sem fallback pendente/confirmado
 *      → onboarding de verdade → `/onboarding`.
 *   4. Doc não existe/timeout/erro (qualquer código — `permission-denied`,
 *      `unavailable`, `deadline-exceeded` ou outro, sempre logado via
 *      `reportarErro` antes de decidir), MAS existe um perfil otimista local
 *      (gravação do onboarding ainda sincronizando) → usa esse perfil.
 *   5. Doc não existe/timeout/erro, mas este navegador já confirmou este
 *      perfil antes (`confirmedProfileCache`) → usa a cópia confirmada; uma
 *      instabilidade pontual não força um usuário existente a recriar o
 *      workspace.
 *   6. Doc EXISTE (perfil confirmado) mas ainda há um registro pendente para
 *      este uid → o perfil já é real, só o workspace pode não ter
 *      confirmado a própria gravação (ex.: a aba foi recarregada no meio da
 *      sincronização em segundo plano do onboarding). Continua tentando
 *      `persistWorkspace` em segundo plano até confirmar, sem bloquear a
 *      navegação.
 *   7. Nenhum dos fallbacks acima se aplica → `router.replace("/onboarding")`
 *      imediato. Nunca um spinner infinito, nunca uma tela de erro estática
 *      com "Tentar novamente" — o pior caso possível é o onboarding guiar a
 *      criação de um workspace que, em teoria, já existia (ver ADR-0006).
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [pendingSync, setPendingSync] = useState(false);
  const [loadingPerfil, setLoadingPerfil] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Requisito de segurança: nenhuma consulta ao Firestore antes do
    // `onAuthStateChanged` resolver E de termos um usuário autenticado.
    if (authLoading) return;
    if (!user) {
      setLoadingPerfil(false);
      return;
    }

    let cancelled = false;
    setLoadingPerfil(true);

    /** Último recurso antes do redirecionamento: perfil otimista > perfil confirmado > onboarding. */
    function resolverSemLeituraConfirmada(uid: string) {
      if (cancelled) return;

      const pending = readPendingProfile(uid);
      if (pending) {
        setAppUser(pending.appUser);
        setPendingSync(true);
        setLoadingPerfil(false);
        return;
      }

      const confirmed = readConfirmedProfile(uid);
      if (confirmed) {
        setAppUser(confirmed);
        setPendingSync(false);
        setLoadingPerfil(false);
        return;
      }

      router.replace("/onboarding");
    }

    withTimeout(getAppUser(user.uid), READ_TIMEOUT_MS)
      .then(async (found) => {
        if (cancelled) return;

        if (!found) {
          resolverSemLeituraConfirmada(user.uid);
          return;
        }

        setAppUser(found);
        setLoadingPerfil(false);
        saveConfirmedProfile(user.uid, found);

        const pending = readPendingProfile(user.uid);
        if (!pending) {
          setPendingSync(false);
          return;
        }
        // Perfil já é real; falta só confirmar se o workspace em si
        // chegou a ser gravado (ver item 6 do docblock acima).
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
          reportarErro(result.error, "workspace:reconciliacao-pendente");
        }
      })
      .catch((erro) => {
        if (cancelled) return;
        reportarErro(erro, `workspace:getAppUser:${codigoErroFirestore(erro)}`);
        resolverSemLeituraConfirmada(user.uid);
      });

    return () => {
      cancelled = true;
    };
  }, [user, authLoading, router, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const loading = authLoading || !user || loadingPerfil;

  return (
    <WorkspaceContext.Provider
      value={{
        appUser,
        workspaceId: appUser?.workspaceId ?? null,
        loading,
        pendingSync,
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
