"use client";

import { useEffect, useMemo, useState } from "react";
import { subscribeFlows, subscribeFlowRuns, deleteFlow } from "@/lib/firestore";
import { formatRelativeTime } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { useWorkspaceDoc } from "@/lib/queries/workspace";
import { useMedirCarregamentoRota } from "@/lib/telemetry/useRoutePerformance";
import { ListRow } from "@/components/ui/ListRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { FlowRail } from "@/components/ui/FlowRail";
import { FlowSettingsForm } from "@/components/flows/FlowSettingsForm";
import { PayloadSimulator } from "@/components/flows/PayloadSimulator";
import { PrimeirosPassosCard } from "@/components/flows/PrimeirosPassosCard";
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
  const [fluxoParaExcluir, setFluxoParaExcluir] = useState<Flow | null>(null);
  const [excluindo, setExcluindo] = useState(false);
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

  // Numa conta nova (zero fluxos), esperar o operador clicar em "Novo fluxo"
  // antes de mostrar o formulário criava um primeiro acesso confuso: a tela
  // inteira só exibia dois avisos de "nada selecionado" lado a lado, com
  // nenhum formulário visível — exatamente o tipo de desconexão que o Guia
  // de Primeiros Passos (Passo 2) precisa não contradizer. `carregouFlows`
  // garante que só decidimos "está vazio mesmo" depois do primeiro snapshot
  // real chegar, nunca antes dele (senão o formulário "novo" apareceria e
  // desapareceria num flash assim que os fluxos reais carregassem).
  useEffect(() => {
    if (selectedId !== null) return;
    if (flows.length > 0) {
      setSelectedId(flows[0].id);
    } else if (carregouFlows) {
      setSelectedId("new");
    }
  }, [flows, selectedId, carregouFlows]);

  const filteredFlows = useMemo(
    () => flows.filter((f) => f.nome.toLowerCase().includes(search.toLowerCase())),
    [flows, search]
  );

  const runningCount = flows.filter((f) => f.status === "em-execucao").length;
  const selectedFlow = selectedId && selectedId !== "new" ? flows.find((f) => f.id === selectedId) ?? null : null;
  const activeRun = selectedFlow ? runs.find((r) => r.flowId === selectedFlow.id) ?? null : null;

  async function confirmarExclusao() {
    if (!fluxoParaExcluir) return;
    setExcluindo(true);
    try {
      await deleteFlow(fluxoParaExcluir.id);
      if (selectedId === fluxoParaExcluir.id) setSelectedId(null);
      setFluxoParaExcluir(null);
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PrimeirosPassosCard temNicho={Boolean(workspace?.setor)} temFluxo={flows.length > 0} ehAdmin={appUser?.papel === "admin"} />

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
                onDelete={() => setFluxoParaExcluir(flow)}
                deleteLabel={`Excluir fluxo ${flow.nome}`}
              />
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-col gap-4">
        {appUser?.papel === "admin" && workspace && (
          flows.length > 0 ? (
            <ClientPortalLinkCard workspace={workspace} />
          ) : (
            <EmptyState
              title="Link do Cliente indisponível"
              description="Nenhum fluxo de atendimento ativo. Crie seu primeiro fluxo ao lado para gerar o Link Executivo e o QR Code criptografado do seu cliente."
            />
          )
        )}

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

        <section id="sandbox-fluxos" className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
            Sandbox — testar payload é sempre isolado; enviar para a Inbox é opcional e explícito
          </p>
          <PayloadSimulator flowNome={selectedFlow?.nome} />
        </section>
      </div>
      </div>

      <Modal
        open={fluxoParaExcluir !== null}
        onClose={() => setFluxoParaExcluir(null)}
        titleId="excluir-fluxo-title"
        title={`Excluir "${fluxoParaExcluir?.nome ?? ""}"?`}
        body="O fluxo é apagado permanentemente, junto com seu histórico de execuções. Útil para remover um fluxo de teste/demonstração antes de abrir o workspace para um cliente real. Isso não afeta conversas da Neural Inbox nem outros fluxos."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setFluxoParaExcluir(null)}>
              Cancelar
            </Button>
            <Button variant="danger-solid" size="sm" loading={excluindo} onClick={confirmarExclusao}>
              Sim, excluir
            </Button>
          </>
        }
      />
    </div>
  );
}
