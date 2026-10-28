"use client";

// Parâmetros econômicos do workspace.
//
// São estes números que transformam contagem de execuções em moeda. Deixá-los
// editáveis (em vez de fixos no código) é o que permite ao cliente auditar o
// cálculo: ele reconhece o próprio custo-hora e confere a conta.

import { useEffect, useState } from "react";
import type { ComposicaoCustoClt, ComposicaoCustoPayroll, Moeda, RegimeEncargos, RoiConfig } from "@/types";
import {
  PRECOS_REFERENCIA,
  ROI_CONFIG_PADRAO,
  salvarRoiConfig,
  subscribeRoiConfig,
} from "@/lib/roi";
import { registrarEventoAuditoriaSilencioso } from "@/lib/auditLog";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { SegmentedFilter } from "@/components/ui/SegmentedFilter";

const OPCOES_REGIME: Array<{ valor: RegimeEncargos; label: string }> = [
  { valor: "clt-br", label: "CLT (Brasil)" },
  { valor: "payroll-us-uk", label: "Payroll Tax (EUA/UK)" },
];

const MODELOS = Object.keys(PRECOS_REFERENCIA);

export function RoiConfigPanel() {
  const [config, setConfig] = useState<RoiConfig>(ROI_CONFIG_PADRAO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  useEffect(() => {
    return subscribeRoiConfig(setConfig);
  }, []);

  function atualizarNumero(campo: keyof RoiConfig, bruto: string) {
    const valor = Number(bruto.replace(",", "."));
    setSalvo(false);
    setConfig((atual) => ({ ...atual, [campo]: Number.isFinite(valor) ? valor : 0 }));
  }

  /** Campos de `composicaoClt` são editados em pontos percentuais (ex.: "20"), não em fração (0,2). */
  function atualizarPercentualClt(campo: keyof ComposicaoCustoClt, bruto: string) {
    const percentual = Number(bruto.replace(",", ".")) / 100;
    setSalvo(false);
    setConfig((atual) => ({
      ...atual,
      composicaoClt: { ...atual.composicaoClt, [campo]: Number.isFinite(percentual) ? percentual : 0 },
    }));
  }

  /** Mesma conversão de `atualizarPercentualClt`, para a decomposição Payroll EUA/Reino Unido. */
  function atualizarPercentualPayroll(campo: keyof ComposicaoCustoPayroll, bruto: string) {
    const percentual = Number(bruto.replace(",", ".")) / 100;
    setSalvo(false);
    setConfig((atual) => ({
      ...atual,
      composicaoPayroll: { ...atual.composicaoPayroll, [campo]: Number.isFinite(percentual) ? percentual : 0 },
    }));
  }

  /**
   * Converte fração (0..1) em ponto percentual para exibição no `<input>`.
   * Evita `.toFixed(1)` deliberadamente: forçar uma casa decimal a cada
   * keystroke (ex.: "2" virar "2.0") reformata o valor controlado a cada
   * tecla e trava a digitação. `Math.round(.. * 1000) / 10` ainda absorve o
   * ruído de ponto flutuante (0.2 * 100 != 20 exato em alguns casos), mas só
   * imprime decimais que de fato existem — mesmo comportamento de `String()`
   * já usado nos demais campos deste painel.
   */
  function percentualParaCampo(fracao: number): string {
    return String(Math.round(fracao * 1000) / 10);
  }

  const somaEncargosClt =
    config.composicaoClt.percentualInssPatronal +
    config.composicaoClt.percentualFgts +
    config.composicaoClt.percentualDecimoTerceiro +
    config.composicaoClt.percentualFerias +
    config.composicaoClt.percentualProvisaoRescisao;
  const percentualSalarioBase = Math.max(0, 1 - somaEncargosClt);

  const somaEncargosPayroll =
    config.composicaoPayroll.percentualFicaPatronal +
    config.composicaoPayroll.percentualFutaSuta +
    config.composicaoPayroll.percentualWorkersComp +
    config.composicaoPayroll.percentualBeneficios +
    config.composicaoPayroll.percentualBpoOverhead;
  const percentualSalarioBasePayroll = Math.max(0, 1 - somaEncargosPayroll);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    setSalvo(false);
    try {
      const normalizada = await salvarRoiConfig(config);
      setConfig(normalizada);
      setSalvo(true);
      await registrarEventoAuditoriaSilencioso({
        tipo: "config.alterada",
        recurso: "workspaces/roiConfig",
        detalhes: {
          custoHoraOperadorBrl: normalizada.custoHoraOperadorBrl,
          minutosManuaisPorExecucao: normalizada.minutosManuaisPorExecucao,
          cambioUsdBrl: normalizada.cambioUsdBrl,
          modelo: normalizada.precoModeloPadrao.modelo,
        },
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar os parâmetros.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-ink-950">Parâmetros de ROI</h3>
        <p className="mt-0.5 text-xs text-ink-400">
          Base de cálculo do painel financeiro. Valores fora de faixa são normalizados ao salvar.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Custo-hora do operador (R$)"
          type="number"
          min={0}
          step="0.01"
          value={String(config.custoHoraOperadorBrl)}
          onChange={(e) => atualizarNumero("custoHoraOperadorBrl", e.target.value)}
          helpText="Salário + encargos + benefícios + overhead."
        />
        <Field
          label="Minutos manuais por execução"
          type="number"
          min={0}
          step="1"
          value={String(config.minutosManuaisPorExecucao)}
          onChange={(e) => atualizarNumero("minutosManuaisPorExecucao", e.target.value)}
          helpText="Tempo que um humano gastaria para fazer o mesmo trabalho."
        />
        <Field
          label="Minutos por revisão de transbordo"
          type="number"
          min={0}
          step="1"
          value={String(config.minutosRevisaoHumana)}
          onChange={(e) => atualizarNumero("minutosRevisaoHumana", e.target.value)}
          helpText="Usado quando o ticket não registra o tempo real de atendimento."
        />
        <Field
          label="Câmbio USD → BRL"
          type="number"
          min={0}
          step="0.01"
          value={String(config.cambioUsdBrl)}
          onChange={(e) => atualizarNumero("cambioUsdBrl", e.target.value)}
          helpText="Aplicado ao custo de tokens, cotado em dólar."
        />
        <Field
          label="Câmbio GBP → BRL"
          type="number"
          min={0}
          step="0.01"
          value={String(config.cambioGbpBrl)}
          onChange={(e) => atualizarNumero("cambioGbpBrl", e.target.value)}
          helpText="Aplicado quando a moeda de exibição é libra (£)."
        />
        <Field
          label="Custo mensal da plataforma (R$)"
          type="number"
          min={0}
          step="0.01"
          value={String(config.custoPlataformaMensalBrl)}
          onChange={(e) => atualizarNumero("custoPlataformaMensalBrl", e.target.value)}
          helpText="Rateado por dia no período apurado. Zero para ignorar."
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="roi-moeda" className="text-sm font-medium text-ink-700">
            Moeda de exibição
          </label>
          <select
            id="roi-moeda"
            value={config.moedaExibicao}
            onChange={(e) => {
              setSalvo(false);
              setConfig((atual) => ({ ...atual, moedaExibicao: e.target.value as Moeda }));
            }}
            className="h-10 rounded-[var(--radius-sm)] border border-ink-100 bg-white px-3 text-sm text-ink-950 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
          >
            <option value="BRL">Real (R$)</option>
            <option value="USD">Dólar (US$)</option>
            <option value="GBP">Libra (£)</option>
          </select>
          <span className="text-xs text-ink-400">
            O cálculo é sempre em BRL; a conversão ocorre apenas na exibição. Este é o seletor regional/moeda único
            — Governança e Configurações refletem o mesmo valor em tempo real, sem recalcular nem perder histórico.
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-700">Regime de encargos (Tax Shield)</span>
          <SegmentedFilter
            rotuloGrupo="Regime de encargos"
            opcoes={OPCOES_REGIME}
            selecionado={config.regimeEncargos}
            onChange={(valor) => {
              setSalvo(false);
              setConfig((atual) => ({ ...atual, regimeEncargos: valor }));
            }}
          />
          <span className="text-xs text-ink-400">
            Define qual decomposição aparece por padrão no painel OpEx &amp; Tax Shield — as duas são sempre
            calculadas, então trocar aqui não descarta nada.
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="roi-modelo" className="text-sm font-medium text-ink-700">
            Modelo padrão para estimativa
          </label>
          <select
            id="roi-modelo"
            value={config.precoModeloPadrao.modelo}
            onChange={(e) => {
              const escolhido = PRECOS_REFERENCIA[e.target.value];
              if (!escolhido) return;
              setSalvo(false);
              setConfig((atual) => ({ ...atual, precoModeloPadrao: escolhido }));
            }}
            className="h-10 rounded-[var(--radius-sm)] border border-ink-100 bg-white px-3 text-sm text-ink-950 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
          >
            {MODELOS.map((modelo) => (
              <option key={modelo} value={modelo}>
                {modelo}
              </option>
            ))}
          </select>
          <span className="mono text-xs text-ink-400">
            US$ {config.precoModeloPadrao.entradaUsdPorMilhao}/MTok entrada · US${" "}
            {config.precoModeloPadrao.saidaUsdPorMilhao}/MTok saída
          </span>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-ink-950">Composição do encargo CLT (Tax Shield)</h4>
        <p className="mt-0.5 text-xs text-ink-400">
          Decompõe o custo-hora acima em salário base + encargos patronais, usado pelo painel OpEx &amp; Tax Shield.
          Estimativa do regime geral — ajuste ao regime tributário real (ex.: Simples Nacional).
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field
          label="INSS patronal (%)"
          type="number"
          min={0}
          max={100}
          step="0.1"
          value={percentualParaCampo(config.composicaoClt.percentualInssPatronal)}
          onChange={(e) => atualizarPercentualClt("percentualInssPatronal", e.target.value)}
        />
        <Field
          label="FGTS (%)"
          type="number"
          min={0}
          max={100}
          step="0.1"
          value={percentualParaCampo(config.composicaoClt.percentualFgts)}
          onChange={(e) => atualizarPercentualClt("percentualFgts", e.target.value)}
        />
        <Field
          label="13º salário (%)"
          type="number"
          min={0}
          max={100}
          step="0.1"
          value={percentualParaCampo(config.composicaoClt.percentualDecimoTerceiro)}
          onChange={(e) => atualizarPercentualClt("percentualDecimoTerceiro", e.target.value)}
        />
        <Field
          label="Férias + 1/3 (%)"
          type="number"
          min={0}
          max={100}
          step="0.1"
          value={percentualParaCampo(config.composicaoClt.percentualFerias)}
          onChange={(e) => atualizarPercentualClt("percentualFerias", e.target.value)}
        />
        <Field
          label="Provisão de rescisão (%)"
          type="number"
          min={0}
          max={100}
          step="0.1"
          value={percentualParaCampo(config.composicaoClt.percentualProvisaoRescisao)}
          onChange={(e) => atualizarPercentualClt("percentualProvisaoRescisao", e.target.value)}
        />
      </div>
      <p className="mono text-xs text-ink-400">
        Salário base residual: {(percentualSalarioBase * 100).toFixed(1)}% do custo-hora. Se a soma dos encargos
        exceder 95%, os valores são normalizados proporcionalmente ao salvar.
      </p>

      <div>
        <h4 className="text-sm font-semibold text-ink-950">Composição Payroll Tax (EUA/Reino Unido)</h4>
        <p className="mt-0.5 text-xs text-ink-400">
          Equivalente à composição CLT acima, para operações fora do Brasil (empregado W2 ou call center
          terceirizado). FICA patronal tem base legal fixa nos EUA; os demais são médias de mercado — ajuste ao seu
          arranjo real.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field
          label="FICA patronal (%)"
          type="number"
          min={0}
          max={100}
          step="0.1"
          value={percentualParaCampo(config.composicaoPayroll.percentualFicaPatronal)}
          onChange={(e) => atualizarPercentualPayroll("percentualFicaPatronal", e.target.value)}
          helpText="Social Security 6,2% + Medicare 1,45%."
        />
        <Field
          label="FUTA/SUTA (%)"
          type="number"
          min={0}
          max={100}
          step="0.1"
          value={percentualParaCampo(config.composicaoPayroll.percentualFutaSuta)}
          onChange={(e) => atualizarPercentualPayroll("percentualFutaSuta", e.target.value)}
          helpText="Seguro-desemprego federal + estadual."
        />
        <Field
          label="Workers' comp (%)"
          type="number"
          min={0}
          max={100}
          step="0.1"
          value={percentualParaCampo(config.composicaoPayroll.percentualWorkersComp)}
          onChange={(e) => atualizarPercentualPayroll("percentualWorkersComp", e.target.value)}
        />
        <Field
          label="Benefícios (%)"
          type="number"
          min={0}
          max={100}
          step="0.1"
          value={percentualParaCampo(config.composicaoPayroll.percentualBeneficios)}
          onChange={(e) => atualizarPercentualPayroll("percentualBeneficios", e.target.value)}
          helpText="Saúde, dental, aposentadoria."
        />
        <Field
          label="Overhead de BPO (%)"
          type="number"
          min={0}
          max={100}
          step="0.1"
          value={percentualParaCampo(config.composicaoPayroll.percentualBpoOverhead)}
          onChange={(e) => atualizarPercentualPayroll("percentualBpoOverhead", e.target.value)}
          helpText="Call center terceirizado, se aplicável."
        />
      </div>
      <p className="mono text-xs text-ink-400">
        Salário base residual: {(percentualSalarioBasePayroll * 100).toFixed(1)}% do custo-hora.
      </p>

      <div className="flex items-center gap-3">
        <Button size="sm" loading={salvando} onClick={salvar}>
          Salvar parâmetros
        </Button>
        {salvo && <span className="text-xs text-state-done">Salvo.</span>}
        {erro && <span className="text-xs text-state-error">{erro}</span>}
      </div>

      <p className="text-xs text-ink-400">
        Execuções que reportam custo real do provedor sempre têm precedência sobre a estimativa
        baseada na tabela de preços acima.
      </p>
    </section>
  );
}
