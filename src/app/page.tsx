"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

/**
 * Roteamento inicial — regra única e blindada, sem round-trip ao Firestore:
 * decide apenas pela sessão do Firebase Auth.
 *
 *   - sem sessão → `/login` instantâneo.
 *   - sessão ativa → `/flows`.
 *
 * A verificação de workspace (se o usuário autenticado já tem perfil em
 * `users/{uid}`) é responsabilidade do `WorkspaceProvider` (ver
 * `src/lib/workspace.tsx`), que já cobre esse caso ao entrar em `/flows` —
 * não duplicar essa leitura aqui.
 */
export default function Home() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/flows" : "/login");
  }, [user, loading, router]);

  return (
    <main className="flex min-h-screen items-center justify-center text-sm text-ink-400">
      Carregando…
    </main>
  );
}
