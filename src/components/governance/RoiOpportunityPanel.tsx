"use client";

// Oportunidade & Pipeline (C-Level) — contraponto ao `BusinessROIWidget`.
//
// `BusinessROIWidget`/`OpexTaxShieldPanel` respondem "quanto economizamos".
// Este painel responde a outra pergunta, que fecha contrato: "quanto negócio
// o Time de Agentes Digitais está gerando" — atendimentos, leads qualificados
// de madrugada e agendamentos confirmados traduzidos em pipeline financeiro
// estimado, via `/api/roi-dashboard` (`@/lib/server/roiDashboard`).
//
// Honestidade do número (mesma regra de `@/lib/roi`): `pipelineEstimadoBrl`
// é SEMPRE oportunidade estimada, nunca receita realizada. Nichos sem Módulo
// Vertical de confirmação de agendamento implementado (valor médio
// configurado em 0) dizem isso explicitamente, em vez de mostrar um zero sem
// contexto — ver `VALOR_MEDIO_PIPELINE_PADRAO_BRL`.

import { useEffect, useState } from "react";
import type { RoiConfig } from "@/types";
import type { MetricasPipelineVertical } from "@/lib/server/roiDashboard";
import { ROI_CONFIG_PADRAO, cambioParaMoeda, formatarMoeda, subscribeRoiConfig } from "@/lib/roi";
import { NICHE_PRESETS } from "@/lib/niches";
import { useWorkspace } from "@/lib/workspace";
import { auth } from "@/lib/firebase";
import { MetricCard } from "@/components/ui/MetricCard";
import { EmptyState } from "@/components/ui/EmptyState";

interface RespostaRoiDashboard {
  disponivel: boolean;
  metricas: MetricasPipelineVertical | null;
  erro?: { mensagem: string };
}

export function RoiOpportunityPanel() {
  const { workspaceId } = useWorkspace();
  const [config, setConfig] = useState<RoiConfig>(ROI_CONFIG_PADRAO);
  const [resposta, setResposta] = useState<RespostaRoiDashboard | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeRoiConfig(setConfig, workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelado = false;

    async function carregar() {
      setCarregando(true);
      setErro(null);
      try {
        const usuario = auth?.currentUser;
        if (!usuario) {
          throw new Error("Sessão expirada. Entre novamente para ver o pipeline.");
        }

        const res = await fetch("/api/roi-dashboard", {
          headers: { authorization: `Bearer ${await usuario.getIdToken()}` },
        });
        const dados = (await res.json().catch(() => ({}))) as RespostaRoiDashboard;
        if (!res.ok) {
          throw new Error(dados.erro?.mensagem ?? `Falha ao carregar o pipeline (HTTP ${res.status}).`);
        }
        if (!cancelado) setResposta(dados);
      } catch (e) {
        if (!cancelado) setErro(e instanceof Error ? e.message : "Não foi possível carregar o pipeline.");
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }

    carregar();
    return () => {
      cancelado = true;
    };
  }, [workspaceId]);

  const moedaDoValor = (valorBrl: number) =>
    formatarMoeda(valorBrl, config.moedaExibicao, cambioParaMoeda(config, config.moedaExibicao));

  const metricas = resposta?.metricas ?? null;

  return (
    <section
      aria-label="Oportunidade e pipeline"
      className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4"
    >
      <header>
        <h2 className="text-sm font-semibold text-ink-950">Oportunidade &amp; Pipeline</h2>
        <p className="mt-0.5 text-xs text-ink-400">
          Quanto negócio o Time de Agentes Digitais gerou este mês — não quanto custo evitou.
        </p>
      </header>

      {erro && <p className="text-xs text-state-error">{erro}</p>}

      {carregando ? (
        <p className="text-xs text-ink-400">Carregando pipeline…</p>
      ) : !resposta?.disponivel || !metricas ? (
        <EmptyState
          title="Nicho ainda não configurado"
          description="Defina o setor do workspace em Configurações para calcular o pipeline estimado deste negócio."
        />
      ) : metricas.valorMedioPipelineUsadoBrl <= 0 ? (
        <EmptyState
          title="Pipeline ainda não disponível para este nicho"
          description={`${NICHE_PRESETS[metricas.setor].label} ainda não tem um Módulo Vertical de confirmação de agendamento com valor de pipeline configurado. Fale com o time AgentFlow para calibrar o ticket médio deste negócio.`}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            rotulo="Pipeline estimado no mês"
            valor={moedaDoValor(metricas.pipelineEstimadoBrl)}
            detalhe={`${metricas.agendamentosConfirmados} agendamento(s) × ${moedaDoValor(metricas.valorMedioPipelineUsadoBrl)}`}
            tom="marca"
            dica="Estimativa de oportunidade em pipeline, nunca receita realizada — agendamentos confirmados (visitas, consultas, reuniões de diagnóstico) multiplicados pelo valor médio configurado para este nicho."
          />
          <MetricCard
            rotulo="Agendamentos confirmados"
            valor={String(metricas.agendamentosConfirmados)}
            detalhe={NICHE_PRESETS[metricas.setor].label}
            tom="positivo"
          />
          <MetricCard
            rotulo="Leads qualificados de madrugada"
            valor={String(metricas.leadsQualificadosMadrugada)}
            detalhe="0h–6h, com resposta do cliente"
            tom="atencao"
          />
          <MetricCard
            rotulo="Atendimentos no período"
            valor={String(metricas.atendimentos)}
            detalhe="Neural Inbox, qualquer desfecho"
          />
        </div>
      )}
    </section>
  );
}

export default RoiOpportunityPanel;
