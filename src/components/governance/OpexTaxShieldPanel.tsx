"use client";

// OpEx & Tax Shield Calculator.
//
// Responde a uma pergunta específica do empresário, diferente das três que o
// `BusinessROIWidget` já responde: "se eu tivesse contratado uma folha humana
// para fazer este volume de atendimento, quanto do custo-hora seria salário e
// quanto seria encargo patronal (INSS, FGTS, 13º, férias, provisão de
// rescisão; ou FICA/FUTA/SUTA; ou TSU; ou overhead de contractor 1099) — e
// quanto disso eu NÃO preciso desembolsar porque o Time de Agentes Digitais,
// sob Supervisão HITL, fez o trabalho?".
//
// Todo o cálculo vive em `calcularRoi` (`@/lib/roi`), que já decompõe
// `custoHumanoEvitadoBrl` nos quatro regimes (CLT, Payroll US/UK, Contractor
// 1099, Segurança Social PT) em paralelo, sempre. Este componente é apenas
// apresentação — mesma separação de responsabilidade do `BusinessROIWidget`,
// com a mesma fonte de dados em tempo real (Firestore). `APRESENTACAO_REGIME`
// abaixo é o único lugar que decide qual rótulo/linha vai com qual regime —
// nenhum ramo de regime fica de fora do seletor nem herda o rótulo errado de
// outro (ver nota de correção abaixo).

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
  OPCOES_MOEDA,
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

const OPCOES_REGIME: Array<{ valor: RegimeEncargos; label: string }> = [
  { valor: "clt-br", label: "CLT (Brasil)" },
  { valor: "payroll-us-uk", label: "Payroll Tax (EUA/UK)" },
  { valor: "1099-us", label: "Contractor 1099 (EUA)" },
  { valor: "seguranca-social-pt", label: "Segurança Social (Portugal)" },
];

interface LinhaEncargo {
  rotulo: string;
  valorBrl: number;
  percentual: number;
}

/**
 * Centraliza rótulo e decomposição por regime — um só lugar para os quatro,
 * em vez de uma ternária `ehClt` que (antes desta correção) tratava
 * "qualquer regime que não é CLT" como Payroll. Isso fazia um workspace
 * configurado para `1099-us` ou `seguranca-social-pt` (ambos calculados de
 * verdade em `calcularRoi`, só nunca selecionáveis aqui) exibir rótulos
 * errados — FICA patronal/FUTA/SUTA para um contractor americano, ou para
 * Portugal, que não têm nenhum desses encargos.
 */
interface ApresentacaoRegime {
  /** Usado no subtítulo do cabeçalho: "...o que o custo humano evitado representaria se fosse {tipoFolha}". */
  tipoFolha: string;
  rotuloSalario: string;
  rotuloEncargos: string;
  /** Usado no título do detalhamento: "Detalhamento dos encargos {rotuloDetalhamento} poupados". */
  rotuloDetalhamento: string;
  notaSalario: string;
  notaEncargos: string;
  notaReferencia: string;
  salarioBaseEvitado: (snapshot: RoiSnapshot) => number;
  encargosTotais: (snapshot: RoiSnapshot) => number;
  linhas: (snapshot: RoiSnapshot, config: RoiConfig) => LinhaEncargo[];
}

const APRESENTACAO_REGIME: Record<RegimeEncargos, ApresentacaoRegime> = {
  "clt-br": {
    tipoFolha: "uma folha CLT",
    rotuloSalario: "Equivalente salarial CLT evitado",
    rotuloEncargos: "Encargos patronais evitados (CLT)",
    rotuloDetalhamento: "patronais (CLT)",
    notaSalario:
      "Fração do custo humano evitado correspondente apenas ao salário base — sem INSS, FGTS, 13º, férias ou rescisão.",
    notaEncargos: "Soma de INSS patronal, FGTS, 13º salário, férias e provisão de rescisão — ver detalhamento abaixo.",
    notaReferencia: "Estimativa de referência do regime geral (CLT, fora do Simples Nacional)",
    salarioBaseEvitado: (s) => s.salarioBaseEvitadoBrl,
    encargosTotais: (s) => s.encargosTotaisBrl,
    linhas: (s, c) => [
      { rotulo: "INSS patronal", valorBrl: s.encargosInssBrl, percentual: c.composicaoClt.percentualInssPatronal },
      { rotulo: "FGTS", valorBrl: s.encargosFgtsBrl, percentual: c.composicaoClt.percentualFgts },
      {
        rotulo: "13º salário",
        valorBrl: s.encargosDecimoTerceiroBrl,
        percentual: c.composicaoClt.percentualDecimoTerceiro,
      },
      { rotulo: "Férias + 1/3", valorBrl: s.encargosFeriasBrl, percentual: c.composicaoClt.percentualFerias },
      {
        rotulo: "Provisão de rescisão",
        valorBrl: s.encargosProvisaoRescisaoBrl,
        percentual: c.composicaoClt.percentualProvisaoRescisao,
      },
    ],
  },
  "payroll-us-uk": {
    tipoFolha: "uma folha W2/Payroll",
    rotuloSalario: "Equivalente salarial (W2) evitado",
    rotuloEncargos: "Payroll Tax & BPO evitados",
    rotuloDetalhamento: "Payroll/BPO",
    notaSalario:
      "Fração do custo humano evitado correspondente apenas ao salário base W2 — sem FICA, FUTA/SUTA, workers' comp, benefícios ou overhead de BPO.",
    notaEncargos: "Soma de FICA patronal, FUTA/SUTA, workers' comp, benefícios e overhead de BPO — ver detalhamento abaixo.",
    notaReferencia: "Estimativa de referência para empregado W2 ou BPO terceirizado nos EUA/Reino Unido",
    salarioBaseEvitado: (s) => s.salarioBaseEvitadoPayrollBrl,
    encargosTotais: (s) => s.encargosTotaisPayrollBrl,
    linhas: (s, c) => [
      { rotulo: "FICA patronal", valorBrl: s.encargosFicaBrl, percentual: c.composicaoPayroll.percentualFicaPatronal },
      { rotulo: "FUTA/SUTA", valorBrl: s.encargosFutaSutaBrl, percentual: c.composicaoPayroll.percentualFutaSuta },
      {
        rotulo: "Workers' comp",
        valorBrl: s.encargosWorkersCompBrl,
        percentual: c.composicaoPayroll.percentualWorkersComp,
      },
      { rotulo: "Benefícios", valorBrl: s.encargosBeneficiosBrl, percentual: c.composicaoPayroll.percentualBeneficios },
      {
        rotulo: "Overhead de BPO",
        valorBrl: s.encargosBpoOverheadBrl,
        percentual: c.composicaoPayroll.percentualBpoOverhead,
      },
    ],
  },
  "1099-us": {
    tipoFolha: "um contractor 1099",
    rotuloSalario: "Valor evitado ao contractor 1099",
    rotuloEncargos: "Overhead de gestão evitado (1099)",
    rotuloDetalhamento: "do contractor 1099",
    notaSalario:
      "Fração do custo humano evitado correspondente ao valor pago ao contractor — sem encargo patronal, que não se aplica a este regime (o contractor recolhe o próprio self-employment tax).",
    notaEncargos:
      "Overhead opcional de gestão/compliance do contratante sobre o contractor 1099 — zero por padrão, configurável nos Parâmetros.",
    notaReferencia:
      "Contractor 1099 (EUA): a empresa não carrega FICA/FUTA/workers' comp sobre este custo-hora — residual quase inteiro é o valor pago ao contractor",
    salarioBaseEvitado: (s) => s.salarioBaseEvitado1099Brl,
    encargosTotais: (s) => s.encargosTotais1099Brl,
    linhas: (s, c) => [
      {
        rotulo: "Overhead de gestão de contratante",
        valorBrl: s.encargosOverheadGestaoContratanteBrl,
        percentual: c.composicao1099.percentualOverheadGestaoContratante,
      },
    ],
  },
  "seguranca-social-pt": {
    tipoFolha: "uma folha portuguesa (Segurança Social)",
    rotuloSalario: "Equivalente salarial evitado (Portugal)",
    rotuloEncargos: "TSU patronal evitada",
    rotuloDetalhamento: "da Segurança Social (TSU)",
    notaSalario: "Fração do custo humano evitado correspondente apenas ao salário base — sem a TSU patronal.",
    notaEncargos:
      "TSU (Taxa Social Única) — alíquota patronal do regime geral português — ver detalhamento abaixo.",
    notaReferencia: "Estimativa de referência pública da TSU do regime geral em Portugal (23,75%)",
    salarioBaseEvitado: (s) => s.salarioBaseEvitadoSegurancaSocialPtBrl,
    encargosTotais: (s) => s.encargosTotaisSegurancaSocialPtBrl,
    linhas: (s, c) => [
      {
        rotulo: "TSU patronal",
        valorBrl: s.encargosSegurancaSocialPatronalBrl,
        percentual: c.composicaoSegurancaSocialPt.percentualSegurancaSocialPatronal,
      },
    ],
  },
};

export function OpexTaxShieldPanel() {
  const { workspaceId } = useWorkspace();
  const [execucoes, setExecucoes] = useState<FlowRun[]>([]);
  const [tickets, setTickets] = useState<HandoffTicket[]>([]);
  const [conversas, setConversas] = useState<Conversation[]>([]);
  const [campanhas, setCampanhas] = useState<Campaign[]>([]);
  const [config, setConfig] = useState<RoiConfig>(ROI_CONFIG_PADRAO);
  const [moeda, setMoeda] = useState<Moeda>(ROI_CONFIG_PADRAO.moedaExibicao);
  // Lente do Tax Shield: puramente de visualização — as quatro decomposições
  // (CLT, Payroll, 1099, Segurança Social PT) já vêm calculadas no snapshot,
  // então alternar aqui nunca recalcula nem descarta histórico (ver nota em
  // `RoiSnapshot`).
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

  const apresentacao = APRESENTACAO_REGIME[regime];
  const salarioBaseEvitado = apresentacao.salarioBaseEvitado(snapshot);
  const encargosTotais = apresentacao.encargosTotais(snapshot);
  const linhasEncargo: LinhaEncargo[] = apresentacao.linhas(snapshot, config);

  return (
    <section
      aria-label="OpEx e encargos patronais poupados"
      className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-950">Economia em folha e encargos</h2>
          <p className="mt-0.5 text-xs text-ink-400">
            {snapshot.periodo.rotulo} · quanto você não precisou desembolsar em salário e encargos, como se fosse{" "}
            {apresentacao.tipoFolha}
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
          description="Esta economia é calculada a partir do mesmo custo humano evitado do painel de ROI."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              rotulo={apresentacao.rotuloSalario}
              valor={moedaDoValor(salarioBaseEvitado)}
              detalhe="salário base, sem encargos"
              tom="neutro"
              dica={apresentacao.notaSalario}
            />
            <MetricCard
              rotulo={apresentacao.rotuloEncargos}
              valor={moedaDoValor(encargosTotais)}
              detalhe={`${formatarPercentual(
                snapshot.custoHumanoEvitadoBrl > 0 ? encargosTotais / snapshot.custoHumanoEvitadoBrl : 0
              )} do custo humano evitado`}
              tom="marca"
              dica={apresentacao.notaEncargos}
            />
            <MetricCard
              rotulo="Dinheiro líquido retido no caixa"
              valor={moedaDoValor(snapshot.economiaLiquidaBrl)}
              detalhe={`após custo de IA, revisão humana e plataforma`}
              tom={snapshot.economiaLiquidaBrl >= 0 ? "positivo" : "erro"}
              dica="Custo humano evitado menos o custo total de operar os agentes de IA (IA + revisão humana quando necessário + rateio de plataforma) — o mesmo número do painel de ROI."
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
              Detalhamento dos encargos {apresentacao.rotuloDetalhamento} poupados
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
            {apresentacao.notaReferencia} — ajuste os percentuais na aba Parâmetros para refletir o regime tributário
            real do seu negócio. Não substitui orientação contábil ou jurídica.
          </p>
        </>
      )}
    </section>
  );
}

export default OpexTaxShieldPanel;
