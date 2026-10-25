"use client";

import { useEffect, useMemo, useState } from "react";
import { subscribeFlowRuns } from "@/lib/firestore";
import { formatRelativeTime } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { ListRow } from "@/components/ui/ListRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { FlowRail } from "@/components/ui/FlowRail";
import { BusinessROIWidget } from "@/components/BusinessROIWidget";
import { cn } from "@/lib/utils";
import type { FlowRun, RunStatus } from "@/types";

const FILTERS: Array<{ value: RunStatus | "todos"; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "em-execucao", label: "Em execução" },
  { value: "concluido", label: "Concluído" },
  { value: "falhou", label: "Falhou" },
];

export default function RunsPage() {
  const { workspaceId } = useWorkspace();
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [filter, setFilter] = useState<RunStatus | "todos">("todos");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeFlowRuns(workspaceId, setRuns);
  }, [workspaceId]);

  useEffect(() => {
    if (!selectedId && runs.length > 0) setSelectedId(runs[0].id);
  }, [runs, selectedId]);

  const filteredRuns = useMemo(
    () => (filter === "todos" ? runs : runs.filter((r) => r.status === filter)),
    [runs, filter]
  );

  const selectedRun = runs.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {/* Painel financeiro no topo das Execuções: é a tela que a operação
          mantém aberta, e o número de ROI só influencia decisão se estiver
          onde a decisão é tomada. */}
      <BusinessROIWidget />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
        <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  filter === f.value ? "bg-ink-950 text-white" : "bg-mist-50 text-ink-500 hover:bg-ink-100"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filteredRuns.length === 0 ? (
            <EmptyState
              title="Nenhuma execução por aqui"
              description="Execuções de todos os fluxos do workspace aparecem nesta lista assim que forem disparadas."
            />
          ) : (
            <div className="flex flex-col gap-1">
              {filteredRuns.map((run) => (
                <ListRow
                  key={run.id}
                  title={run.flowNome}
                  subtitle={`execução #${run.id.slice(0, 6)}`}
                  status={run.status}
                  time={formatRelativeTime(new Date(run.iniciadoEm))}
                  active={run.id === selectedId}
                  onClick={() => setSelectedId(run.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
          {selectedRun ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-ink-950">{selectedRun.flowNome}</span>
                <span className="mono text-xs text-ink-400">
                  execução #{selectedRun.id.slice(0, 6)}
                </span>
              </div>
              <FlowRail steps={selectedRun.steps} />
            </>
          ) : (
            <EmptyState
              title="Selecione uma execução"
              description="O detalhe passo-a-passo aparece aqui."
            />
          )}
        </section>
      </div>
    </div>
  );
}
