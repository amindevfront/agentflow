"use client";

// Fleet & SPOT Driver Onboarding — Painel de Gestão de Frota (Governança).
//
// Visão geral dos dossiês de motoristas SPOT monitorados pelo motor
// autônomo de triagem (`@/lib/spotDriverOnboarding`/
// `@/lib/server/spotDriverOnboardingAdmin`) — o tick em si roda via
// scheduler externo (`/api/spot-driver/tick`), nunca disparado por este
// painel: aqui o operador cadastra motoristas/documentos e consulta o
// status, mesmo padrão de `ArRecoveryStatusPanel`.
//
// A fila de decisão (escalar documentação irregular / aprovar cadastro)
// reaproveita 100% de `HandoffQueuePanel` — já tem assumir/decidir/SLA — só
// filtrada pelos dois motivos desta gaveta, sem nenhuma UI de decisão nova.

import { useEffect, useMemo, useState } from "react";
import type { DocumentoMotoristaSpot, DossieMotoristaSpot, TipoDocumentoMotoristaSpot } from "@/types";
import { useWorkspace } from "@/lib/workspace";
import {
  aprovarMotoristaSpot,
  atualizarDocumentoMotoristaSpot,
  criarMotoristaSpot,
  documentosFaltantes,
  subscribeMotoristasSpot,
} from "@/lib/motoristasSpot";
import { CUSTO_EVITADO_GARGALO_PATIO_BRL, ROTULO_DOCUMENTO_SPOT } from "@/lib/spotDriverOnboarding";
import { cambioParaMoeda, formatarHoras, formatarMoeda, ROI_CONFIG_PADRAO } from "@/lib/roi";
import { reportarErro } from "@/lib/telemetry/errorReporting";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { MetricCard } from "@/components/ui/MetricCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { HandoffQueuePanel } from "./HandoffQueuePanel";
import { cn } from "@/lib/utils";

const CORES_STATUS: Record<DossieMotoristaSpot["status"], string> = {
  verde: "bg-state-done-bg text-state-done",
  amarelo: "bg-state-idle-bg text-state-idle",
  vermelho: "bg-state-error-bg text-state-error",
};

const ROTULO_STATUS_DOSSIE: Record<DossieMotoristaSpot["status"], string> = {
  verde: "pronto",
  amarelo: "em triagem",
  vermelho: "irregular",
};

/** Minutos manuais economizados por motorista triado — mesmo valor de `MINUTOS_ECONOMIZADOS_POR_ORIGEM["spot-driver-onboarding"]` (`@/lib/server/backOfficeRoi`), documentado aqui só para a métrica do painel. */
const MINUTOS_ECONOMIZADOS_POR_MOTORISTA = 15;

export function SpotFleetStatusPanel() {
  const { workspaceId } = useWorkspace();
  const [dossies, setDossies] = useState<DossieMotoristaSpot[]>([]);
  const [formAberto, setFormAberto] = useState(false);
  const [nomeMotorista, setNomeMotorista] = useState("");
  const [placaVeiculo, setPlacaVeiculo] = useState("");
  const [processandoId, setProcessandoId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeMotoristasSpot(setDossies, workspaceId);
  }, [workspaceId]);

  const naoAprovados = useMemo(() => dossies.filter((d) => !d.aprovadoEm), [dossies]);
  const emRisco = naoAprovados.filter((d) => d.status === "vermelho").length;

  // Tempo médio de liberação de frota SPOT: mede `aprovadoEm - ticketAbertoEm`
  // do próprio dossiê (nunca da decisão do ticket HITL genérico de
  // `HandoffQueuePanel` — "aprovado" ali significa "liberar a saída do
  // agente como está", um conceito diferente de "liberar a frota"; a única
  // ação que de fato libera a frota é `aprovarMotoristaSpot`, que só toca o
  // dossiê). `ticketAbertoEm` é o instante em que o Shield-Layer terminou de
  // pré-validar o dossiê (status virou `verde`) — o intervalo até
  // `aprovadoEm` é exatamente o tempo de revisão humana de um dossiê já
  // pré-validado (segundos a minutos), o mesmo intervalo que antes levava
  // dias de conferência manual.
  const dossiesAprovados = useMemo(() => dossies.filter((d) => d.aprovadoEm), [dossies]);

  const tempoMedioLiberacaoSegundos = useMemo(() => {
    const comIntervaloConhecido = dossiesAprovados.filter((d) => d.ticketAbertoEm);
    if (comIntervaloConhecido.length === 0) return null;
    const total = comIntervaloConhecido.reduce((acc, d) => {
      const ms = new Date(d.aprovadoEm as string).getTime() - new Date(d.ticketAbertoEm as string).getTime();
      return acc + Math.max(0, ms);
    }, 0);
    return total / comIntervaloConhecido.length / 1000;
  }, [dossiesAprovados]);

  const horasEconomizadas = (dossies.length * MINUTOS_ECONOMIZADOS_POR_MOTORISTA) / 60;
  const custoEvitadoGargaloBrl = dossiesAprovados.length * CUSTO_EVITADO_GARGALO_PATIO_BRL;

  async function handleCriar() {
    if (!nomeMotorista.trim()) return;
    setErro(null);
    try {
      await criarMotoristaSpot({
        nomeMotorista: nomeMotorista.trim(),
        placaVeiculo: placaVeiculo.trim() || null,
        workspaceId: workspaceId ?? undefined,
      });
      setNomeMotorista("");
      setPlacaVeiculo("");
      setFormAberto(false);
    } catch (e) {
      reportarErro(e, "spot-driver:cadastrar-motorista");
      setErro("Não foi possível cadastrar o motorista agora. Tente novamente em alguns instantes.");
    }
  }

  async function handleReceberDocumento(dossie: DossieMotoristaSpot, tipo: TipoDocumentoMotoristaSpot) {
    setProcessandoId(dossie.id);
    setErro(null);
    try {
      const documento: Pick<DocumentoMotoristaSpot, "tipo" | "status" | "validadeEm"> =
        tipo === "cnh" || tipo === "antt"
          ? { tipo, status: "recebido", validadeEm: null }
          : { tipo, status: "valido", validadeEm: null };
      await atualizarDocumentoMotoristaSpot(dossie, documento);
    } catch (e) {
      reportarErro(e, "spot-driver:atualizar-documento");
      setErro("Não foi possível atualizar o documento agora. Tente novamente em alguns instantes.");
    } finally {
      setProcessandoId(null);
    }
  }

  async function handleValidarDocumento(dossie: DossieMotoristaSpot, tipo: TipoDocumentoMotoristaSpot, validade: string) {
    if (!validade) return;
    setProcessandoId(dossie.id);
    setErro(null);
    try {
      await atualizarDocumentoMotoristaSpot(dossie, {
        tipo,
        status: "valido",
        validadeEm: new Date(validade).toISOString(),
      });
    } catch (e) {
      reportarErro(e, "spot-driver:validar-documento");
      setErro("Não foi possível validar o documento agora. Tente novamente em alguns instantes.");
    } finally {
      setProcessandoId(null);
    }
  }

  async function handleAprovar(dossie: DossieMotoristaSpot) {
    setProcessandoId(dossie.id);
    setErro(null);
    try {
      await aprovarMotoristaSpot(dossie);
    } catch (e) {
      reportarErro(e, "spot-driver:aprovar-motorista");
      // Diferente dos outros handlers deste painel: `aprovarMotoristaSpot`
      // pode rejeitar por um motivo de COMPLIANCE real (documentação venceu
      // nos últimos minutos), não só por falha transitória de rede — "tente
      // novamente" seria conselho ativamente errado aqui, então mostra o
      // motivo específico sempre que a própria função o fornece.
      setErro(e instanceof Error ? e.message : "Não foi possível aprovar o motorista agora. Tente novamente em alguns instantes.");
    } finally {
      setProcessandoId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          rotulo="Horas economizadas (equipe administrativa)"
          valor={formatarHoras(horasEconomizadas)}
          detalhe={`${MINUTOS_ECONOMIZADOS_POR_MOTORISTA} min/motorista evitados de conferência manual`}
          tom="marca"
        />
        <MetricCard
          rotulo="Tempo médio de liberação de frota SPOT"
          valor={tempoMedioLiberacaoSegundos != null ? `${Math.round(tempoMedioLiberacaoSegundos)}s` : "—"}
          detalhe="da conferência manual (dias) para a revisão humana de 1 clique"
          tom="positivo"
        />
        <MetricCard
          rotulo="Custo evitado em gargalo de pátio"
          valor={formatarMoeda(custoEvitadoGargaloBrl, ROI_CONFIG_PADRAO.moedaExibicao, cambioParaMoeda(ROI_CONFIG_PADRAO, ROI_CONFIG_PADRAO.moedaExibicao))}
          detalhe={`${dossiesAprovados.length} motorista(s) liberado(s) sem caminhão parado`}
          tom={custoEvitadoGargaloBrl > 0 ? "positivo" : "marca"}
        />
      </div>

      <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-ink-950">Fleet & SPOT Driver Onboarding</h3>
            <p className="mt-0.5 text-xs text-ink-400">
              {emRisco > 0 ? `${emRisco} dossiê(s) com documentação irregular` : "Dossiês de motoristas SPOT em triagem"}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setFormAberto((v) => !v)}>
            {formAberto ? "Cancelar" : "Cadastrar motorista"}
          </Button>
        </div>

        {formAberto && (
          <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-signal-500 bg-signal-50 p-3">
            <Field label="Nome do motorista" value={nomeMotorista} onChange={(e) => setNomeMotorista(e.target.value)} />
            <Field label="Placa do veículo (opcional)" value={placaVeiculo} onChange={(e) => setPlacaVeiculo(e.target.value)} />
            {erro && <p className="text-xs text-state-error">{erro}</p>}
            <Button size="sm" disabled={!nomeMotorista.trim()} onClick={handleCriar}>
              Salvar motorista
            </Button>
          </div>
        )}

        {!formAberto && erro && <p className="text-xs text-state-error">{erro}</p>}

        {naoAprovados.length === 0 ? (
          <EmptyState
            title="Nenhum motorista em triagem"
            description="Cadastre um motorista SPOT para o Shield-Layer validar a documentação obrigatória."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {naoAprovados.map((dossie) => (
              <li key={dossie.id} className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-ink-100 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-semibold text-ink-950">
                      {dossie.nomeMotorista}
                      {dossie.placaVeiculo ? ` · ${dossie.placaVeiculo}` : ""}
                    </span>
                    {dossie.pendencias.length > 0 && (
                      <p className="text-xs text-ink-500">{dossie.pendencias.join(" ")}</p>
                    )}
                  </div>
                  <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", CORES_STATUS[dossie.status])}>
                    {ROTULO_STATUS_DOSSIE[dossie.status]}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {dossie.status === "verde" && (
                    <Button size="sm" loading={processandoId === dossie.id} onClick={() => handleAprovar(dossie)}>
                      Aprovar motorista — liberar frota
                    </Button>
                  )}
                  {documentosFaltantes(dossie).map((tipo) => (
                    <Button
                      key={tipo}
                      size="sm"
                      variant="secondary"
                      loading={processandoId === dossie.id}
                      onClick={() => handleReceberDocumento(dossie, tipo)}
                    >
                      Receber {ROTULO_DOCUMENTO_SPOT[tipo]}
                    </Button>
                  ))}
                  {dossie.documentos
                    .filter((d) => (d.tipo === "cnh" || d.tipo === "antt") && d.status === "recebido")
                    .map((d) => (
                      <ValidadeInline
                        key={d.tipo}
                        rotulo={ROTULO_DOCUMENTO_SPOT[d.tipo]}
                        processando={processandoId === dossie.id}
                        onConfirmar={(validade) => handleValidarDocumento(dossie, d.tipo, validade)}
                      />
                    ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <HandoffQueuePanel motivoFiltro={["motorista-documentacao-irregular", "dossie-motorista-pronto-aprovacao"]} />
    </div>
  );
}

/** Campo inline de data de validade — só aparece para CNH/ANTT recém-recebidas, que precisam de uma data antes de virarem `valido`. */
function ValidadeInline({
  rotulo,
  processando,
  onConfirmar,
}: {
  rotulo: string;
  processando: boolean;
  onConfirmar: (validade: string) => void;
}) {
  const [validade, setValidade] = useState("");
  return (
    <div className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-ink-100 px-2 py-1">
      <span className="text-[11px] text-ink-500">Validade {rotulo}:</span>
      <input
        type="date"
        value={validade}
        onChange={(e) => setValidade(e.target.value)}
        className="rounded border border-ink-100 px-1.5 py-0.5 text-[11px]"
      />
      <Button size="sm" variant="secondary" disabled={!validade} loading={processando} onClick={() => onConfirmar(validade)}>
        Confirmar
      </Button>
    </div>
  );
}

export default SpotFleetStatusPanel;
