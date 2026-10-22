"use client";

// Parâmetros econômicos do workspace.
//
// São estes números que transformam contagem de execuções em moeda. Deixá-los
// editáveis (em vez de fixos no código) é o que permite ao cliente auditar o
// cálculo: ele reconhece o próprio custo-hora e confere a conta.

import { useEffect, useState } from "react";
import type { Moeda, RoiConfig } from "@/types";
import {
  PRECOS_REFERENCIA,
  ROI_CONFIG_PADRAO,
  salvarRoiConfig,
  subscribeRoiConfig,
} from "@/lib/roi";
import { registrarEventoAuditoriaSilencioso } from "@/lib/auditLog";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

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
          </select>
          <span className="text-xs text-ink-400">
            O cálculo é sempre em BRL; a conversão ocorre apenas na exibição.
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
