"use client";

// OpEx & Tax Shield Calculator.
//
// Responde a uma pergunta específica do empresário, diferente das três que o
// `BusinessROIWidget` já responde: "se eu tivesse contratado CLT para fazer
// este volume de atendimento, quanto do custo-hora seria salário e quanto
// seria encargo patronal (INSS, FGTS, 13º, férias, provisão de rescisão) —
// e quanto disso eu NÃO preciso desembolsar porque a automação fez o
// trabalho?".
//
// Todo o cálculo vive em `calcularRoi` (`@/lib/roi`), que já decompõe
// `custoHumanoEvitadoBrl` nos componentes CLT via `composicaoClt`. Este
// componente é apenas apresentação — mesma separação de responsabilidade do
// `BusinessROIWidget`, com a mesma fonte de dados em tempo real (Firestore).

import { useEffect, useMemo, useState } from "react";
import type {
  Campaign,
  Conversation,
  FlowRun,
  HandoffTicket,
  Moeda,
  RegimeEncargos,
  RoiConfig,
  RoiSnapshot,
} from "@/types";
import { subscribeFlowRuns } from "@/lib/firestore";
import { useWorkspace } from "@/lib/workspace";
import { subscribeFilaTransbordo } from "@/lib/humanInTheLoop";
import { subscribeConversations } from "@/lib/inbox/firestore";
import { subscribeCampaigns } from "@/lib/campaigns/firestore";
import {
  ROI_CONFIG_PADRAO,
  cambioParaMoeda,
  calcularRoi,
  formatarMoeda,
  formatarPercentual,
  periodoMesAtual,
  subscribeRoiConfig,
} from "@/lib/roi";
import { MetricCard } from "@/components/ui/MetricCard";
import { SegmentedFilter } from "@/components/ui/SegmentedFilter";
import { EmptyState } from "@/components/ui/EmptyState";

const OPCOES_MOEDA: Array<{ valor: Moeda; label: string }> = [
  { valor: "BRL", label: "R$" },
  { valor: "USD", label: "US$" },
  { valor: "GBP", label: "£" },
];

const OPCOES_REGIME: Array<{ valor: RegimeEncargos; label: string }> = [
  { valor: "clt-br", label: "CLT (Brasil)" },
  { valor: "payroll-us-uk", label: "Payroll (EUA/UK)" },
];

interface LinhaEncargo {
  rotulo: string;
  valorBrl: number;
  percentual: number;
}

export function OpexTaxShieldPanel() {
  const { workspaceId } = useWorkspace();
  const [execucoes, setExecucoes] = useState<FlowRun[]>([]);
  const [tickets, setTickets] = useState<HandoffTicket[]>([]);
  const [conversas, setConversas] = useState<Conversation[]>([]);
  const [campanhas, setCampanhas] = useState<Campaign[]>([]);
  const [config, setConfig] = useState<RoiConfig>(ROI_CONFIG_PADRAO);
  const [moeda, setMoeda] = useState<Moeda>(ROI_CONFIG_PADRAO.moedaExibicao);
  // Lente do Tax Shield: puramente de visualização — as duas decomposições
  // (CLT e Payroll) já vêm calculadas no snapshot, então alternar aqui nunca
  // recalcula nem descarta histórico (ver nota em `RoiSnapshot`).
  const [regime, setRegime] = useState<RegimeEncargos>(ROI_CONFIG_PADRAO.regimeEncargos);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [referencia] = useState(() => new Date());

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
        setRegime(nova.regimeEncargos);
      }, workspaceId),
    ];
    return () => cancelamentos.forEach((cancelar) => cancelar());
  }, [workspaceId]);

  const snapshot: RoiSnapshot = useMemo(
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

  const moedaDoValor = (valor: number) => formatarMoeda(valor, moeda, cambioParaMoeda(config, moeda));
  const semDados =
    snapshot.execucoesTotais === 0 && snapshot.conversasTotais === 0 && snapshot.campanhasExecutadas === 0;

  const ehClt = regime === "clt-br";

  const salarioBaseEvitado = ehClt ? snapshot.salarioBaseEvitadoBrl : snapshot.salarioBaseEvitadoPayrollBrl;
  const encargosTotais = ehClt ? snapshot.encargosTotaisBrl : snapshot.encargosTotaisPayrollBrl;
  const rotuloSalario = ehClt ? "Equivalente salarial CLT evitado" : "Equivalente salarial (W2) evitado";
  const rotuloEncargos = ehClt ? "Encargos patronais evitados (CLT)" : "Payroll Tax & BPO evitados";

  const linhasEncargo: LinhaEncargo[] = ehClt
    ? [
        {
          rotulo: "INSS patronal",
          valorBrl: snapshot.encargosInssBrl,
          percentual: config.composicaoClt.percentualInssPatronal,
        },
        { rotulo: "FGTS", valorBrl: snapshot.encargosFgtsBrl, percentual: config.composicaoClt.percentualFgts },
        {
          rotulo: "13º salário",
          valorBrl: snapshot.encargosDecimoTerceiroBrl,
          percentual: config.composicaoClt.percentualDecimoTerceiro,
        },
        {
          rotulo: "Férias + 1/3",
          valorBrl: snapshot.encargosFeriasBrl,
          percentual: config.composicaoClt.percentualFerias,
        },
        {
          rotulo: "Provisão de rescisão",
          valorBrl: snapshot.encargosProvisaoRescisaoBrl,
          percentual: config.composicaoClt.percentualProvisaoRescisao,
        },
      ]
    : [
        {
          rotulo: "FICA patronal",
          valorBrl: snapshot.encargosFicaBrl,
          percentual: config.composicaoPayroll.percentualFicaPatronal,
        },
        {
          rotulo: "FUTA/SUTA",
          valorBrl: snapshot.encargosFutaSutaBrl,
          percentual: config.composicaoPayroll.percentualFutaSuta,
        },
        {
          rotulo: "Workers' comp",
          valorBrl: snapshot.encargosWorkersCompBrl,
          percentual: config.composicaoPayroll.percentualWorkersComp,
        },
        {
          rotulo: "Benefícios",
          valorBrl: snapshot.encargosBeneficiosBrl,
          percentual: config.composicaoPayroll.percentualBeneficios,
        },
        {
          rotulo: "Overhead de BPO",
          valorBrl: snapshot.encargosBpoOverheadBrl,
          percentual: config.composicaoPayroll.percentualBpoOverhead,
        },
      ];

  return (
    <section
      aria-label="OpEx e encargos patronais poupados"
      className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-950">OpEx &amp; Tax Shield</h2>
          <p className="mt-0.5 text-xs text-ink-400">
            {snapshot.periodo.rotulo} · o que o custo humano evitado representaria se fosse{" "}
            {ehClt ? "uma folha CLT" : "uma folha W2/Payroll"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <SegmentedFilter
            rotuloGrupo="Regime de encargos"
            opcoes={OPCOES_REGIME}
            selecionado={regime}
            onChange={setRegime}
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
          description="O Tax Shield é calculado a partir do mesmo custo humano evitado do painel de ROI."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              rotulo={rotuloSalario}
              valor={moedaDoValor(salarioBaseEvitado)}
              detalhe="salário base, sem encargos"
              tom="neutro"
              dica={
                ehClt
                  ? "Fração do custo humano evitado correspondente apenas ao salário base — sem INSS, FGTS, 13º, férias ou rescisão."
                  : "Fração do custo humano evitado correspondente apenas ao salário base W2 — sem FICA, FUTA/SUTA, workers' comp, benefícios ou overhead de BPO."
              }
            />
            <MetricCard
              rotulo={rotuloEncargos}
              valor={moedaDoValor(encargosTotais)}
              detalhe={`${formatarPercentual(
                snapshot.custoHumanoEvitadoBrl > 0 ? encargosTotais / snapshot.custoHumanoEvitadoBrl : 0
              )} do custo humano evitado`}
              tom="marca"
              dica={
                ehClt
                  ? "Soma de INSS patronal, FGTS, 13º salário, férias e provisão de rescisão — ver detalhamento abaixo."
                  : "Soma de FICA patronal, FUTA/SUTA, workers' comp, benefícios e overhead de BPO — ver detalhamento abaixo."
              }
            />
            <MetricCard
              rotulo="Dinheiro líquido retido no caixa"
              valor={moedaDoValor(snapshot.economiaLiquidaBrl)}
              detalhe={`após custo de IA, revisão humana e plataforma`}
              tom={snapshot.economiaLiquidaBrl >= 0 ? "positivo" : "erro"}
              dica="Custo humano evitado menos o custo total de operar a automação (IA + revisão humana + rateio de plataforma) — o mesmo número do painel de ROI."
            />
            <MetricCard
              rotulo="Custo-hora de referência"
              valor={moedaDoValor(config.custoHoraOperadorBrl)}
              detalhe="totalmente carregado, configurável nos Parâmetros"
              tom="neutro"
            />
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
              Detalhamento dos encargos {ehClt ? "patronais (CLT)" : "Payroll/BPO"} poupados
            </p>
            <ul className="flex flex-col gap-1.5">
              {linhasEncargo.map((linha) => (
                <li
                  key={linha.rotulo}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-ink-100 px-3 py-2"
                >
                  <span className="text-xs text-ink-700">{linha.rotulo}</span>
                  <span className="flex items-center gap-2">
                    <span className="mono text-[11px] text-ink-400">{formatarPercentual(linha.percentual)}</span>
                    <span className="mono text-sm font-medium text-ink-950">{moedaDoValor(linha.valorBrl)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-[11px] text-ink-400">
            {ehClt
              ? "Estimativa de referência do regime geral (CLT, fora do Simples Nacional)"
              : "Estimativa de referência para empregado W2 ou BPO terceirizado nos EUA/Reino Unido"}{" "}
            — ajuste os percentuais na aba Parâmetros para refletir o regime tributário real do seu negócio. Não
            substitui orientação contábil ou jurídica.
          </p>
        </>
      )}
    </section>
  );
}

export default OpexTaxShieldPanel;
