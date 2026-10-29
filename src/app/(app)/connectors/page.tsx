"use client";

import { useEffect, useState, type FormEvent } from "react";
import { subscribeConnectors, createConnector } from "@/lib/firestore";
import { useWorkspace } from "@/lib/workspace";
import { connectorSchema, primeiraMensagemZod } from "@/lib/validation/schemas";
import { gerarWidgetEmbedSnippet } from "@/lib/inbox/channelAdapters";
import { Pill } from "@/components/ui/Pill";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import type { Connector } from "@/types";

// Canais Globais (EUA/UK/Europa): os dois últimos tipos, além dos quatro já
// existentes, são os novos adaptadores de mensageria — ver
// `@/lib/inbox/channelAdapters`.
const CONNECTOR_TYPES = [
  "Webhook",
  "E-mail",
  "Armazenamento",
  "API externa",
  "SMS / Twilio Gateway",
  "Web Widget Corporativo (Embed)",
];

const TIPO_WIDGET = "Web Widget Corporativo (Embed)";

export default function ConnectorsPage() {
  const { workspaceId } = useWorkspace();
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState(CONNECTOR_TYPES[0]);
  const [saving, setSaving] = useState(false);
  const [nomeError, setNomeError] = useState<string | null>(null);
  const [snippetExpandidoId, setSnippetExpandidoId] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeConnectors(workspaceId, setConnectors);
  }, [workspaceId]);

  async function copiarSnippet(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Clipboard pode estar indisponível (permissão negada, contexto não seguro) —
      // o snippet continua selecionável/copiável manualmente no <pre>.
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;

    const validado = connectorSchema.safeParse({ nome, tipo });
    if (!validado.success) {
      setNomeError(primeiraMensagemZod(validado.error));
      return;
    }

    setNomeError(null);
    setSaving(true);
    try {
      await createConnector(workspaceId, { ...validado.data, status: "nao-configurado" });
      setNome("");
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-ink-950">Canais &amp; Integrações (WhatsApp/APIs)</p>
          <p className="mono text-xs text-ink-400">
            {connectors.length} conector{connectors.length === 1 ? "" : "es"}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          Novo conector
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field
              label="Nome do conector"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              errorText={nomeError ?? undefined}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-ink-700" htmlFor="connector-tipo">
              Tipo
            </label>
            <select
              id="connector-tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="h-10 rounded-[var(--radius-sm)] border border-ink-100 bg-white px-3 text-sm outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
            >
              {CONNECTOR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" loading={saving} size="sm">
            Adicionar
          </Button>
        </form>
      )}

      {showForm && tipo === TIPO_WIDGET && workspaceId && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-ink-100 bg-mist-50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-ink-700">
              Snippet de embed — cole no <span className="mono">&lt;head&gt;</span> do seu site
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                copiarSnippet(gerarWidgetEmbedSnippet({ workspaceId, baseUrl: window.location.origin }))
              }
            >
              {copiado ? "Copiado!" : "Copiar"}
            </Button>
          </div>
          <pre className="mono overflow-x-auto rounded-[var(--radius-sm)] border border-ink-100 bg-white p-2.5 text-[11px] text-ink-700">
            {gerarWidgetEmbedSnippet({ workspaceId, baseUrl: window.location.origin })}
          </pre>
          <p className="text-[11px] text-ink-400">
            Já funciona de ponta a ponta: mensagens enviadas pelo widget chegam na Neural Inbox passando pelo mesmo
            Shield-Layer, Radar de Sentimento e Circuit Breaker dos demais canais. Ainda não há exibição de resposta
            do atendente em tempo real dentro do próprio widget — essa resposta chega por fora, hoje.
          </p>
        </div>
      )}

      {connectors.length === 0 ? (
        <EmptyState
          title="Nenhum conector configurado"
          description="Conecte webhooks, e-mail ou APIs externas para acionar seus fluxos."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {connectors.map((c) => (
            <div key={c.id} className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
              <div className="flex items-center gap-3">
                <Avatar name={c.nome} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-950">{c.nome}</p>
                  <p className="truncate text-xs text-ink-500">{c.tipo}</p>
                </div>
                <Pill status={c.status} />
              </div>
              {c.tipo === TIPO_WIDGET && workspaceId && (
                <>
                  <button
                    type="button"
                    onClick={() => setSnippetExpandidoId((atual) => (atual === c.id ? null : c.id))}
                    className="self-start text-[11px] font-medium text-signal-600 hover:text-signal-700"
                  >
                    {snippetExpandidoId === c.id ? "ocultar snippet" : "ver snippet de embed"}
                  </button>
                  {snippetExpandidoId === c.id && (
                    <pre className="mono overflow-x-auto rounded-[var(--radius-sm)] border border-ink-100 bg-mist-50 p-2.5 text-[10px] text-ink-700">
                      {gerarWidgetEmbedSnippet({ workspaceId, baseUrl: window.location.origin })}
                    </pre>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
