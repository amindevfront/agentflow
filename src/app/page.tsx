"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getAppUser } from "@/lib/firestore";
import { withTimeout } from "@/lib/promiseUtils";
import { readPendingProfile } from "@/lib/pendingWorkspace";

// Mesmo limite usado em `workspace.tsx`/`onboarding/page.tsx` — mantém a
// mesma garantia em toda a base: nenhuma leitura ao Firestore trava a tela
// indefinidamente (ver ADR-0003).
const READ_TIMEOUT_MS = 3000;

/**
 * Roteamento inicial — decide entre `/login`, `/onboarding` e `/flows` já na
 * raiz, sem depender do usuário cair em `/flows` para só então o
 * `WorkspaceProvider` (ver `src/lib/workspace.tsx`) descobrir que não há
 * workspace e estourar de volta para `/onboarding`.
 *
 * Mesma árvore de decisão de `workspace.tsx`, resumida:
 *   - sem sessão → `/login` (instantâneo, sem round-trip).
 *   - sessão + perfil confirmado (`users/{uid}`) → `/flows`.
 *   - sessão sem perfil confirmado, mas com perfil otimista local (gravação
 *     de onboarding ainda sincronizando) → `/flows`, onde o
 *     `WorkspaceProvider` mostra o aviso de sincronização.
 *   - sessão sem perfil e sem otimista → onboarding de verdade → `/onboarding`.
 *   - timeout/erro de rede → ambíguo, nunca redirecionamos "cego" para
 *     `/onboarding` (risco de criar um segundo workspace); seguimos para
 *     `/flows`, cujo `WorkspaceProvider` já trata esse caso com retry visível
 *     em vez de um spinner infinito.
 */
export default function Home() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      router.replace("/login");
      return;
    }

    let cancelled = false;

    withTimeout(getAppUser(user.uid), READ_TIMEOUT_MS)
      .then((found) => {
        if (cancelled) return;
        if (found) {
          router.replace("/flows");
          return;
        }
        router.replace(readPendingProfile(user.uid) ? "/flows" : "/onboarding");
      })
      .catch(() => {
        if (!cancelled) router.replace("/flows");
      });

    return () => {
      cancelled = true;
    };
  }, [user, authLoading, router]);

  return (
    <main className="flex min-h-screen items-center justify-center text-sm text-ink-400">
      Carregando…
    </main>
  );
}
