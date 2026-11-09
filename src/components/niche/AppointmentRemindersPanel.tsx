"use client";

// Fluxo anti-no-show e preparo pré-procedimento (nicho Clínicas de Saúde).
//
// Sem worker server-side nesta versão (mesma honestidade de
// `expirarTicketsVencidos`): as janelas de 24h/2h são recalculadas sob
// demanda — a cada minuto enquanto o painel está aberto — e o envio de fato
// é um clique do operador, nunca automático e silencioso. O texto da
// confirmação passa pelo mesmo pipeline (`enviarMensagemOperador`) de
// qualquer resposta humana na Neural Inbox.

import { useEffect, useMemo, useState } from "react";
import type { Appointment } from "@/types";
import { useWorkspace } from "@/lib/workspace";
import { auth } from "@/lib/firebase";
import { reportarErro } from "@/lib/telemetry/errorReporting";
import {
  calcularCheckInsPosAtendimentoPendentes,
  calcularJanelasPendentes,
  criarAgendamento,
  enviarCheckInPosAtendimento,
  enviarConfirmacaoAgendamento,
  registrarConsentimentoProcedimento,
  subscribeAgendamentos,
  textoConfirmacao,
  textoPosAtendimento,
} from "@/lib/appointments";
import { calcularCustoAgendaVazia } from "@/lib/noShowCost";
import { formatarMoeda, formatarPercentual, periodoMesAtual } from "@/lib/roi";
import { MetricCard } from "@/components/ui/MetricCard";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatRelativeTime } from "@/lib/utils";

interface AppointmentRemindersPanelProps {
  /** Quando há uma conversa aberta na Neural Inbox, novos agendamentos já nascem vinculados a ela. */
  conversaSelecionada?: { id: string; nome: string } | null;
}

export function AppointmentRemindersPanel({ conversaSelecionada }: AppointmentRemindersPanelProps) {
  const { workspaceId } = useWorkspace();
  const [agendamentos, setAgendamentos] = useState<Appointment[]>([]);
  const [referencia, setReferencia] = useState(() => new Date());
  const [formAberto, setFormAberto] = useState(false);
  const [pacienteNome, setPacienteNome] = useState("");
  const [procedimento, setProcedimento] = useState("");
  const [dataHora, setDataHora] = useState("");
  const [diretrizesPreparo, setDiretrizesPreparo] = useState("");
  const [valorProcedimento, setValorProcedimento] = useState("");
  const [processandoId, setProcessandoId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeAgendamentos(setAgendamentos, workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    const intervalo = setInterval(() => setReferencia(new Date()), 60_000);
    return () => clearInterval(intervalo);
  }, []);

  // Dependências em valores primitivos, não no objeto `conversaSelecionada`
  // em si: o componente-pai recria esse objeto a cada render (literal
  // inline), então depender da referência disparava este efeito — e
  // sobrescrevia o que o operador tivesse digitado — a cada nova mensagem
  // ou tecla na tela, não só quando a conversa de fato mudava.
  useEffect(() => {
    if (conversaSelecionada) setPacienteNome(conversaSelecionada.nome);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversaSelecionada?.id, conversaSelecionada?.nome]);

  const janelas = useMemo(() => calcularJanelasPendentes(agendamentos, referencia), [agendamentos, referencia]);
  const checkInsPosAtendimento = useMemo(
    () => calcularCheckInsPosAtendimentoPendentes(agendamentos, referencia),
    [agendamentos, referencia]
  );

  // Custo de Agenda Vazia: escopado ao mês corrente, mesmo recorte temporal
  // de `periodoMesAtual` (@/lib/roi) usado em todo painel financeiro do
  // produto — evita que o card misture no-shows de meses diferentes num
  // único número.
  const periodoMes = useMemo(() => periodoMesAtual(referencia), [referencia]);
  const agendamentosDoMes = useMemo(
    () =>
      agendamentos.filter((a) => {
        const instante = new Date(a.dataHora).getTime();
        return instante >= new Date(periodoMes.inicio).getTime() && instante <= new Date(periodoMes.fim).getTime();
      }),
    [agendamentos, periodoMes]
  );
  const custoAgendaVazia = useMemo(() => calcularCustoAgendaVazia(agendamentosDoMes), [agendamentosDoMes]);
  const TOM_NO_SHOW = { saudavel: "positivo", atencao: "atencao", critico: "erro" } as const;

  async function handleCriar() {
    const uid = auth?.currentUser?.uid;
    if (!uid || !pacienteNome.trim() || !procedimento.trim() || !dataHora) return;
    setErro(null);
    try {
      const valor = valorProcedimento.trim() ? Number(valorProcedimento) : undefined;
      await criarAgendamento({
        pacienteNome: pacienteNome.trim(),
        procedimento: procedimento.trim(),
        dataHora: new Date(dataHora).toISOString(),
        diretrizesPreparo: diretrizesPreparo.trim() || undefined,
        valorProcedimentoBrl: valor !== undefined && Number.isFinite(valor) && valor > 0 ? valor : undefined,
        conversationId: conversaSelecionada?.id ?? null,
        workspaceId: workspaceId ?? undefined,
        criadoPor: uid,
      });
      setProcedimento("");
      setDataHora("");
      setDiretrizesPreparo("");
      setValorProcedimento("");
      setFormAberto(false);
    } catch (e) {
      reportarErro(e, "agendamentos:criar");
      setErro("Não foi possível criar o agendamento agora. Tente novamente em alguns instantes.");
    }
  }

  async function handleEnviar(agendamento: Appointment, janela: "24h" | "2h") {
    const uid = auth?.currentUser?.uid;
    if (!uid) {
      setErro("Sessão expirada. Entre novamente para enviar a confirmação.");
      return;
    }
    setProcessandoId(agendamento.id);
    setErro(null);
    try {
      await enviarConfirmacaoAgendamento(agendamento, janela, { remetenteId: uid });
    } catch (e) {
      reportarErro(e, "agendamentos:enviar-confirmacao");
      setErro("Não foi possível enviar a confirmação agora. Tente novamente em alguns instantes.");
    } finally {
      setProcessandoId(null);
    }
  }

  async function handleRegistrarConsentimento(agendamento: Appointment) {
    setProcessandoId(agendamento.id);
    setErro(null);
    try {
      await registrarConsentimentoProcedimento(agendamento);
    } catch (e) {
      reportarErro(e, "agendamentos:registrar-consentimento");
      setErro("Consentimento NÃO foi selado. Tente novamente em alguns instantes.");
    } finally {
      setProcessandoId(null);
    }
  }

  async function handleEnviarPosAtendimento(agendamento: Appointment) {
    const uid = auth?.currentUser?.uid;
    if (!uid) {
      setErro("Sessão expirada. Entre novamente para enviar a checagem.");
      return;
    }
    setProcessandoId(agendamento.id);
    setErro(null);
    try {
      await enviarCheckInPosAtendimento(agendamento, { remetenteId: uid });
    } catch (e) {
      reportarErro(e, "agendamentos:enviar-pos-atendimento");
      setErro("Não foi possível enviar a checagem pós-atendimento agora. Tente novamente em alguns instantes.");
    } finally {
      setProcessandoId(null);
    }
  }

  const totalPendente = janelas.precisamConfirmacao24h.length + janelas.precisamConfirmacao2h.length;

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink-950">Confirmação de agenda &amp; preparo</h3>
          <p className="mt-0.5 text-xs text-ink-400">Janelas automáticas de 24h e 2h antes do procedimento.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setFormAberto((v) => !v)}>
          {formAberto ? "Cancelar" : "Novo agendamento"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          rotulo="Pendentes de confirmação (24h)"
          valor={String(janelas.precisamConfirmacao24h.length)}
          detalhe="inclui as diretrizes de preparo"
          tom={janelas.precisamConfirmacao24h.length > 0 ? "atencao" : "positivo"}
        />
        <MetricCard
          rotulo="Pendentes de confirmação (2h)"
          valor={String(janelas.precisamConfirmacao2h.length)}
          detalhe="confirmação final, hoje"
          tom={janelas.precisamConfirmacao2h.length > 0 ? "erro" : "positivo"}
        />
        <MetricCard
          rotulo="Checagem pós-atendimento (48h)"
          valor={String(checkInsPosAtendimento.length)}
          detalhe="blindagem de reputação"
          tom={checkInsPosAtendimento.length > 0 ? "atencao" : "positivo"}
        />
        <MetricCard
          rotulo="Custo de agenda vazia (mês)"
          valor={formatarMoeda(custoAgendaVazia.custoNoShowBrl, "BRL")}
          detalhe={`${formatarPercentual(custoAgendaVazia.taxaNoShow)} de no-show no mês`}
          tom={TOM_NO_SHOW[custoAgendaVazia.nivelAlerta]}
          dica="Soma o valor do procedimento de cada no-show do mês corrente — configure o valor ao criar o agendamento para este card refletir a perda real."
        />
      </div>

      {formAberto && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-signal-500 bg-signal-50 p-3">
          <Field label="Paciente" value={pacienteNome} onChange={(e) => setPacienteNome(e.target.value)} />
          <Field label="Procedimento" value={procedimento} onChange={(e) => setProcedimento(e.target.value)} placeholder="Ex.: Consulta de retorno" />
          <Field label="Data e hora" type="datetime-local" value={dataHora} onChange={(e) => setDataHora(e.target.value)} />
          <Field
            label="Valor do procedimento (R$) — opcional"
            type="number"
            value={valorProcedimento}
            onChange={(e) => setValorProcedimento(e.target.value)}
            placeholder="Ex.: 350"
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="appt-preparo" className="text-sm font-medium text-ink-700">
              Diretrizes de preparo (opcional)
            </label>
            <textarea
              id="appt-preparo"
              value={diretrizesPreparo}
              onChange={(e) => setDiretrizesPreparo(e.target.value)}
              rows={2}
              placeholder="Ex.: Jejum de 8h antes do exame."
              className="rounded-[var(--radius-sm)] border border-ink-100 bg-white p-3 text-sm text-ink-950 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
            />
          </div>
          {erro && <p className="text-xs text-state-error">{erro}</p>}
          <Button size="sm" disabled={!pacienteNome.trim() || !procedimento.trim() || !dataHora} onClick={handleCriar}>
            Salvar agendamento
          </Button>
        </div>
      )}

      {!formAberto && erro && <p className="text-xs text-state-error">{erro}</p>}

      {totalPendente === 0 ? (
        <EmptyState title="Nenhuma janela pendente agora" description="Confirmações aparecem aqui 24h e 2h antes de cada procedimento agendado." />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {[
            ...janelas.precisamConfirmacao24h.map((a) => ({ agendamento: a, janela: "24h" as const })),
            ...janelas.precisamConfirmacao2h.map((a) => ({ agendamento: a, janela: "2h" as const })),
          ].map(({ agendamento, janela }) => (
            <li
              key={`${agendamento.id}-${janela}`}
              className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-ink-100 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink-950">{agendamento.pacienteNome}</span>
                <span className="mono rounded-full bg-signal-100 px-2 py-0.5 text-[11px] font-medium text-signal-700">
                  janela {janela}
                </span>
              </div>
              <p className="text-xs text-ink-500">
                {agendamento.procedimento} · {formatRelativeTime(new Date(agendamento.dataHora))}
              </p>
              <p className="text-xs text-ink-400">{textoConfirmacao(agendamento, janela)}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  loading={processandoId === agendamento.id}
                  disabled={!agendamento.conversationId}
                  title={!agendamento.conversationId ? "Vincule este agendamento a uma conversa para enviar pelo canal" : undefined}
                  onClick={() => handleEnviar(agendamento, janela)}
                >
                  Enviar agora
                </Button>
                {agendamento.termoConsentimentoRegistradoEm ? (
                  <span className="mono rounded-full bg-state-done-bg px-2 py-0.5 text-[11px] font-medium text-state-done">
                    consentimento selado
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={processandoId === agendamento.id}
                    onClick={() => handleRegistrarConsentimento(agendamento)}
                    title="Blindagem Jurídica de Procedimento — selado na trilha de auditoria à prova de adulteração"
                  >
                    Registrar consentimento
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {checkInsPosAtendimento.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-ink-100 pt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            Blindagem de reputação — checagem pós-atendimento
          </h4>
          <ul className="flex flex-col gap-1.5">
            {checkInsPosAtendimento.map((agendamento) => (
              <li
                key={`${agendamento.id}-pos-atendimento`}
                className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-ink-100 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink-950">{agendamento.pacienteNome}</span>
                  <span className="mono rounded-full bg-state-run-bg px-2 py-0.5 text-[11px] font-medium text-state-run">
                    48h depois
                  </span>
                </div>
                <p className="text-xs text-ink-500">
                  {agendamento.procedimento} · realizado {formatRelativeTime(new Date(agendamento.dataHora))}
                </p>
                <p className="text-xs text-ink-400">{textoPosAtendimento(agendamento)}</p>
                <Button
                  size="sm"
                  loading={processandoId === agendamento.id}
                  disabled={!agendamento.conversationId}
                  title={!agendamento.conversationId ? "Vincule este agendamento a uma conversa para enviar pelo canal" : undefined}
                  onClick={() => handleEnviarPosAtendimento(agendamento)}
                >
                  Enviar checagem
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default AppointmentRemindersPanel;
