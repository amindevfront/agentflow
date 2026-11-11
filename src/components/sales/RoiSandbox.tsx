"use client";

// Executive Closing Engine — simulador de ROI para o time comercial
// apresentar a um PROSPECT antes de ele virar cliente (sem workspace, sem
// login). Diferente dos simuladores de Governança (Simulador de
// Contingência Macro, OpEx & Tax Shield), que só mostram números REAIS de
// um workspace já existente, este componente é deliberadamente hipotético
// — os três controles abaixo são estimativas que o vendedor ajusta ao vivo
// com o prospect, não dados auditáveis. Por isso vive fora da Governança,
// em `/sandbox` (página pública, sem Firestore, sem autenticação).

import { useMemo, useState } from "react";
import type { Moeda } from "@/types";
import { OPCOES_MOEDA, ROI_CONFIG_PADRAO, cambioParaMoeda, formatarMoeda } from "@/lib/roi";
import { FAIXAS_PRECO_CONTRATO, OPCOES_PLANO_CONTRATO, calcularRoiContrato, type PlanoContrato } from "@/lib/salesPricingTiers";
import { SegmentedFilter } from "@/components/ui/SegmentedFilter";

const DIAS_NO_MES = 26;
const MESES_PROJECAO = 12;

function acionarDownloadPdf(bytes: Uint8Array, nomeArquivo: string): void {
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function RoiSandbox() {
  const [leadsPerdidosNoite, setLeadsPerdidosNoite] = useState(12);
  const [ticketMedioBrl, setTicketMedioBrl] = useState(180);
  const [taxaConversao, setTaxaConversao] = useState(25);
  const [moeda, setMoeda] = useState<Moeda>("BRL");
  const [copiado, setCopiado] = useState(false);
  // Contexto de escala pro prospect — NÃO alimenta o cálculo (seria preciso
  // inventar uma taxa "visitante → lead perdido" sem base real; o cálculo
  // continua ancorado em "leads perdidos", o número que o implementador
  // consegue de verdade com o prospect, nunca uma estimativa derivada).
  const [visitantesMensaisSite, setVisitantesMensaisSite] = useState<string>("");
  const [nomeProspect, setNomeProspect] = useState("");
  const [plano, setPlano] = useState<PlanoContrato>("profissional");
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [erroPdf, setErroPdf] = useState<string | null>(null);

  // Cálculo financeiro do prejuízo e recuperação de receita — estimativa de
  // apresentação comercial, nunca um número de produção (ver nota de topo).
  const leadsMensaisPerdidos = leadsPerdidosNoite * DIAS_NO_MES;
  const conversoesEstimadas = leadsMensaisPerdidos * (taxaConversao / 100);
  const receitaRecuperadaMensalBrl = conversoesEstimadas * ticketMedioBrl;
  const receitaRecuperadaAnualBrl = receitaRecuperadaMensalBrl * 12;

  const cambio = cambioParaMoeda(ROI_CONFIG_PADRAO, moeda);
  const moedaDoValor = (valorBrl: number) => formatarMoeda(valorBrl, moeda, cambio);

  // ROI projetado do contrato real — usa o PONTO MÉDIO da faixa oficial de
  // preço do plano escolhido (nunca o mínimo, que subestima o custo real do
  // cliente, nem um valor inventado fora da tabela — ver `@/lib/salesPricingTiers`).
  const faixaPlano = FAIXAS_PRECO_CONTRATO[plano];
  const setupBrl = (faixaPlano.setupMinBrl + faixaPlano.setupMaxBrl) / 2;
  const mrrBrl = (faixaPlano.mrrMinBrl + faixaPlano.mrrMaxBrl) / 2;
  const roiContrato = calcularRoiContrato({
    ganhoMensalBrl: receitaRecuperadaMensalBrl,
    setupBrl,
    mrrBrl,
    meses: MESES_PROJECAO,
  });
  const paybackLabel =
    roiContrato.paybackMeses === null
      ? `mais de ${MESES_PROJECAO} meses (ou nunca, nesta projeção)`
      : `${roiContrato.paybackMeses} ${roiContrato.paybackMeses === 1 ? "mês" : "meses"}`;
  const roiPercentualLabel = roiContrato.roiPercentual === null ? "—" : `${roiContrato.roiPercentual.toFixed(0)}%`;

  const argumentoExecutivo = useMemo(
    () =>
      `Com ${leadsMensaisPerdidos} leads desperdiçados por mês fora do horário comercial, a ausência de resposta ` +
      `imediata custa cerca de ${formatarMoeda(receitaRecuperadaMensalBrl, moeda, cambio)}/mês ` +
      `(${formatarMoeda(receitaRecuperadaAnualBrl, moeda, cambio)}/ano). ` +
      `O AgentFlow se paga nos primeiros dias de operação.`,
    [leadsMensaisPerdidos, receitaRecuperadaMensalBrl, receitaRecuperadaAnualBrl, moeda, cambio]
  );

  async function copiarArgumento() {
    try {
      await navigator.clipboard.writeText(argumentoExecutivo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Clipboard pode estar indisponível (permissão negada, contexto não seguro) —
      // o texto ainda está visível e selecionável manualmente no card abaixo.
    }
  }

  async function gerarProposta() {
    setErroPdf(null);
    setGerandoPdf(true);
    try {
      // `pdf-lib` só é carregado quando o download é de fato acionado — mesmo
      // padrão dos relatórios de prontidão em Governança.
      const { gerarPropostaImpactoPdf } = await import("@/lib/reports/salesImpactPdf");
      const bytes = await gerarPropostaImpactoPdf({
        nomeProspect: nomeProspect.trim() || undefined,
        geradoEm: new Date().toISOString(),
        geradoPor: "implementador AgentFlow",
        moedaLabel: moeda,
        leadsPerdidosNoite,
        leadsMensaisPerdidos,
        ticketMedioFormatado: moedaDoValor(ticketMedioBrl),
        taxaConversaoPercentual: taxaConversao,
        visitantesMensaisSite: visitantesMensaisSite.trim() ? Number(visitantesMensaisSite) : null,
        receitaRecuperadaMensalFormatada: moedaDoValor(receitaRecuperadaMensalBrl),
        receitaRecuperadaAnualFormatada: moedaDoValor(receitaRecuperadaAnualBrl),
        planoLabel: faixaPlano.label,
        planoDescricao: faixaPlano.descricao,
        setupFormatado: moedaDoValor(setupBrl),
        mrrFormatado: `${moedaDoValor(mrrBrl)}/mês`,
        mesesProjecao: MESES_PROJECAO,
        custoTotalFormatado: moedaDoValor(roiContrato.custoTotalBrl),
        ganhoTotalFormatado: moedaDoValor(roiContrato.ganhoTotalBrl),
        lucroLiquidoFormatado: moedaDoValor(roiContrato.lucroLiquidoBrl),
        roiPercentualFormatado: roiPercentualLabel,
        paybackLabel,
        argumentoExecutivo,
      });
      acionarDownloadPdf(bytes, `agentflow-proposta-impacto-${nomeProspect.trim() || "prospect"}.pdf`);
    } catch (e) {
      setErroPdf(e instanceof Error ? e.message : "Não foi possível gerar a proposta agora.");
    } finally {
      setGerandoPdf(false);
    }
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-ink-100 bg-white p-6 shadow-[var(--shadow-sm)]">
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <span className="rounded-[var(--radius-sm)] bg-signal-50 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-signal-700">
            Executive Closing Engine
          </span>
          <h3 className="mt-2 text-lg font-semibold text-ink-950">
            Simulador de Impacto &amp; Blindagem de Receita
          </h3>
          <p className="text-sm text-ink-500">
            Demonstre o impacto estimado para o prospect antes de fechar o contrato de implementação.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <SegmentedFilter rotuloGrupo="Moeda de apresentação" opcoes={OPCOES_MOEDA} selecionado={moeda} onChange={setMoeda} />
          <div className="rounded-[var(--radius-md)] border border-ink-100 bg-mist-50 p-4 text-right">
            <span className="block text-xs text-ink-500">Receita anual protegida (estimativa)</span>
            <span className="mono text-2xl font-medium text-signal-700">{moedaDoValor(receitaRecuperadaAnualBrl)}</span>
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-700">
            Leads perdidos por noite (após horário): <span className="mono font-semibold text-ink-950">{leadsPerdidosNoite}</span>
          </label>
          <input
            type="range"
            min={2}
            max={50}
            value={leadsPerdidosNoite}
            onChange={(e) => setLeadsPerdidosNoite(Number(e.target.value))}
            className="w-full cursor-pointer accent-signal-600"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-ink-700">
            Ticket médio do serviço: <span className="mono font-semibold text-ink-950">{moedaDoValor(ticketMedioBrl)}</span>
          </label>
          <input
            type="range"
            min={50}
            max={1500}
            step={50}
            value={ticketMedioBrl}
            onChange={(e) => setTicketMedioBrl(Number(e.target.value))}
            className="w-full cursor-pointer accent-signal-600"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-ink-700">
            Taxa de conversão da IA: <span className="mono font-semibold text-ink-950">{taxaConversao}%</span>
          </label>
          <input
            type="range"
            min={10}
            max={60}
            step={5}
            value={taxaConversao}
            onChange={(e) => setTaxaConversao(Number(e.target.value))}
            className="w-full cursor-pointer accent-signal-600"
          />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-700" htmlFor="sandbox-nome-prospect">
            Nome do prospect (opcional — aparece na proposta)
          </label>
          <input
            id="sandbox-nome-prospect"
            type="text"
            value={nomeProspect}
            onChange={(e) => setNomeProspect(e.target.value)}
            placeholder="Ex.: Clínica Bella Vita"
            className="h-9 w-full rounded-[var(--radius-sm)] border border-ink-100 bg-white px-3 text-sm outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-700" htmlFor="sandbox-visitantes">
            Visitantes mensais no site (opcional — só contexto, não entra na conta)
          </label>
          <input
            id="sandbox-visitantes"
            type="number"
            min={0}
            value={visitantesMensaisSite}
            onChange={(e) => setVisitantesMensaisSite(e.target.value)}
            placeholder="Ex.: 4000"
            className="h-9 w-full rounded-[var(--radius-sm)] border border-ink-100 bg-white px-3 text-sm outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
          />
        </div>
      </div>

      <div className="mb-6 rounded-[var(--radius-md)] border border-ink-100 bg-mist-50 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink-950">ROI projetado do contrato ({MESES_PROJECAO} meses)</p>
            <p className="text-xs text-ink-500">
              Plano <strong>{faixaPlano.label}</strong> — {faixaPlano.descricao}. Preço usado: ponto médio da faixa
              oficial (setup {moedaDoValor(setupBrl)} + MRR {moedaDoValor(mrrBrl)}/mês).
            </p>
          </div>
          <SegmentedFilter rotuloGrupo="Plano de contrato" opcoes={OPCOES_PLANO_CONTRATO} selecionado={plano} onChange={setPlano} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-[var(--radius-sm)] border border-ink-100 bg-white p-3">
            <span className="block text-[11px] text-ink-500">Custo no período</span>
            <span className="mono text-base font-semibold text-ink-950">{moedaDoValor(roiContrato.custoTotalBrl)}</span>
          </div>
          <div className="rounded-[var(--radius-sm)] border border-ink-100 bg-white p-3">
            <span className="block text-[11px] text-ink-500">Ganho no período</span>
            <span className="mono text-base font-semibold text-state-done">{moedaDoValor(roiContrato.ganhoTotalBrl)}</span>
          </div>
          <div className="rounded-[var(--radius-sm)] border border-ink-100 bg-white p-3">
            <span className="block text-[11px] text-ink-500">ROI no período</span>
            <span className={`mono text-base font-semibold ${(roiContrato.roiPercentual ?? 0) >= 0 ? "text-signal-700" : "text-state-error"}`}>
              {roiPercentualLabel}
            </span>
          </div>
          <div className="rounded-[var(--radius-sm)] border border-ink-100 bg-white p-3">
            <span className="block text-[11px] text-ink-500">Payback</span>
            <span className="mono text-base font-semibold text-ink-950">{paybackLabel}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-start justify-between gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-mist-50 p-4 text-sm md:flex-row md:items-center">
        <p className="text-ink-700">
          <strong>Argumento de venda:</strong> {argumentoExecutivo}
        </p>
        <button
          type="button"
          onClick={copiarArgumento}
          className="flex-none rounded-[var(--radius-btn)] bg-ink-950 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-ink-900"
        >
          {copiado ? "Copiado!" : "Copiar argumento executivo"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={gerarProposta}
          disabled={gerandoPdf}
          className="rounded-[var(--radius-btn)] bg-signal-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-signal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {gerandoPdf ? "Gerando…" : "Gerar Proposta de Governança e Impacto (PDF)"}
        </button>
        {erroPdf && <p className="text-xs text-state-error">{erroPdf}</p>}
      </div>

      <p className="mt-3 text-[11px] text-ink-400">
        Estimativa de apresentação comercial, com parâmetros ajustáveis — não é um relatório de dados reais de um
        workspace (esses vivem em Governança, calculados a partir de execuções de fato registradas).
      </p>
    </div>
  );
}

export default RoiSandbox;
