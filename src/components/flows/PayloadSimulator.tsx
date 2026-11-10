"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useWorkspace } from "@/lib/workspace";
import { useWorkspaceDoc } from "@/lib/queries/workspace";
import { criarConversa, registrarMensagemCliente } from "@/lib/inbox/firestore";
import { extrairClienteSimulado } from "@/lib/payloadSimulatorInbox";
import { obterExemploFluxo } from "@/lib/flowDemoData";
import { marcarSimuladorTestado } from "@/components/flows/PrimeirosPassosCard";
import { reportarErro } from "@/lib/telemetry/errorReporting";
import type { SimTestResult } from "@/types";

interface PayloadSimulatorProps {
  /** Nome do fluxo selecionado — vira o assunto da conversa de demonstração, só para contexto. */
  flowNome?: string;
}

/**
 * Sandbox local: "Executar teste" NUNCA grava em flowRuns nem chama
 * execução real — só valida o JSON e ecoa um resultado sintético, conforme
 * "Não afeta execuções reais — roda isolado, localmente" (design-system.html).
 *
 * "Enviar como lead de teste" é uma ação SEPARADA e explícita (nunca
 * disparada automaticamente pelo teste acima): cria uma conversa real na
 * Neural Inbox a partir do payload, pelo MESMO pipeline que uma mensagem de
 * cliente de verdade usaria (Shield-Layer, radar de sentimento, roteamento)
 * — mesma honestidade do harness "simular mensagem do cliente" da própria
 * Neural Inbox (`NeuralInbox.tsx`): nunca finge ser um canal real, só
 * rotulado como demonstração.
 */
export function PayloadSimulator({ flowNome }: PayloadSimulatorProps) {
  const { workspaceId } = useWorkspace();
  const { data: workspace } = useWorkspaceDoc(workspaceId);
  const [payload, setPayload] = useState("{\n  \n}");
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [ultimoPayloadValido, setUltimoPayloadValido] = useState<unknown>(null);
  const [history, setHistory] = useState<SimTestResult[]>([]);

  const [enviandoInbox, setEnviandoInbox] = useState(false);
  const [erroInbox, setErroInbox] = useState<string | null>(null);
  const [conversaCriada, setConversaCriada] = useState<{ id: string; nome: string } | null>(null);

  /** Preenchimento Mágico por Nicho (Sandbox): mesma fonte de exemplo do botão em `FlowSettingsForm` — a demo fica coerente em qualquer tela. */
  function handlePreencherExemplo() {
    const exemplo = obterExemploFluxo(workspace?.setor);
    setPayload(JSON.stringify(exemplo.payloadExemplo, null, 2));
    setPayloadError(null);
  }

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
    setConversaCriada(null);
    setErroInbox(null);
    setTimeout(() => {
      const result = { status: "ok", recebido: parsed, executadoEm: new Date().toISOString() };
      const formatted = JSON.stringify(result, null, 2);
      setOutput(formatted);
      setUltimoPayloadValido(parsed);
      setHistory((h) => [
        { id: crypto.randomUUID(), executadoEm: new Date().toISOString(), payload, output: formatted, sucesso: true },
        ...h,
      ]);
      setRunning(false);
    }, 400);
  }

  async function handleEnviarParaInbox() {
    if (!workspaceId) return;
    setEnviandoInbox(true);
    setErroInbox(null);
    try {
      const { nome, texto } = extrairClienteSimulado(ultimoPayloadValido);
      const conversa = await criarConversa({
        canal: "webchat",
        nomeParticipante: nome,
        identificadorParticipante: `sandbox:${Date.now()}`,
        assunto: flowNome ? `Simulação via Fluxos — ${flowNome}` : "Simulação via Fluxos",
        workspaceId,
        origemSandbox: true,
      });
      await registrarMensagemCliente({
        conversationId: conversa.id,
        texto,
        canal: "webchat",
        workspaceId,
      });
      setConversaCriada({ id: conversa.id, nome });
      marcarSimuladorTestado();
    } catch (e) {
      // Nunca expõe o texto técnico do erro (ex.: código do Firestore,
      // "Firestore não configurado...") para o dono do negócio — só o
      // registra para diagnóstico (ver `reportarErro`) e mostra um aviso
      // acionável.
      reportarErro(e, "sandbox:enviar-para-inbox");
      setErroInbox("Não foi possível enviar para a Neural Inbox agora. Tente novamente em alguns segundos.");
    } finally {
      setEnviandoInbox(false);
    }
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-sm font-medium text-ink-700" htmlFor="sim-payload">
            Payload de teste (JSON)
          </label>
          <button
            type="button"
            onClick={handlePreencherExemplo}
            className="flex-none whitespace-nowrap rounded-full border border-signal-500/40 bg-signal-50 px-3 py-1.5 text-xs font-medium text-signal-700 hover:bg-signal-100"
            title="Preenche um payload de exemplo calibrado para o seu nicho ativo."
          >
            Carregar Payload de Exemplo
          </button>
        </div>
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

      {output && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-signal-500/30 bg-signal-50 p-3">
          <p className="text-xs text-ink-700">
            Quer ver isso virando atendimento de verdade? Envie este payload como uma conversa de
            demonstração na Neural Inbox — passa pelo mesmo Shield-Layer e roteamento de uma mensagem real,
            só rotulada como teste.
          </p>
          {!conversaCriada ? (
            <Button type="button" size="sm" variant="secondary" loading={enviandoInbox} onClick={handleEnviarParaInbox}>
              Enviar como lead de teste para a Neural Inbox
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-state-done-bg px-2.5 py-1 text-[11px] font-medium text-state-done">
                conversa criada: {conversaCriada.nome}
              </span>
              <Link
                href={`/inbox?conversa=${conversaCriada.id}`}
                className="text-xs font-medium text-signal-600 hover:underline"
              >
                abrir na Neural Inbox →
              </Link>
            </div>
          )}
          {erroInbox && <p className="text-xs text-state-error">{erroInbox}</p>}
        </div>
      )}

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
