"use client";

// Visualização do grafo de um fluxo — nós e transições, incluindo as
// ARESTAS DE FALLBACK.
//
// Texto estruturado, não canvas: o design system do AgentFlow não tem
// componente de diagrama tokenizado, e introduzir um só para esta tela
// violaria .claude/rules/design-system-compliance.md. Lista densa + pills
// de estado é o vocabulário que já existe — e, para LER um caminho de
// erro ("se a consulta falhar, vai para despacho manual"), uma lista
// rotulada é mais precisa que setas num desenho.
//
// Compartilhado entre a galeria de templates (preview antes de implantar) e
// a tela de Fluxos (grafo do fluxo já implantado) — uma fonte, duas telas,
// nunca duas renderizações que possam divergir.

import type { FlowEdgeKind, FlowGraph, FlowNodeKind } from "@/types";
import { cn } from "@/lib/utils";

const ROTULO_TIPO_NO: Record<FlowNodeKind, string> = {
  gatilho: "gatilho",
  qualificacao: "qualificação",
  guardrail: "guardrail",
  consulta: "consulta",
  handoff: "handoff",
  notificacao: "notificação",
  fallback: "fallback",
};

const CORES_TIPO_NO: Record<FlowNodeKind, string> = {
  gatilho: "bg-state-idle-bg text-state-idle",
  qualificacao: "bg-signal-100 text-signal-700",
  guardrail: "bg-state-error-bg text-state-error",
  consulta: "bg-signal-100 text-signal-700",
  handoff: "bg-state-run-bg text-state-run",
  notificacao: "bg-state-done-bg text-state-done",
  fallback: "bg-state-run-bg text-state-run",
};

const ROTULO_ARESTA: Record<FlowEdgeKind, string> = {
  sucesso: "→",
  falha: "⟲ falha",
  escalonamento: "↑ escalona",
};

export function FlowGraphView({ grafo, compacto = false }: { grafo: FlowGraph; compacto?: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-ink-100 bg-white p-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Nós</p>
      <ul className="flex flex-col gap-1.5">
        {grafo.nos.map((no) => (
          <li key={no.id} className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <span className={cn("flex-none rounded-full px-2 py-0.5 text-[10px] font-medium", CORES_TIPO_NO[no.tipo])}>
                {ROTULO_TIPO_NO[no.tipo]}
              </span>
              <span className="text-xs font-medium text-ink-950">{no.titulo}</span>
            </span>
            {!compacto && <span className="text-[11px] text-ink-500">{no.descricao}</span>}
            {no.politicaGuardrailId && (
              <span className="mono text-[10px] text-ink-400">política: {no.politicaGuardrailId}</span>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Transições</p>
      <ul className="flex flex-col gap-0.5">
        {grafo.arestas.map((aresta, i) => (
          <li
            key={`${aresta.de}-${aresta.para}-${i}`}
            className={cn("mono text-[11px]", aresta.tipo === "sucesso" ? "text-ink-500" : "text-state-run")}
          >
            {aresta.de} {ROTULO_ARESTA[aresta.tipo]} {aresta.para}
            {aresta.rotulo ? ` · ${aresta.rotulo}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default FlowGraphView;
