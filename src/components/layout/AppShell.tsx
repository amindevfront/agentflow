"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import { assinarConectividade, assinarOperacoesPendentes, estaOnline, type OperacaoPendente } from "@/lib/offlineQueue";
import { exigeAdmin } from "./navAcesso";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { QuizModalProvider } from "@/components/onboarding/DynamicNicheQuizModal";

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
  const { appUser, loading: workspaceLoading, pendingSync, retry } = useWorkspace();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pausedGlobally, setPausedGlobally] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [operacoesPendentes, setOperacoesPendentes] = useState<OperacaoPendente[]>([]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  // Dual-Layer Workspace View: rotas de administração técnica avançada
  // (Conectores, Equipe, Governança) são inacessíveis por URL direta para
  // quem não é `admin` — esconder o item do menu não bastaria por si só.
  useEffect(() => {
    if (authLoading || workspaceLoading || !appUser) return;
    if (appUser.papel !== "admin" && exigeAdmin(pathname)) {
      router.replace("/inbox");
    }
  }, [authLoading, workspaceLoading, appUser, pathname, router]);

  // Resiliência offline-first (ver ADR-0005): o Firestore já reenvia
  // sozinho as escritas pendentes quando a conexão volta (persistência local
  // habilitada em `src/lib/firebase.ts`) — o que falta é tornar isso visível
  // ao operador em campo, em vez de ele simplesmente não saber por que uma
  // tela parece "travada" sem rede.
  useEffect(() => {
    setOnline(estaOnline());
    return assinarConectividade(setOnline);
  }, []);

  useEffect(() => assinarOperacoesPendentes(setOperacoesPendentes), []);

  if (authLoading || !user || workspaceLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-ink-400">
        Carregando…
      </div>
    );
  }

  const title = TITLE_BY_PATH.find(([path]) => pathname?.startsWith(path))?.[1] ?? "AgentFlow";
  const displayName = appUser?.nome ?? user.email ?? "Usuário";

  return (
    <QuizModalProvider>
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
          {!online && (
            <Banner>
              Você está offline — continue trabalhando normalmente. Suas alterações ficam salvas neste dispositivo e
              serão sincronizadas automaticamente quando a conexão voltar.
            </Banner>
          )}
          {online && operacoesPendentes.length > 0 && (
            <Banner>
              {operacoesPendentes.length === 1
                ? "1 alteração"
                : `${operacoesPendentes.length} alterações`}{" "}
              aguardando confirmação do servidor.
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
    </QuizModalProvider>
  );
}
