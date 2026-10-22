"use client";

// Disparo de execução REAL de fluxo — distinto do `PayloadSimulator`.
//
// O simulador roda isolado no cliente e nunca toca em `flowRuns` (contrato
// documentado no próprio componente). Este painel é o oposto: ele chama
// `/api/flows/execute`, que passa o payload pelo Motor de Guardrails, chama
// um modelo real da Anthropic, mede tokens e custo reais, e persiste um
// `FlowRun` com `metrica` — o documento que o painel de ROI (assinado via
// `onSnapshot`) exibe como métrica financeira real, não estimada.
//
// Por isso os dois componentes coexistem na mesma tela sem se confundir: um
// é para testar o formato de um payload sem custo nem efeito; o outro
// consome tokens reais e é exatamente o que deveria ser usado com cautela.

import { useState } from "react";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/Button";
import type { RunCostMetrics } from "@/types";

interface RealExecutionPanelProps {
  flowId: string;
  flowNome: string;
}

interface RespostaExecucao {
  runId?: string;
  status?: string;
  bloqueado?: boolean;
  transbordo?: boolean;
  ticketsAbertos?: string[];
  metrica?: RunCostMetrics;
  erro?: { codigo: string; mensagem: string };
}

const PAYLOAD_INICIAL = '{\n  "mensagem": "Novo pedido recebido"\n}';

export function RealExecutionPanel({ flowId, flowNome }: RealExecutionPanelProps) {
  const [payload, setPayload] = useState(PAYLOAD_INICIAL);
  const [executando, setExecutando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<RespostaExecucao | null>(null);

  async function executar() {
    setErro(null);
    setExecutando(true);
    setResultado(null);

    try {
      JSON.parse(payload);
    } catch {
      setErro("JSON inválido — verifique a sintaxe antes de executar.");
      setExecutando(false);
      return;
    }

    try {
      const usuario = auth?.currentUser;
      if (!usuario) throw new Error("Sessão expirada. Entre novamente para executar o fluxo.");

      const resposta = await fetch("/api/flows/execute", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${await usuario.getIdToken()}`,
        },
        body: JSON.stringify({ flowId, payload }),
      });

      const dados = (await resposta.json().catch(() => ({}))) as RespostaExecucao;
      if (!resposta.ok) {
        throw new Error(dados.erro?.mensagem ?? `Falha ao executar o fluxo (HTTP ${resposta.status}).`);
      }
      setResultado(dados);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível executar o fluxo.");
    } finally {
      setExecutando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink-950">Executar fluxo agora</h2>
          <span className="mono rounded-full bg-state-run-bg px-2 py-0.5 text-[11px] font-medium text-state-run">
            ação real
          </span>
        </div>
        <p className="mt-0.5 text-xs text-ink-400">
          Execução real de <span className="font-medium text-ink-700">{flowNome}</span> — consome
          tokens de um modelo real e alimenta o painel de ROI com dados verdadeiros.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-ink-700" htmlFor="real-exec-payload">
          Payload de entrada
        </label>
        <textarea
          id="real-exec-payload"
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          rows={5}
          className="mono rounded-[var(--radius-sm)] border border-ink-100 bg-white p-3 text-xs text-ink-950 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" size="sm" variant="secondary" loading={executando} onClick={executar}>
          Executar agora
        </Button>
        <span className="text-xs text-state-run">Consome tokens reais — diferente do simulador abaixo.</span>
      </div>

      {erro && <p className="text-xs text-state-error">{erro}</p>}

      {resultado && (
        <div className="rounded-[var(--radius-sm)] border border-ink-100 bg-mist-50 p-3 text-xs text-ink-700">
          <p>
            Execução <span className="mono">{resultado.runId}</span> ·{" "}
            <span className="font-medium">{resultado.status}</span>
            {resultado.transbordo && " · aguardando revisão humana"}
            {resultado.bloqueado && " · bloqueada pelo guardrail"}
          </p>
          {resultado.metrica && (
            <p className="mono mt-1 text-ink-500">
              {resultado.metrica.tokensEntrada} tokens de entrada · {resultado.metrica.tokensSaida} de
              saída
              {typeof resultado.metrica.custoModeloUsd === "number"
                ? ` · US$ ${resultado.metrica.custoModeloUsd.toFixed(4)}`
                : ""}
            </p>
          )}
          {resultado.ticketsAbertos && resultado.ticketsAbertos.length > 0 && (
            <p className="mt-1 text-state-run">
              Ticket de transbordo aberto — veja a fila de governança para decidir.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
