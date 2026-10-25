"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";

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
  const { user, loading: authLoading } = useAuth();
  const { appUser, loading: workspaceLoading, pendingSync, error: workspaceError, retry } = useWorkspace();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pausedGlobally, setPausedGlobally] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  if (authLoading || !user || workspaceLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-ink-400">
        Carregando…
      </div>
    );
  }

  // Timeout/erro na leitura do perfil (users/{uid}) sem nenhum fallback
  // otimista disponível — ver src/lib/workspace.tsx. Estado recuperável, não
  // um loop: o usuário sempre tem uma ação (tentar de novo) em vez de ficar
  // olhando "Carregando…" para sempre.
  if (workspaceError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <EmptyState
          title="Não foi possível carregar seu workspace"
          description="A conexão com o servidor demorou demais ou falhou. Verifique sua internet e tente novamente."
          action={
            <Button size="sm" onClick={retry}>
              Tentar novamente
            </Button>
          }
        />
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
        {pendingSync && (
          <Banner
            action={
              <Button variant="secondary" size="sm" onClick={retry}>
                Sincronizar agora
              </Button>
            }
          >
            Sincronizando seu workspace com o servidor — algumas informações ainda não foram confirmadas.
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
