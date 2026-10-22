"use client";

import { useEffect, useState, type FormEvent } from "react";
import { subscribeConnectors, createConnector } from "@/lib/firestore";
import { Pill } from "@/components/ui/Pill";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import type { Connector } from "@/types";

const CONNECTOR_TYPES = ["Webhook", "E-mail", "Armazenamento", "API externa"];

export default function ConnectorsPage() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState(CONNECTOR_TYPES[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => subscribeConnectors(setConnectors), []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createConnector({ nome, tipo, status: "nao-configurado" });
      setNome("");
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="mono text-xs text-ink-400">
          {connectors.length} conector{connectors.length === 1 ? "" : "es"}
        </p>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          Novo conector
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="Nome do conector" value={nome} onChange={(e) => setNome(e.target.value)} required />
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

      {connectors.length === 0 ? (
        <EmptyState
          title="Nenhum conector configurado"
          description="Conecte webhooks, e-mail ou APIs externas para acionar seus fluxos."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {connectors.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
              <Avatar name={c.nome} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-950">{c.nome}</p>
                <p className="truncate text-xs text-ink-500">{c.tipo}</p>
              </div>
              <Pill status={c.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
