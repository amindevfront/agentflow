"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { DEFAULT_WORKSPACE_ID, ensureDefaultWorkspace, getAppUser, upsertAppUser } from "@/lib/firestore";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { AppUser } from "@/types";

const TITLE_BY_PATH: Array<[string, string]> = [
  ["/inbox", "Neural Inbox"],
  ["/flows", "Fluxos"],
  ["/runs", "Execuções"],
  ["/connectors", "Conectores"],
  ["/team", "Equipe"],
  ["/governance", "Governança"],
  ["/settings", "Configurações"],
];

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useAuth();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [pausedGlobally, setPausedGlobally] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    ensureDefaultWorkspace().catch(() => undefined);
    getAppUser(user.uid)
      .then(async (found) => {
        if (found) return setAppUser(found);
        // Bootstrap: usuário autenticado (ex.: criado manualmente no console do
        // Firebase para o primeiro acesso) mas ainda sem doc em `users/{uid}`.
        // Sem isso, as regras de segurança bloqueiam qualquer leitura workspace-scoped.
        const bootstrapped: AppUser = {
          uid: user.uid,
          nome: user.displayName ?? user.email?.split("@")[0] ?? "Usuário",
          email: user.email ?? "",
          papel: "admin",
          workspaceId: DEFAULT_WORKSPACE_ID,
        };
        await upsertAppUser(bootstrapped);
        setAppUser(bootstrapped);
      })
      .catch(() => setAppUser(null));
  }, [user]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-ink-400">
        Carregando…
      </div>
    );
  }

  const title = TITLE_BY_PATH.find(([path]) => pathname?.startsWith(path))?.[1] ?? "AgentFlow";
  const displayName = appUser?.nome ?? user.email ?? "Usuário";

  return (
    <div className="flex min-h-screen">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        userName={displayName}
        userRole={appUser?.papel ?? "operacoes"}
      />
      <div className="flex min-h-screen flex-1 flex-col">
        <Topbar
          title={title}
          onMenuClick={() => setSidebarOpen(true)}
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => (pausedGlobally ? setPausedGlobally(false) : setConfirmOpen(true))}
            >
              {pausedGlobally ? "Retomar execuções" : "Parar tudo"}
            </Button>
          }
        />
        {pausedGlobally && (
          <Banner
            action={
              <Button variant="secondary" size="sm" onClick={() => setPausedGlobally(false)}>
                Retomar execuções
              </Button>
            }
          >
            Execuções pausadas manualmente — os fluxos em andamento foram congelados.
          </Banner>
        )}
        <main className="flex-1 bg-mist-50 p-4 md:p-6">{children}</main>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        titleId="cb-modal-title"
        title="Parar todas as execuções?"
        body="Isso congela imediatamente os fluxos em execução. Use apenas em caso de comportamento inesperado — a ação pode ser revertida depois."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger-solid"
              size="sm"
              onClick={() => {
                setPausedGlobally(true);
                setConfirmOpen(false);
              }}
            >
              Sim, parar tudo
            </Button>
          </>
        }
      />
    </div>
  );
}
