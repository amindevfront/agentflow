"use client";

import { useEffect, useMemo, useState } from "react";
import { subscribeFlows, subscribeFlowRuns } from "@/lib/firestore";
import { formatRelativeTime } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { useWorkspaceDoc } from "@/lib/queries/workspace";
import { useMedirCarregamentoRota } from "@/lib/telemetry/useRoutePerformance";
import { ListRow } from "@/components/ui/ListRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { FlowRail } from "@/components/ui/FlowRail";
import { FlowSettingsForm } from "@/components/flows/FlowSettingsForm";
import { PayloadSimulator } from "@/components/flows/PayloadSimulator";
import { RealExecutionPanel } from "@/components/flows/RealExecutionPanel";
import { NicheAttachmentsPanel } from "@/components/niche/NicheAttachmentsPanel";
import { ClientPortalLinkCard } from "@/components/flows/ClientPortalLinkCard";
import type { Flow, FlowRun } from "@/types";

export default function FlowsPage() {
  const { workspaceId, appUser } = useWorkspace();
  const [flows, setFlows] = useState<Flow[]>([]);
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  // Cacheado (ver `src/lib/queries/workspace.ts`) — sem isso, cada visita a
  // `/flows` pagava uma leitura nova de `workspaces/{id}` só para sugerir
  // playbooks, um valor que praticamente nunca muda após o onboarding.
  const { data: workspace } = useWorkspaceDoc(workspaceId);
  const playbooksSugeridos = workspace?.playbooksSugeridos ?? [];

  const [carregouFlows, setCarregouFlows] = useState(false);
  const [carregouRuns, setCarregouRuns] = useState(false);
  useMedirCarregamentoRota("/flows", carregouFlows && carregouRuns);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeFlows(workspaceId, (lista) => {
      setFlows(lista);
      setCarregouFlows(true);
    });
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeFlowRuns(workspaceId, (lista) => {
      setRuns(lista);
      setCarregouRuns(true);
    });
  }, [workspaceId]);

  useEffect(() => {
    if (selectedId === null && flows.length > 0) {
      setSelectedId(flows[0].id);
    }
  }, [flows, selectedId]);

  const filteredFlows = useMemo(
    () => flows.filter((f) => f.nome.toLowerCase().includes(search.toLowerCase())),
    [flows, search]
  );

  const runningCount = flows.filter((f) => f.status === "em-execucao").length;
  const selectedFlow = selectedId && selectedId !== "new" ? flows.find((f) => f.id === selectedId) ?? null : null;
  const activeRun = selectedFlow ? runs.find((r) => r.flowId === selectedFlow.id) ?? null : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Buscar fluxo"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 flex-1 rounded-[var(--radius-sm)] border border-ink-100 bg-white px-3 text-sm outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
          />
          <Button size="sm" onClick={() => setSelectedId("new")}>
            Novo fluxo
          </Button>
        </div>

        <p className="mono text-xs text-ink-400">
          {flows.length} fluxo{flows.length === 1 ? "" : "s"} · {runningCount} em execução
        </p>

        {filteredFlows.length === 0 ? (
          <EmptyState
            title="Nenhum fluxo ainda"
            description={
              playbooksSugeridos.length > 0
                ? `Sugestões para o seu setor: ${playbooksSugeridos.join(" · ")}.`
                : "Crie o primeiro fluxo para começar a orquestrar agentes."
            }
            action={
              <Button size="sm" onClick={() => setSelectedId("new")}>
                Novo fluxo
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-1">
            {filteredFlows.map((flow) => (
              <ListRow
                key={flow.id}
                title={flow.nome}
                subtitle={flow.origem || flow.gatilho}
                status={flow.status}
                time={formatRelativeTime(new Date(flow.atualizadoEm))}
                active={flow.id === selectedId}
                totalSteps={flow.steps.length}
                doneSteps={flow.status === "concluido" ? flow.steps.length : 0}
                onClick={() => setSelectedId(flow.id)}
              />
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-col gap-4">
        {appUser?.papel === "admin" && workspace && <ClientPortalLinkCard workspace={workspace} />}

        <section className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
          {selectedId === null ? (
            <EmptyState title="Selecione um fluxo" description="Ou crie um novo fluxo para configurar." />
          ) : (
            <FlowSettingsForm flow={selectedFlow} onSaved={(id) => setSelectedId(id)} />
          )}
        </section>

        {workspace?.setor === "construtora-imobiliaria" && (
          <section className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
            <NicheAttachmentsPanel />
          </section>
        )}

        {selectedFlow && (
          <section className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Execução em andamento</p>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-ink-950">{selectedFlow.nome}</span>
              {activeRun && <span className="mono text-xs text-ink-400">execução #{activeRun.id.slice(0, 6)}</span>}
            </div>
            {activeRun ? (
              <FlowRail steps={activeRun.steps} />
            ) : (
              <EmptyState title="Nenhuma execução registrada" description="As execuções aparecem aqui assim que o motor de orquestração disparar este fluxo." />
            )}
          </section>
        )}

        {selectedFlow && (
          // Borda em âmbar (mesmo tom do Banner persistente) distingue esta
          // zona das demais: é a única seção desta página que gasta tokens
          // reais e grava telemetria financeira de verdade. A diferença não
          // pode depender só do texto — tem de ser visível de imediato.
          <section className="rounded-[var(--radius-md)] border border-state-run-ink/40 bg-white p-4">
            <RealExecutionPanel flowId={selectedFlow.id} flowNome={selectedFlow.nome} />
          </section>
        )}

        <section className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Sandbox — sem efeito real</p>
          <PayloadSimulator />
        </section>
      </div>
    </div>
  );
}
