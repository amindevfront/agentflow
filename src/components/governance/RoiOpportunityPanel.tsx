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
//
// Bug real em produção: a aba mostrava "Nicho ainda não configurado" (e, por
// trás, um HTTP 500) mesmo com um Fluxo já criado e salvo. Causa raiz: a
// gravação do workspace em Firestore (`setor` incluso, ver `prepareWorkspace`
// em `@/lib/firestore`) é otimista — `useWorkspace()`/`pendingSync` já sabe
// quando essa confirmação ainda está em voo (ver ADR-0003/0006), mas este
// painel ignorava esse sinal e tratava "ainda sincronizando" como se fosse
// "nicho nunca configurado", um tom enganoso para o dono do negócio.

import { useEffect, useState } from "react";
import type { RoiConfig } from "@/types";
import type { MetricasPipelineVertical } from "@/lib/server/roiDashboard";
import { ROI_CONFIG_PADRAO, cambioParaMoeda, formatarMoeda, subscribeRoiConfig } from "@/lib/roi";
import { NICHE_PRESETS } from "@/lib/niches";
import { useWorkspace } from "@/lib/workspace";
import { auth } from "@/lib/firebase";
import { reportarErro } from "@/lib/telemetry/errorReporting";
import { MetricCard } from "@/components/ui/MetricCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

interface RespostaRoiDashboard {
  disponivel: boolean;
  metricas: MetricasPipelineVertical | null;
  erro?: { mensagem: string };
}

export function RoiOpportunityPanel() {
  const { workspaceId, pendingSync } = useWorkspace();
  const [config, setConfig] = useState<RoiConfig>(ROI_CONFIG_PADRAO);
  const [resposta, setResposta] = useState<RespostaRoiDashboard | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeRoiConfig(setConfig, workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    // Enquanto a gravação do workspace ainda está sincronizando (ver
    // `pendingSync` em `@/lib/workspace`), o Admin SDK pode legitimamente
    // ainda não ver o `setor` que o usuário já escolheu — buscar agora só
    // produziria o falso negativo "nicho não configurado". Espera a
    // sincronização confirmar (ou falhar de vez) antes de perguntar ao
    // servidor.
    if (!workspaceId || pendingSync) return;
    let cancelado = false;

    async function carregar() {
      setCarregando(true);
      setErro(null);
      try {
        const usuario = auth?.currentUser;
        if (!usuario) {
          throw new Error("Sessão expirada. Entre novamente para ver o pipeline.");
        }

        // Uma falha de rede crua (servidor fora do ar, sem conexão) lança um
        // `TypeError` do próprio `fetch` ("Failed to fetch") — nunca deveria
        // chegar como texto técnico na tela do dono do negócio.
        let res: Response;
        try {
          res = await fetch("/api/roi-dashboard", {
            headers: { authorization: `Bearer ${await usuario.getIdToken()}` },
          });
        } catch (erroDeRede) {
          reportarErro(erroDeRede, "governanca:pipeline:rede");
          throw new Error("Não foi possível conectar ao servidor para carregar o pipeline. Verifique sua conexão.");
        }
        const dados = (await res.json().catch(() => ({}))) as RespostaRoiDashboard;
        if (!res.ok) {
          throw new Error(dados.erro?.mensagem ?? "Falha ao carregar o pipeline. Tente novamente em alguns instantes.");
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
  }, [workspaceId, pendingSync, tentativa]);

  const moedaDoValor = (valorBrl: number) =>
    formatarMoeda(valorBrl, config.moedaExibicao, cambioParaMoeda(config, config.moedaExibicao));

  const metricas = resposta?.metricas ?? null;
  // `metricas.setor` vem do Firestore (`as NicheKey` sem validação em
  // runtime, ver `obterMetricasPipelineVerticalAdmin`) — um valor legado ou
  // corrompido que seja string mas não bata com nenhum `NicheKey` conhecido
  // faria `NICHE_PRESETS[...]` devolver `undefined` e quebrar a tela ao
  // acessar `.label`. Nunca confiar que o dado persistido bate com o tipo.
  const nichePreset = metricas ? NICHE_PRESETS[metricas.setor] : undefined;
  const labelDoNicho = nichePreset?.label ?? "Nicho não reconhecido";

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

      {pendingSync ? (
        <p className="text-xs text-ink-400">Sincronizando configuração do workspace…</p>
      ) : carregando ? (
        <p className="text-xs text-ink-400">Carregando pipeline…</p>
      ) : erro ? (
        <EmptyState
          title="Não foi possível carregar o pipeline"
          description={erro}
          action={
            <Button variant="secondary" size="sm" onClick={() => setTentativa((n) => n + 1)}>
              Tentar novamente
            </Button>
          }
        />
      ) : !resposta?.disponivel || !metricas ? (
        <EmptyState
          title="Nicho ainda não configurado"
          description="Defina o setor do workspace em Configurações para calcular o pipeline estimado deste negócio."
        />
      ) : metricas.valorMedioPipelineUsadoBrl <= 0 ? (
        <EmptyState
          title="Pipeline ainda não disponível para este nicho"
          description={`${labelDoNicho} ainda não tem um Módulo Vertical de confirmação de agendamento com valor de pipeline configurado. Fale com o time AgentFlow para calibrar o ticket médio deste negócio.`}
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
            detalhe={labelDoNicho}
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
