"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import type { SimTestResult } from "@/types";

/**
 * Sandbox local: NUNCA grava em flowRuns nem chama execução real.
 * Apenas valida o JSON e ecoa um resultado sintético, conforme
 * "Não afeta execuções reais — roda isolado, localmente" (design-system.html).
 */
export function PayloadSimulator() {
  const [payload, setPayload] = useState("{\n  \n}");
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [history, setHistory] = useState<SimTestResult[]>([]);

  function handleRun() {
    setPayloadError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      setPayloadError("JSON inválido — verifique a sintaxe antes de executar.");
      return;
    }

    setRunning(true);
    setTimeout(() => {
      const result = { status: "ok", recebido: parsed, executadoEm: new Date().toISOString() };
      const formatted = JSON.stringify(result, null, 2);
      setOutput(formatted);
      setHistory((h) => [
        { id: crypto.randomUUID(), executadoEm: new Date().toISOString(), payload, output: formatted, sucesso: true },
        ...h,
      ]);
      setRunning(false);
    }, 400);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-ink-950">Simulador de payload</h2>
        <p className="mt-0.5 text-xs text-ink-400">
          Teste um fluxo com dados fictícios antes de colocá-lo em produção.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-ink-700" htmlFor="sim-payload">
          Payload de teste (JSON)
        </label>
        <textarea
          id="sim-payload"
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          rows={6}
          className="mono rounded-[var(--radius-sm)] border border-ink-100 bg-white p-3 text-xs text-ink-950 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
        />
        {payloadError && <span className="text-xs text-state-error">{payloadError}</span>}
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" size="sm" loading={running} onClick={handleRun}>
          Executar teste
        </Button>
        <span className="text-xs text-ink-400">Não afeta execuções reais — roda isolado, localmente.</span>
      </div>

      <div>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
          Execução simulada
        </h3>
        {output ? (
          <pre className="mono max-h-48 overflow-auto rounded-[var(--radius-sm)] bg-ink-950 p-3 text-xs text-mist-50">
            {output}
          </pre>
        ) : (
          <p className="text-xs text-ink-400">Execute um teste para ver o resultado aqui.</p>
        )}
      </div>

      <div>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
          Histórico de testes
        </h3>
        {history.length === 0 ? (
          <EmptyState title="Nenhum teste executado nesta sessão ainda." />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {history.map((item) => (
              <li key={item.id} className="mono rounded-[var(--radius-sm)] border border-ink-100 px-3 py-2 text-xs text-ink-500">
                {new Date(item.executadoEm).toLocaleTimeString("pt-BR")} · sucesso
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
