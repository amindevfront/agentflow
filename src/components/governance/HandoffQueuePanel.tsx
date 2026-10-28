"use client";

// Fila de transbordo humano.
//
// O operador vê a decisão que o agente tentou tomar, as violações que a
// barraram e o payload — sempre MASCARADO. A revisão julga a decisão, não o dado
// pessoal; é o princípio de minimização da LGPD aplicado à interface.

import { useEffect, useMemo, useState } from "react";
import type { HandoffDecision, HandoffReason, HandoffStatus, HandoffTicket } from "@/types";
import {
  ROTULO_DECISAO,
  ROTULO_MOTIVO,
  ROTULO_PRIORIDADE,
  ROTULO_STATUS,
  assumirTicket,
  estatisticasFila,
  expirarTicketsVencidos,
  formatarSla,
  ordenarFila,
  resolverTicket,
  slaViolado,
  subscribeFilaTransbordo,
} from "@/lib/humanInTheLoop";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { MetricCard } from "@/components/ui/MetricCard";
import { Modal } from "@/components/ui/Modal";
import { SegmentedFilter } from "@/components/ui/SegmentedFilter";
import { cn, formatRelativeTime } from "@/lib/utils";

type FiltroFila = "ativos" | "aberto" | "em-analise" | "resolvido" | "todos";

const DECISOES: Array<{ valor: HandoffDecision; descricao: string; variante: "primary" | "secondary" | "danger-solid" }> = [
  { valor: "aprovado", descricao: "Liberar a saída do agente como está", variante: "primary" },
  { valor: "editado", descricao: "Substituir a saída pelo texto corrigido", variante: "secondary" },
  { valor: "rejeitado", descricao: "Descartar a saída e encerrar a execução", variante: "danger-solid" },
  { valor: "escalado", descricao: "Devolver à fila para outro responsável", variante: "secondary" },
];

const corPrioridade: Record<HandoffTicket["prioridade"], string> = {
  p1: "bg-state-error-bg text-state-error",
  p2: "bg-state-run-bg text-state-run",
  p3: "bg-signal-100 text-signal-700",
  p4: "bg-state-idle-bg text-state-idle",
};

function corresponde(ticket: HandoffTicket, filtro: FiltroFila): boolean {
  if (filtro === "todos") return true;
  if (filtro === "ativos") return ticket.status === "aberto" || ticket.status === "em-analise";
  return ticket.status === (filtro as HandoffStatus);
}

interface HandoffQueuePanelProps {
  /** Restringe a fila a motivos específicos — usado pelo painel de Compliance Preventivo. */
  motivoFiltro?: HandoffReason[];
}

export function HandoffQueuePanel({ motivoFiltro }: HandoffQueuePanelProps = {}) {
  const [ticketsBrutos, setTicketsBrutos] = useState<HandoffTicket[]>([]);
  const [filtro, setFiltro] = useState<FiltroFila>("ativos");
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [decisaoAberta, setDecisaoAberta] = useState<HandoffDecision | null>(null);
  const [confirmacaoAberta, setConfirmacaoAberta] = useState(false);
  const [justificativa, setJustificativa] = useState("");
  const [saidaCorrigida, setSaidaCorrigida] = useState("");
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [referencia, setReferencia] = useState(() => new Date());

  useEffect(() => {
    const intervalo = setInterval(() => setReferencia(new Date()), 30_000);
    return () => clearInterval(intervalo);
  }, []);

  useEffect(() => {
    return subscribeFilaTransbordo(setTicketsBrutos, {
      limite: 200,
      onError: () => setErro("Não foi possível carregar a fila de transbordo agora. Tente novamente em instantes."),
    });
  }, []);

  // Filtro por motivo é aplicado ANTES das estatísticas/ordenação: o painel de
  // Compliance Preventivo mostra métricas escopadas só aos seus próprios
  // tickets, não a fila inteira de transbordo.
  const tickets = useMemo(
    () => (motivoFiltro ? ticketsBrutos.filter((t) => motivoFiltro.includes(t.motivo)) : ticketsBrutos),
    [ticketsBrutos, motivoFiltro]
  );

  useEffect(() => {
    // Varredura de expiração ao montar: sem worker server-side nesta versão, a
    // transição aberto → expirado é observada quando alguém abre o painel.
    expirarTicketsVencidos().catch((e) =>
      console.error("[transbordo] varredura de expiração falhou:", e)
    );
  }, []);

  const estatisticas = useMemo(() => estatisticasFila(tickets, referencia), [tickets, referencia]);
  const ordenados = useMemo(() => ordenarFila(tickets, referencia), [tickets, referencia]);
  const visiveis = useMemo(() => ordenados.filter((t) => corresponde(t, filtro)), [ordenados, filtro]);

  const selecionado = tickets.find((t) => t.id === selecionadoId) ?? null;

  const opcoesFiltro: Array<{ valor: FiltroFila; label: string; contagem?: number }> = [
    { valor: "ativos", label: "Ativos", contagem: estatisticas.abertos + estatisticas.emAnalise },
    { valor: "aberto", label: "Abertos", contagem: estatisticas.abertos },
    { valor: "em-analise", label: "Em análise", contagem: estatisticas.emAnalise },
    { valor: "resolvido", label: "Resolvidos", contagem: estatisticas.resolvidos },
    { valor: "todos", label: "Todos", contagem: estatisticas.total },
  ];

  async function handleAssumir(ticket: HandoffTicket) {
    setErro(null);
    setProcessando(true);
    try {
      await assumirTicket(ticket.id, ticket.workspaceId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível assumir o transbordo.");
    } finally {
      setProcessando(false);
    }
  }

  function abrirDecisao(decisao: HandoffDecision) {
    setErro(null);
    setJustificativa("");
    setSaidaCorrigida(selecionado?.saidaMascarada ?? "");
    setDecisaoAberta(decisao);
  }

  async function confirmarDecisao() {
    if (!selecionado || !decisaoAberta) return;
    setProcessando(true);
    setErro(null);
    try {
      await resolverTicket({
        ticketId: selecionado.id,
        decisao: decisaoAberta,
        justificativa,
        saidaCorrigida: decisaoAberta === "editado" ? saidaCorrigida : undefined,
        workspaceId: selecionado.workspaceId,
      });
      setDecisaoAberta(null);
      setConfirmacaoAberta(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível registrar a decisão.");
    } finally {
      setProcessando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          rotulo="Aguardando decisão"
          valor={String(estatisticas.abertos)}
          detalhe={`${estatisticas.emAnalise} em análise`}
          tom={estatisticas.abertos > 0 ? "atencao" : "positivo"}
        />
        <MetricCard
          rotulo="SLA violado"
          valor={String(estatisticas.emViolacaoDeSla)}
          detalhe={`${estatisticas.porPrioridade.p1} ticket(s) P1`}
          tom={estatisticas.emViolacaoDeSla > 0 ? "erro" : "positivo"}
        />
        <MetricCard
          rotulo="Tempo médio de resolução"
          valor={
            estatisticas.tempoMedioResolucaoMin === null
              ? "—"
              : `${estatisticas.tempoMedioResolucaoMin} min`
          }
          detalhe={`${estatisticas.resolvidos} resolvido(s)`}
        />
        <MetricCard
          rotulo="Expirados"
          valor={String(estatisticas.expirados)}
          detalhe="sem decisão dentro do SLA"
          tom={estatisticas.expirados > 0 ? "erro" : "neutro"}
        />
      </div>

      {erro && <p className="text-xs text-state-error">{erro}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
          <SegmentedFilter
            rotuloGrupo="Filtro da fila de transbordo"
            opcoes={opcoesFiltro}
            selecionado={filtro}
            onChange={setFiltro}
          />

          {visiveis.length === 0 ? (
            <EmptyState
              title="Nenhum transbordo nesta visão"
              description="Tickets são criados automaticamente quando o motor de guardrails exige revisão humana."
            />
          ) : (
            <ul className="flex flex-col gap-1">
              {visiveis.map((ticket) => {
                const atrasado = slaViolado(ticket, referencia);
                const ativo = ticket.id === selecionadoId;
                return (
                  <li key={ticket.id}>
                    <button
                      type="button"
                      onClick={() => setSelecionadoId(ticket.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[var(--radius-sm)] border px-3 py-2.5 text-left transition-colors",
                        ativo ? "border-signal-500 bg-signal-50" : "border-transparent hover:bg-mist-50"
                      )}
                    >
                      <span
                        className={cn(
                          "mono flex-none rounded-full px-2 py-0.5 text-[11px] font-medium",
                          corPrioridade[ticket.prioridade]
                        )}
                      >
                        {ticket.prioridade.toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink-950">
                          {ROTULO_MOTIVO[ticket.motivo]}
                        </span>
                        <span className="block truncate text-xs text-ink-500">
                          {ticket.flowNome}
                          {ticket.nodeId ? ` · nó ${ticket.nodeId}` : ""} · {ROTULO_STATUS[ticket.status]}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "mono flex-none text-xs",
                          atrasado ? "text-state-error" : "text-ink-400"
                        )}
                      >
                        {formatarSla(ticket, referencia)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
          {!selecionado ? (
            <EmptyState
              title="Selecione um transbordo"
              description="O detalhe da violação, o payload mascarado e as ações de decisão aparecem aqui."
            />
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink-950">
                    {ROTULO_MOTIVO[selecionado.motivo]}
                  </h3>
                  <span className="mono text-xs text-ink-400">{selecionado.traceId}</span>
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  {selecionado.flowNome} · {ROTULO_PRIORIDADE[selecionado.prioridade]} · aberto{" "}
                  {formatRelativeTime(new Date(selecionado.criadoEm))} · SLA{" "}
                  <span className={slaViolado(selecionado, referencia) ? "text-state-error" : undefined}>
                    {formatarSla(selecionado, referencia)}
                  </span>
                </p>
              </div>

              <div>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
                  Violações detectadas
                </h4>
                <ul className="flex flex-col gap-1.5">
                  {selecionado.violacoes.map((violacao, indice) => (
                    <li
                      key={`${violacao.regra}-${indice}`}
                      className="rounded-[var(--radius-sm)] border border-ink-100 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="mono text-[11px] text-ink-500">{violacao.regra}</span>
                        <span className="mono text-[11px] text-state-error">{violacao.severidade}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-700">{violacao.mensagem}</p>
                      {typeof violacao.score === "number" && (
                        <p className="mono mt-0.5 text-[11px] text-ink-400">
                          observado {violacao.score}
                          {typeof violacao.limite === "number" ? ` · limite ${violacao.limite}` : ""}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
                  Payload mascarado
                </h4>
                <pre className="mono max-h-40 overflow-auto rounded-[var(--radius-sm)] bg-ink-950 p-3 text-xs text-mist-50">
                  {selecionado.payloadMascarado || "(vazio)"}
                </pre>
                <p className="mt-1 text-[11px] text-ink-400">
                  Valores pessoais aparecem como marcadores. O dado original nunca é anexado ao ticket.
                </p>
              </div>

              {selecionado.saidaMascarada && (
                <div>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
                    Saída proposta pelo agente
                  </h4>
                  <pre className="mono max-h-40 overflow-auto rounded-[var(--radius-sm)] border border-ink-100 bg-mist-50 p-3 text-xs text-ink-900">
                    {selecionado.saidaMascarada}
                  </pre>
                </div>
              )}

              {selecionado.status === "resolvido" || selecionado.status === "cancelado" ? (
                <div className="rounded-[var(--radius-sm)] border border-ink-100 bg-mist-50 p-3">
                  <p className="text-xs font-medium text-ink-700">
                    Decisão: {selecionado.decisao ? ROTULO_DECISAO[selecionado.decisao] : "—"}
                  </p>
                  {selecionado.justificativa && (
                    <p className="mt-1 text-xs text-ink-500">{selecionado.justificativa}</p>
                  )}
                  <p className="mono mt-1 text-[11px] text-ink-400">
                    {selecionado.decididoPor} ·{" "}
                    {selecionado.decididoEm
                      ? new Date(selecionado.decididoEm).toLocaleString("pt-BR")
                      : "—"}
                  </p>
                </div>
              ) : selecionado.status === "aberto" ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm" loading={processando} onClick={() => handleAssumir(selecionado)}>
                    Assumir revisão
                  </Button>
                  <span className="text-xs text-ink-400">
                    É preciso assumir o ticket antes de decidir — evita duas pessoas resolvendo o mesmo caso.
                  </span>
                </div>
              ) : decisaoAberta === null ? (
                <div className="flex flex-wrap gap-2">
                  {DECISOES.map((decisao) => (
                    <Button
                      key={decisao.valor}
                      size="sm"
                      variant={decisao.variante}
                      title={decisao.descricao}
                      disabled={processando}
                      onClick={() => abrirDecisao(decisao.valor)}
                    >
                      {ROTULO_DECISAO[decisao.valor]}
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-3 rounded-[var(--radius-sm)] border border-signal-500 bg-signal-50 p-3">
                  <div>
                    <label
                      htmlFor="hitl-justificativa"
                      className="block text-xs font-medium text-ink-700"
                    >
                      Justificativa de &ldquo;{ROTULO_DECISAO[decisaoAberta]}&rdquo;
                    </label>
                    <textarea
                      id="hitl-justificativa"
                      value={justificativa}
                      onChange={(e) => setJustificativa(e.target.value)}
                      rows={3}
                      placeholder="Por que esta decisão foi tomada? (mínimo 10 caracteres)"
                      className="mt-1 w-full rounded-[var(--radius-sm)] border border-ink-100 bg-white p-3 text-xs text-ink-950 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
                    />
                    <p className="mt-1 text-[11px] text-ink-500">
                      A justificativa é gravada na trilha de auditoria imutável.
                    </p>
                  </div>

                  {decisaoAberta === "editado" && (
                    <div>
                      <label
                        htmlFor="hitl-saida-corrigida"
                        className="block text-xs font-medium text-ink-700"
                      >
                        Saída corrigida
                      </label>
                      <textarea
                        id="hitl-saida-corrigida"
                        value={saidaCorrigida}
                        onChange={(e) => setSaidaCorrigida(e.target.value)}
                        rows={4}
                        className="mono mt-1 w-full rounded-[var(--radius-sm)] border border-ink-100 bg-white p-3 text-xs text-ink-950 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
                      />
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={decisaoAberta === "rejeitado" ? "danger-solid" : "primary"}
                      loading={processando}
                      onClick={() => {
                        // Rejeitar descarta a saída e encerra a execução: passa
                        // pelo modal de confirmação destrutiva do design system.
                        if (decisaoAberta === "rejeitado") {
                          setConfirmacaoAberta(true);
                        } else {
                          void confirmarDecisao();
                        }
                      }}
                    >
                      Confirmar decisão
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={processando}
                      onClick={() => setDecisaoAberta(null)}
                    >
                      Voltar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <Modal
        open={confirmacaoAberta}
        onClose={() => setConfirmacaoAberta(false)}
        titleId="hitl-rejeitar-title"
        title="Rejeitar a saída do agente?"
        body="A saída é descartada e a execução encerra sem entregar resultado. A decisão e a justificativa ficam registradas de forma imutável na trilha de auditoria."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirmacaoAberta(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger-solid"
              size="sm"
              loading={processando}
              onClick={async () => {
                await confirmarDecisao();
                setConfirmacaoAberta(false);
              }}
            >
              Sim, rejeitar
            </Button>
          </>
        }
      />
    </div>
  );
}
