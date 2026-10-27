"use client";

// Dashboard de ROI e métricas financeiras em tempo real.
//
// Responde às três perguntas que sustentam a renovação de um contrato B2B:
//
//   (a) quantas horas humanas o AgentFlow devolveu ao time neste mês?
//   (b) quanto isso representa em redução de OpEx, em moeda?
//   (c) que fração das execuções fecha sem toque humano (zero-touch)?
//
// O componente é apenas apresentação: todo o cálculo vive em `@/lib/roi`, que é
// puro e testado. "Tempo real" vem das assinaturas do Firestore — execuções,
// tickets de transbordo e configuração chegam por `onSnapshot`, e o snapshot é
// recalculado por `useMemo` a cada mudança.

import { useEffect, useMemo, useState } from "react";
import type { Campaign, Conversation, FlowRun, HandoffTicket, Moeda, RoiConfig, RoiPeriodo } from "@/types";
import { subscribeFlowRuns } from "@/lib/firestore";
import { useWorkspace } from "@/lib/workspace";
import { subscribeFilaTransbordo } from "@/lib/humanInTheLoop";
import { subscribeConversations } from "@/lib/inbox/firestore";
import { subscribeCampaigns } from "@/lib/campaigns/firestore";
import {
  ROI_CONFIG_PADRAO,
  calcularRoi,
  formatarHoras,
  formatarMoeda,
  formatarPercentual,
  formatarTokens,
  periodoMesAtual,
  periodoUltimosDias,
  subscribeRoiConfig,
} from "@/lib/roi";
import { MetricCard } from "@/components/ui/MetricCard";
import { SegmentedFilter } from "@/components/ui/SegmentedFilter";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";

type JanelaPeriodo = "mes" | "30d" | "7d";

const OPCOES_PERIODO: Array<{ valor: JanelaPeriodo; label: string }> = [
  { valor: "mes", label: "Mês atual" },
  { valor: "30d", label: "30 dias" },
  { valor: "7d", label: "7 dias" },
];

const OPCOES_MOEDA: Array<{ valor: Moeda; label: string }> = [
  { valor: "BRL", label: "R$" },
  { valor: "USD", label: "US$" },
];

function resolverPeriodo(janela: JanelaPeriodo, referencia: Date): RoiPeriodo {
  if (janela === "mes") return periodoMesAtual(referencia);
  return periodoUltimosDias(janela === "30d" ? 30 : 7, referencia);
}

/** Classifica a taxa zero-touch em tom visual, usando as faixas do produto. */
function tomAutonomia(taxa: number): "positivo" | "atencao" | "erro" {
  if (taxa >= 0.85) return "positivo";
  if (taxa >= 0.6) return "atencao";
  return "erro";
}

interface BusinessROIWidgetProps {
  /** Compacto exibe apenas as três métricas principais. */
  compacto?: boolean;
  className?: string;
}

export function BusinessROIWidget({ compacto = false, className }: BusinessROIWidgetProps) {
  const { workspaceId } = useWorkspace();
  const [execucoes, setExecucoes] = useState<FlowRun[]>([]);
  const [tickets, setTickets] = useState<HandoffTicket[]>([]);
  const [conversas, setConversas] = useState<Conversation[]>([]);
  const [campanhas, setCampanhas] = useState<Campaign[]>([]);
  const [config, setConfig] = useState<RoiConfig>(ROI_CONFIG_PADRAO);
  const [janela, setJanela] = useState<JanelaPeriodo>("mes");
  const [moeda, setMoeda] = useState<Moeda>(ROI_CONFIG_PADRAO.moedaExibicao);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Âncora temporal estável: sem ela, cada render criaria um `new Date()`
  // diferente e o `useMemo` do snapshot nunca reaproveitaria o cálculo.
  const [referencia, setReferencia] = useState(() => new Date());

  useEffect(() => {
    // Reancorar de minuto em minuto mantém "SLA restante" e a janela de
    // período corretos em um painel que fica aberto o dia inteiro.
    const intervalo = setInterval(() => setReferencia(new Date()), 60_000);
    return () => clearInterval(intervalo);
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    const cancelamentos = [
      subscribeFlowRuns(workspaceId, (lista) => {
        setExecucoes(lista);
        setCarregando(false);
      }),
      subscribeFilaTransbordo(setTickets, {
        workspaceId,
        limite: 300,
        onError: () => setErro("Fila de transbordo indisponível no momento. Os demais números continuam atualizados."),
      }),
      // Neural Inbox e campanhas alimentam o MESMO snapshot de ROI — ver a
      // nota "Unificação financeira" em `calcularRoi`.
      subscribeConversations(setConversas, {
        workspaceId,
        limite: 500,
        onError: () => setErro("Neural Inbox indisponível no momento. Os demais números continuam atualizados."),
      }),
      subscribeCampaigns(setCampanhas, {
        workspaceId,
        onError: () => setErro("Campanhas indisponíveis no momento. Os demais números continuam atualizados."),
      }),
      subscribeRoiConfig((nova) => {
        setConfig(nova);
        setMoeda(nova.moedaExibicao);
      }, workspaceId),
    ];
    return () => cancelamentos.forEach((cancelar) => cancelar());
  }, [workspaceId]);

  const snapshot = useMemo(
    () =>
      calcularRoi({
        execucoes,
        tickets,
        conversas,
        campanhas,
        config,
        periodo: resolverPeriodo(janela, referencia),
        referencia,
      }),
    [execucoes, tickets, conversas, campanhas, config, janela, referencia]
  );

  const moedaDoValor = (valor: number) => formatarMoeda(valor, moeda, config.cambioUsdBrl);
  // "Sem dados" precisa olhar as três origens — um workspace que só usa a
  // Neural Inbox (zero fluxos) ainda tem ROI real para mostrar.
  const semDados =
    snapshot.execucoesTotais === 0 && snapshot.conversasTotais === 0 && snapshot.campanhasExecutadas === 0;

  return (
    <section
      aria-label="Retorno sobre investimento"
      className={cn(
        "flex flex-col gap-4 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4",
        className
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-950">Retorno operacional</h2>
          <p className="mt-0.5 text-xs text-ink-400">
            {snapshot.periodo.rotulo} · <span className="mono">{snapshot.execucoesTotais}</span> execuç
            {snapshot.execucoesTotais === 1 ? "ão" : "ões"} · <span className="mono">{snapshot.conversasTotais}</span>{" "}
            conversa{snapshot.conversasTotais === 1 ? "" : "s"} · <span className="mono">{snapshot.enviosCampanhaRealizados}</span>{" "}
            envio{snapshot.enviosCampanhaRealizados === 1 ? "" : "s"} de campanha
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <SegmentedFilter
            rotuloGrupo="Período de apuração"
            opcoes={OPCOES_PERIODO}
            selecionado={janela}
            onChange={setJanela}
          />
          <SegmentedFilter
            rotuloGrupo="Moeda de exibição"
            opcoes={OPCOES_MOEDA}
            selecionado={moeda}
            onChange={setMoeda}
          />
        </div>
      </header>

      {erro && <p className="text-xs text-state-error">{erro}</p>}

      {carregando && semDados ? (
        <p className="text-xs text-ink-400">Carregando métricas…</p>
      ) : semDados ? (
        <EmptyState
          title="Nenhuma execução no período"
          description="As métricas financeiras são calculadas a partir das execuções registradas pelo motor de orquestração."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              rotulo="Horas humanas economizadas"
              valor={formatarHoras(snapshot.horasEconomizadasLiquidas)}
              detalhe={`${formatarHoras(snapshot.horasEconomizadasBrutas)} brutas − ${formatarHoras(snapshot.horasGastasEmRevisao)} de revisão`}
              tom="marca"
              dica={`Soma de fluxos concluídos (${snapshot.execucoesConcluidas} × ${config.minutosManuaisPorExecucao} min), conversas resolvidas (${snapshot.conversasResolvidas} × ${config.minutosManuaisPorConversa} min) e envios de campanha (${snapshot.enviosCampanhaRealizados} × ${config.minutosManuaisPorEnvioCampanha} min) — menos as horas efetivamente gastas em transbordo.`}
            />
            <MetricCard
              rotulo="Redução de OpEx"
              valor={moedaDoValor(snapshot.economiaLiquidaBrl)}
              detalhe={`${formatarPercentual(snapshot.reducaoOpexPercentual)} do custo humano · ROI ${formatarPercentual(snapshot.roiPercentual)}`}
              tom={snapshot.economiaLiquidaBrl >= 0 ? "positivo" : "erro"}
              dica={`Custo humano evitado (${moedaDoValor(snapshot.custoHumanoEvitadoBrl)}) menos o custo de tokens de IA (${moedaDoValor(snapshot.custoIaBrl)}), a revisão humana (${moedaDoValor(snapshot.custoRevisaoHumanaBrl)}) e o rateio da plataforma (${moedaDoValor(snapshot.custoPlataformaBrl)}).`}
            />
            <MetricCard
              rotulo="Autonomia dos agentes"
              valor={formatarPercentual(snapshot.taxaZeroTouch)}
              detalhe={`${snapshot.execucoesComIntervencao} de ${snapshot.execucoesConcluidas + snapshot.execucoesFalhas} exigiram toque humano`}
              tom={tomAutonomia(snapshot.taxaZeroTouch)}
              dica="Execuções terminais concluídas sem transbordo e sem intervenção registrada, divididas pelo total de execuções terminais (concluídas + falhas). Execuções em andamento não entram no cálculo."
            />
          </div>

          {!compacto && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Detalhamento financeiro</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  rotulo="Custo de IA no período"
                  valor={moedaDoValor(snapshot.custoIaBrl)}
                  detalhe={`${formatarTokens(snapshot.tokensTotais)} tokens · câmbio ${config.cambioUsdBrl.toFixed(2)}`}
                  dica="Soma de fluxos, conversas (triagem/rascunho por IA) e campanhas (personalização por IA). Custo reportado pelo provedor tem precedência; sem ele, estimado pela contagem de tokens e pela tabela de preços configurada."
                />
                <MetricCard
                  rotulo="Custo por execução"
                  valor={moedaDoValor(snapshot.custoPorExecucaoBrl)}
                  detalhe="IA + revisão + plataforma"
                  dica="Custo total da automação dividido pelas execuções terminais do período."
                />
                <MetricCard
                  rotulo="Taxa de sucesso"
                  valor={formatarPercentual(snapshot.taxaSucesso)}
                  detalhe={`${snapshot.execucoesFalhas} falha${snapshot.execucoesFalhas === 1 ? "" : "s"} · ${snapshot.execucoesEmAndamento} em andamento`}
                  tom={snapshot.taxaSucesso >= 0.95 ? "positivo" : "atencao"}
                />
                <MetricCard
                  rotulo="Custo humano evitado"
                  valor={moedaDoValor(snapshot.custoHumanoEvitadoBrl)}
                  detalhe={`${formatarMoeda(config.custoHoraOperadorBrl, moeda, config.cambioUsdBrl)}/hora de operador`}
                  dica="Horas economizadas brutas multiplicadas pelo custo-hora carregado configurado para o workspace."
                />
              </div>

              {/* Subtítulo de seção: sem ele, os onze cartões desta visão
                  completa formam uma parede indiferenciada — a hierarquia
                  tipográfica aqui é o que separa "visão geral" de
                  "detalhamento por origem" para o olho do operador. */}
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                Neural Inbox &amp; campanhas
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  rotulo="Conversas resolvidas"
                  valor={String(snapshot.conversasResolvidas)}
                  detalhe={`${snapshot.mensagensProcessadas} mensagens processadas pelo Shield-Layer`}
                  dica="Conversas da Neural Inbox com status 'resolvida' no período — cada uma credita minutos manuais evitados ao mesmo total acima."
                />
                <MetricCard
                  rotulo="Frustração crítica"
                  valor={String(snapshot.conversasComFrustracaoCritica)}
                  detalhe="conversas com Circuit Breaker acionado"
                  tom={snapshot.conversasComFrustracaoCritica > 0 ? "atencao" : "positivo"}
                  dica="Conversas em que o Radar de Sentimento cruzou o limiar crítico e abriu um ticket P1 de SLA."
                />
                <MetricCard
                  rotulo="Campanhas concluídas"
                  valor={String(snapshot.campanhasExecutadas)}
                  detalhe={`${snapshot.enviosCampanhaRealizados} envio(s) realizado(s)`}
                  dica="Campanhas de disparo em massa concluídas no período — cada envio real credita minutos manuais evitados ao mesmo total acima."
                />
                <MetricCard
                  rotulo="Bloqueados por conformidade"
                  valor={String(snapshot.enviosCampanhaBloqueados)}
                  detalhe="opt-out ou falha na checagem"
                  dica="Envios de campanha bloqueados pelo motor anti-ban antes de qualquer tentativa de envio — opt-out registrado ou falha de conformidade."
                />
              </div>

              {/* Transparência da base de cálculo: um painel de ROI sem esta
                  ressalva seria otimista por omissão. */}
              {snapshot.execucoesSemTelemetria > 0 && (
                <p className="rounded-[var(--radius-sm)] border border-state-run-ink/30 bg-state-run-bg px-3 py-2 text-xs text-state-run">
                  <span className="mono">{snapshot.execucoesSemTelemetria}</span> de{" "}
                  <span className="mono">{snapshot.execucoesTotais}</span> execuções não registraram
                  telemetria de custo e ficaram fora dos agregados financeiros. Cobertura dos dados:{" "}
                  <span className="mono">{formatarPercentual(snapshot.cobertura)}</span>.
                </p>
              )}

              <p className="mono text-[11px] text-ink-400">
                atualizado em {new Date(snapshot.atualizadoEm).toLocaleString("pt-BR")}
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}

export default BusinessROIWidget;
