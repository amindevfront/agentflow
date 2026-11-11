// Tabela oficial de preços (setup + MRR) do AgentFlow — única fonte de
// verdade usada pelo Sales Impact Engine (`@/components/sales/RoiSandbox`)
// para projetar o ROI de um contrato real. Números em BRL (moeda de
// cálculo interna, convertida na exibição — mesmo padrão de `@/lib/roi`).
//
// NUNCA inventar um valor novo aqui: esta tabela é a mesma já usada em
// qualquer pitch/proposta comercial do AgentFlow. Se o preço mudar, muda
// aqui — e só aqui.

export type PlanoContrato = "simples" | "profissional" | "enterprise";

export interface FaixaPrecoContrato {
  label: string;
  descricao: string;
  setupMinBrl: number;
  setupMaxBrl: number;
  mrrMinBrl: number;
  mrrMaxBrl: number;
}

export const FAIXAS_PRECO_CONTRATO: Record<PlanoContrato, FaixaPrecoContrato> = {
  simples: {
    label: "Simples/Local",
    descricao: "1 nicho, Web Widget + simulações",
    setupMinBrl: 1_500,
    setupMaxBrl: 3_500,
    mrrMinBrl: 497,
    mrrMaxBrl: 997,
  },
  profissional: {
    label: "Profissional",
    descricao: "radares de nicho + conectores reais (WhatsApp/SMS/Instagram/Messenger/Telegram)",
    setupMinBrl: 4_000,
    setupMaxBrl: 9_000,
    mrrMinBrl: 1_497,
    mrrMaxBrl: 2_997,
  },
  enterprise: {
    label: "Enterprise",
    descricao: "multi-workspace, SAC Shield completo, selo de conformidade",
    setupMinBrl: 10_000,
    setupMaxBrl: 30_000,
    mrrMinBrl: 4_997,
    mrrMaxBrl: 4_997,
  },
};

export const OPCOES_PLANO_CONTRATO: Array<{ valor: PlanoContrato; label: string }> = (
  Object.keys(FAIXAS_PRECO_CONTRATO) as PlanoContrato[]
).map((valor) => ({ valor, label: FAIXAS_PRECO_CONTRATO[valor].label }));

export interface ProjecaoRoiContratoInput {
  /** Ganho mensal estimado (receita recuperada), em BRL — vem do simulador de impacto. */
  ganhoMensalBrl: number;
  setupBrl: number;
  mrrBrl: number;
  /** Horizonte da projeção, em meses (padrão: 12). */
  meses: number;
}

export interface ProjecaoRoiContratoResultado {
  custoTotalBrl: number;
  ganhoTotalBrl: number;
  /** Lucro líquido no período (ganho - custo). Pode ser negativo — nunca escondido. */
  lucroLiquidoBrl: number;
  /** ROI percentual no período: (ganho - custo) / custo × 100. `null` quando custo é 0 (ROI indefinido, não "infinito"). */
  roiPercentual: number | null;
  /**
   * Quantos meses até o ganho acumulado superar o custo total já pago até
   * aquele mês (setup + MRR acumulado) — nunca assume que o ganho supera o
   * setup sozinho; `null` quando o ganho mensal é 0 ou negativo (nunca paga).
   */
  paybackMeses: number | null;
}

/**
 * Projeta o retorno financeiro de um contrato real do AgentFlow a partir do
 * ganho estimado pelo Simulador de Impacto — pura e determinística, mesmo
 * padrão de `calcularRoi` em `@/lib/roi` (sem leitura de rede/Firestore).
 */
export function calcularRoiContrato(input: ProjecaoRoiContratoInput): ProjecaoRoiContratoResultado {
  const meses = Math.max(1, Math.round(input.meses));
  const ganhoMensal = Number.isFinite(input.ganhoMensalBrl) ? input.ganhoMensalBrl : 0;
  const setup = Number.isFinite(input.setupBrl) ? Math.max(0, input.setupBrl) : 0;
  const mrr = Number.isFinite(input.mrrBrl) ? Math.max(0, input.mrrBrl) : 0;

  const custoTotalBrl = setup + mrr * meses;
  const ganhoTotalBrl = ganhoMensal * meses;
  const lucroLiquidoBrl = ganhoTotalBrl - custoTotalBrl;
  const roiPercentual = custoTotalBrl > 0 ? (lucroLiquidoBrl / custoTotalBrl) * 100 : null;

  let paybackMeses: number | null = null;
  if (ganhoMensal > 0) {
    for (let mes = 1; mes <= meses; mes += 1) {
      const custoAcumulado = setup + mrr * mes;
      const ganhoAcumulado = ganhoMensal * mes;
      if (ganhoAcumulado >= custoAcumulado) {
        paybackMeses = mes;
        break;
      }
    }
  }

  return { custoTotalBrl, ganhoTotalBrl, lucroLiquidoBrl, roiPercentual, paybackMeses };
}
