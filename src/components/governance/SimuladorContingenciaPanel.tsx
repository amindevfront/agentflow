"use client";

// Simulador de Contingência Macro — Plano de Contingência Anticrise.
//
// Mesma fonte de dados em tempo real de `OpexTaxShieldPanel`/`BusinessROIWidget`
// (mesmo `calcularRoi`) — o simulador nunca mostra um número que o resto do
// painel de Governança não mostraria também, só projeta esse número real
// sobre um horizonte de planejamento (ver `@/lib/contingencia`).

import { useEffect, useMemo, useState } from "react";
import type { Campaign, Conversation, FlowRun, HandoffTicket, Moeda, RoiConfig } from "@/types";
import { subscribeFlowRuns } from "@/lib/firestore";
import { useWorkspace } from "@/lib/workspace";
import { subscribeFilaTransbordo } from "@/lib/humanInTheLoop";
import { subscribeConversations } from "@/lib/inbox/firestore";
import { subscribeCampaigns } from "@/lib/campaigns/firestore";
import {
  ROI_CONFIG_PADRAO,
  cambioParaMoeda,
  calcularRoi,
  formatarHoras,
  formatarMoeda,
  periodoMesAtual,
  subscribeRoiConfig,
} from "@/lib/roi";
import { simularContingenciaMacro, type HorizonteContingencia } from "@/lib/contingencia";
import { MetricCard } from "@/components/ui/MetricCard";
import { SegmentedFilter } from "@/components/ui/SegmentedFilter";
import { EmptyState } from "@/components/ui/EmptyState";

type HorizonteUI = "3" | "6" | "12";

const OPCOES_HORIZONTE: Array<{ valor: HorizonteUI; label: string }> = [
  { valor: "3", label: "3 meses" },
  { valor: "6", label: "6 meses" },
  { valor: "12", label: "12 meses" },
];

export function SimuladorContingenciaPanel() {
  const { workspaceId } = useWorkspace();
  const [execucoes, setExecucoes] = useState<FlowRun[]>([]);
  const [tickets, setTickets] = useState<HandoffTicket[]>([]);
  const [conversas, setConversas] = useState<Conversation[]>([]);
  const [campanhas, setCampanhas] = useState<Campaign[]>([]);
  const [config, setConfig] = useState<RoiConfig>(ROI_CONFIG_PADRAO);
  const [moeda, setMoeda] = useState<Moeda>(ROI_CONFIG_PADRAO.moedaExibicao);
  const [horizonteUI, setHorizonteUI] = useState<HorizonteUI>("12");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [referencia] = useState(() => new Date());

  const horizonte = Number(horizonteUI) as HorizonteContingencia;

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
        onError: () => setErro("Fila de transbordo indisponível no momento. A projeção segue com os demais dados."),
      }),
      subscribeConversations(setConversas, {
        workspaceId,
        limite: 500,
        onError: () => setErro("Neural Inbox indisponível no momento. A projeção segue com os demais dados."),
      }),
      subscribeCampaigns(setCampanhas, {
        workspaceId,
        onError: () => setErro("Campanhas indisponíveis no momento. A projeção segue com os demais dados."),
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
        periodo: periodoMesAtual(referencia),
        referencia,
      }),
    [execucoes, tickets, conversas, campanhas, config, referencia]
  );

  const simulacao = useMemo(
    () => simularContingenciaMacro({ snapshot, horizonteMeses: horizonte }),
    [snapshot, horizonte]
  );

  const moedaDoValor = (valorBrl: number) => formatarMoeda(valorBrl, moeda, cambioParaMoeda(config, moeda));
  const semDados =
    snapshot.execucoesTotais === 0 && snapshot.conversasTotais === 0 && snapshot.campanhasExecutadas === 0;

  return (
    <section
      aria-label="Simulador de Contingência Macro"
      className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-950">Simulador de Contingência Macro</h2>
          <p className="mt-0.5 text-xs text-ink-400">
            Plano de Contingência Anticrise — projeção sobre o ritmo de {snapshot.periodo.rotulo}, mantido constante.
          </p>
        </div>
        <SegmentedFilter
          rotuloGrupo="Horizonte de projeção"
          opcoes={OPCOES_HORIZONTE}
          selecionado={horizonteUI}
          onChange={setHorizonteUI}
        />
      </header>

      {erro && <p className="text-xs text-state-error">{erro}</p>}

      {carregando && semDados ? (
        <p className="text-xs text-ink-400">Carregando simulação…</p>
      ) : semDados ? (
        <EmptyState
          title="Nenhuma execução no período"
          description="O simulador projeta o Custo de Inércia e o ganho líquido de caixa a partir do mesmo snapshot de ROI do mês atual."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              rotulo="Custo de Inércia"
              valor={moedaDoValor(simulacao.custoInerciaProjetadoBrl)}
              detalhe={`em ${horizonte} meses, se a operação voltasse a ser 100% humana`}
              tom="erro"
              dica="Custo humano evitado no mês de referência, projetado linearmente pelo horizonte escolhido — o que a empresa voltaria a pagar se desistisse da automação. Nenhuma curva de crescimento é assumida."
            />
            <MetricCard
              rotulo="Ganho líquido de caixa projetado"
              valor={moedaDoValor(simulacao.ganhoLiquidoProjetadoBrl)}
              detalhe={`mantendo o AgentFlow pelos próximos ${horizonte} meses`}
              tom={simulacao.ganhoLiquidoProjetadoBrl >= 0 ? "positivo" : "erro"}
              dica="Economia líquida do mês de referência (já descontados IA, revisão humana e plataforma), projetada linearmente pelo horizonte escolhido."
            />
            <MetricCard
              rotulo="Horas humanas em risco de retornar"
              valor={formatarHoras(simulacao.horasInerciaProjetadas)}
              detalhe="base da Blindagem de Passivo Trabalhista abaixo"
              tom="atencao"
            />
          </div>

          <div className="flex items-start gap-2.5 rounded-[var(--radius-sm)] border border-state-error-ink/30 bg-state-error-bg p-3">
            <span aria-hidden className="mt-0.5 h-2 w-2 flex-none rounded-full bg-state-error-ink" />
            <div>
              <p className="text-xs font-semibold text-state-error">Blindagem de Passivo Trabalhista</p>
              <p className="mt-0.5 text-xs text-ink-700">
                {formatarHoras(simulacao.horasInerciaProjetadas)} de trabalho repetitivo, no horizonte de {horizonte}{" "}
                meses, não precisariam ser cobertas por operadores humanos em jornada extenuante ou hora extra —
                redução direta de exposição a litígios trabalhistas e ao desgaste operacional que costuma precedê-los.
                Estimativa derivada das horas efetivamente automatizadas no período (ver detalhamento em OpEx &amp; Tax
                Shield); não substitui orientação jurídica.
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default SimuladorContingenciaPanel;
