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
import { ROI_CONFIG_PADRAO, cambioParaMoeda, formatarMoeda } from "@/lib/roi";
import { SegmentedFilter } from "@/components/ui/SegmentedFilter";

const DIAS_NO_MES = 26;

const OPCOES_MOEDA: Array<{ valor: Moeda; label: string }> = [
  { valor: "BRL", label: "R$" },
  { valor: "USD", label: "US$" },
  { valor: "GBP", label: "£" },
];

export function RoiSandbox() {
  const [leadsPerdidosNoite, setLeadsPerdidosNoite] = useState(12);
  const [ticketMedioBrl, setTicketMedioBrl] = useState(180);
  const [taxaConversao, setTaxaConversao] = useState(25);
  const [moeda, setMoeda] = useState<Moeda>("BRL");
  const [copiado, setCopiado] = useState(false);

  // Cálculo financeiro do prejuízo e recuperação de receita — estimativa de
  // apresentação comercial, nunca um número de produção (ver nota de topo).
  const leadsMensaisPerdidos = leadsPerdidosNoite * DIAS_NO_MES;
  const conversoesEstimadas = leadsMensaisPerdidos * (taxaConversao / 100);
  const receitaRecuperadaMensalBrl = conversoesEstimadas * ticketMedioBrl;
  const receitaRecuperadaAnualBrl = receitaRecuperadaMensalBrl * 12;

  const cambio = cambioParaMoeda(ROI_CONFIG_PADRAO, moeda);
  const moedaDoValor = (valorBrl: number) => formatarMoeda(valorBrl, moeda, cambio);

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

      <p className="mt-3 text-[11px] text-ink-400">
        Estimativa de apresentação comercial, com parâmetros ajustáveis — não é um relatório de dados reais de um
        workspace (esses vivem em Governança, calculados a partir de execuções de fato registradas).
      </p>
    </div>
  );
}

export default RoiSandbox;
