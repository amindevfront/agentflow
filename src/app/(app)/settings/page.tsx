"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getWorkspace, updateWorkspaceName } from "@/lib/firestore";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import { NICHE_PRESETS } from "@/lib/niches";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export default function SettingsPage() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { workspaceId } = useWorkspace();
  const [workspaceName, setWorkspaceName] = useState("");
  const [setorLabel, setSetorLabel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    getWorkspace(workspaceId).then((ws) => {
      setWorkspaceName(ws?.nome ?? "AgentFlow");
      setSetorLabel(ws?.setor ? NICHE_PRESETS[ws.setor].label : null);
    });
  }, [workspaceId]);

  async function handleSaveWorkspace(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateWorkspaceName(workspaceId, workspaceName);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
        <h2 className="text-sm font-semibold text-ink-950">Workspace</h2>
        <form onSubmit={handleSaveWorkspace} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="Nome do workspace" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} />
          </div>
          <Button type="submit" size="sm" loading={saving}>
            Salvar
          </Button>
        </form>
        {saved && <p className="mt-2 text-xs text-state-done">Salvo.</p>}
        {setorLabel && <p className="mono mt-2 text-xs text-ink-400">Setor: {setorLabel}</p>}
      </section>

      <section className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
        <h2 className="text-sm font-semibold text-ink-950">Conta</h2>
        <p className="mt-2 text-sm text-ink-500">{user?.email}</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={handleSignOut}>
          Sair
        </Button>
      </section>

      <section className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-950">Notificações e segurança</h2>
        <EmptyState title="Em breve" description="Preferências de notificação e segurança avançada ainda não foram especificadas no design system — aguardando definição." />
      </section>
    </div>
  );
}
