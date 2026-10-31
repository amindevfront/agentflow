"use client";

// Health Score Preventivo — radar de risco de churn do workspace.
//
// Painel para o OPERADOR do AgentFlow (quem vendeu e implantou), não para o
// cliente final — por isso vive em Governança, não no Portal do Cliente.
// Mesma fonte de dados em tempo real dos demais painéis de Governança
// (`SimuladorContingenciaPanel`/`OpexTaxShieldPanel`), já assinada aqui de
// novo: nenhuma instrumentação nova, só nova agregação sobre dados que já
// existiam (ver `@/lib/healthScore` e ADR-0007).

import { useEffect, useMemo, useState } from "react";
import type { Conversation, FlowRun, HandoffTicket, PedidoEcommerce } from "@/types";
import { useWorkspace } from "@/lib/workspace";
import { useWorkspaceDoc } from "@/lib/queries/workspace";
import { subscribeFlowRuns } from "@/lib/firestore";
import { subscribeFilaTransbordo } from "@/lib/humanInTheLoop";
import { subscribeConversations } from "@/lib/inbox/firestore";
import { subscribePedidos } from "@/lib/ecommercePedidos";
import { calcularHealthScore, type NivelHealthScore } from "@/lib/healthScore";
import { formatarPercentual } from "@/lib/roi";
import { MetricCard } from "@/components/ui/MetricCard";
import { cn } from "@/lib/utils";

const TOM_NIVEL: Record<NivelHealthScore, "positivo" | "atencao" | "erro"> = {
  saudavel: "positivo",
  atencao: "atencao",
  risco: "erro",
};

const ROTULO_NIVEL: Record<NivelHealthScore, string> = {
  saudavel: "saudável",
  atencao: "atenção",
  risco: "risco de churn",
};

const CORES_NIVEL: Record<NivelHealthScore, string> = {
  saudavel: "bg-state-done-bg text-state-done",
  atencao: "bg-state-run-bg text-state-run",
  risco: "bg-state-error-bg text-state-error",
};

export function HealthScorePanel() {
  const { workspaceId } = useWorkspace();
  const { data: workspace } = useWorkspaceDoc(workspaceId);
  const ehEcommerce = workspace?.setor === "ecommerce";
  const [execucoes, setExecucoes] = useState<FlowRun[]>([]);
  const [tickets, setTickets] = useState<HandoffTicket[]>([]);
  const [conversas, setConversas] = useState<Conversation[]>([]);
  const [pedidos, setPedidos] = useState<PedidoEcommerce[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [referencia] = useState(() => new Date());

  useEffect(() => {
    if (!workspaceId) return;
    const cancelamentos = [
      subscribeFlowRuns(workspaceId, setExecucoes),
      subscribeFilaTransbordo(setTickets, {
        workspaceId,
        limite: 300,
        onError: () => setErro("Fila de transbordo indisponível no momento. O score segue com os demais sinais."),
      }),
      subscribeConversations(setConversas, {
        workspaceId,
        limite: 500,
        onError: () => setErro("Neural Inbox indisponível no momento. O score segue com os demais sinais."),
      }),
    ];
    return () => cancelamentos.forEach((cancelar) => cancelar());
  }, [workspaceId]);

  // Sinal de chargeback é específico de E-commerce — só assina a coleção de
  // pedidos quando o setor do workspace é esse, para não gastar uma consulta
  // à toa em todo workspace de qualquer outro nicho (ver `@/lib/healthScore`).
  useEffect(() => {
    if (!workspaceId || !ehEcommerce) {
      setPedidos([]);
      return;
    }
    return subscribePedidos(setPedidos, workspaceId);
  }, [workspaceId, ehEcommerce]);

  const resultado = useMemo(
    () => calcularHealthScore({ execucoes, tickets, conversas, pedidos: ehEcommerce ? pedidos : undefined, referencia }),
    [execucoes, tickets, conversas, pedidos, ehEcommerce, referencia]
  );

  return (
    <section
      aria-label="Health Score Preventivo"
      className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-950">Health Score Preventivo</h2>
          <p className="mt-0.5 text-xs text-ink-400">
            Risco de churn deste workspace, calculado sobre execuções, tickets de transbordo e atividade — para você
            agir antes do cliente cancelar, não depois.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={cn("mono rounded-full px-3 py-1 text-sm font-semibold", CORES_NIVEL[resultado.nivel])}>
            {resultado.score}/100 · {ROTULO_NIVEL[resultado.nivel]}
          </span>
        </div>
      </header>

      {erro && <p className="text-xs text-state-error">{erro}</p>}

      <div className={cn("grid gap-3", resultado.taxaChargebackEDevolucao !== null ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3")}>
        <MetricCard
          rotulo="Taxa de sucesso de execuções"
          valor={resultado.taxaSucessoExecucoes !== null ? formatarPercentual(resultado.taxaSucessoExecucoes) : "—"}
          detalhe={
            resultado.taxaSucessoExecucoes !== null
              ? `${resultado.totalExecucoesConsideradas} execução(ões) terminadas nos últimos 30 dias`
              : "sem execução terminada nos últimos 30 dias"
          }
          tom={
            resultado.taxaSucessoExecucoes === null
              ? "neutro"
              : resultado.taxaSucessoExecucoes < 0.7
                ? "erro"
                : resultado.taxaSucessoExecucoes < 0.9
                  ? "atencao"
                  : "positivo"
          }
        />
        <MetricCard
          rotulo="Tickets de transbordo vencidos"
          valor={String(resultado.ticketsAbertosVencidos)}
          detalhe="abertos ou em análise há mais de 48h, sem decisão"
          tom={resultado.ticketsAbertosVencidos >= 3 ? "erro" : resultado.ticketsAbertosVencidos >= 1 ? "atencao" : "positivo"}
        />
        <MetricCard
          rotulo="Dias sem atividade"
          valor={resultado.diasSemAtividade !== null ? String(resultado.diasSemAtividade) : "nunca usou"}
          detalhe="última execução ou conversa registrada"
          tom={
            resultado.diasSemAtividade === null
              ? "erro"
              : resultado.diasSemAtividade > 14
                ? "erro"
                : resultado.diasSemAtividade > 7
                  ? "atencao"
                  : "positivo"
          }
        />
        {resultado.taxaChargebackEDevolucao !== null && (
          <MetricCard
            rotulo="Chargeback + devolução (mês)"
            valor={formatarPercentual(resultado.taxaChargebackEDevolucao)}
            detalhe="sinal específico de E-commerce — ver Radar de Chargeback no Neural Inbox"
            tom={
              resultado.taxaChargebackEDevolucao >= 0.075
                ? "erro"
                : resultado.taxaChargebackEDevolucao >= 0.04
                  ? "atencao"
                  : "positivo"
            }
          />
        )}
      </div>

      {resultado.sinais.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-ink-100 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">Por que este score</h3>
          <ul className="flex flex-col gap-1">
            {resultado.sinais.map((sinal, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-xs text-ink-700">
                <span>{sinal.descricao}</span>
                <span className="mono flex-none text-state-error">-{sinal.penalidade}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default HealthScorePanel;
