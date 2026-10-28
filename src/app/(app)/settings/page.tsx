"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { updateWorkspaceName } from "@/lib/firestore";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import { useInvalidarWorkspace, useWorkspaceDoc } from "@/lib/queries/workspace";
import { NICHE_PRESETS } from "@/lib/niches";
import { PAIN_POINT_PRESETS, REGIAO_PRESETS } from "@/lib/onboardingQuiz";
import { lerRoiConfig } from "@/lib/roi";
import { useAbrirQuizOnboarding } from "@/components/onboarding/DynamicNicheQuizModal";
import { workspaceNameSchema } from "@/lib/validation/schemas";
import type { Moeda, RegimeEncargos } from "@/types";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

const ROTULO_MOEDA: Record<Moeda, string> = { BRL: "Real (R$)", USD: "Dólar (US$)", GBP: "Libra (£)" };
const ROTULO_REGIME: Record<RegimeEncargos, string> = {
  "clt-br": "CLT (Brasil)",
  "payroll-us-uk": "Payroll Tax (EUA/UK)",
};

export default function SettingsPage() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { appUser, workspaceId } = useWorkspace();
  // Cacheado (ver `src/lib/queries/workspace.ts`) — a mesma leitura que
  // `/flows` já pede; sem cache compartilhado, trocar entre as duas telas
  // pagava uma leitura nova a cada troca.
  const { data: workspace } = useWorkspaceDoc(workspaceId);
  const invalidarWorkspace = useInvalidarWorkspace();
  const abrirQuizOnboarding = useAbrirQuizOnboarding();
  const [workspaceName, setWorkspaceName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [moedaAtual, setMoedaAtual] = useState<Moeda | null>(null);
  const [regimeAtual, setRegimeAtual] = useState<RegimeEncargos | null>(null);

  useEffect(() => {
    if (workspace) setWorkspaceName(workspace.nome);
  }, [workspace]);

  // Dual-Layer Workspace View: a seção abaixo é administrativa (moeda/regime
  // de encargos afetam todo o painel financeiro) — só carregada para admin.
  useEffect(() => {
    if (!workspaceId || appUser?.papel !== "admin") return;
    let cancelado = false;
    lerRoiConfig(workspaceId).then((config) => {
      if (cancelado) return;
      setMoedaAtual(config.moedaExibicao);
      setRegimeAtual(config.regimeEncargos);
    });
    return () => {
      cancelado = true;
    };
  }, [workspaceId, appUser?.papel]);

  const setorLabel = workspace?.setor ? NICHE_PRESETS[workspace.setor].label : null;
  const regiaoLabel = workspace?.regiaoOperacao ? REGIAO_PRESETS[workspace.regiaoOperacao].label : null;
  const ralogDeCaixaLabel = workspace?.ralogDeCaixa ? PAIN_POINT_PRESETS[workspace.ralogDeCaixa].label : null;

  async function handleSaveWorkspace(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    const validado = workspaceNameSchema.safeParse(workspaceName);
    if (!validado.success) {
      setNameError(validado.error.issues[0]?.message ?? "Nome inválido.");
      return;
    }
    setNameError(null);
    setSaving(true);
    setSaved(false);
    try {
      await updateWorkspaceName(workspaceId, validado.data);
      invalidarWorkspace(workspaceId);
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
            <Field
              label="Nome do workspace"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              errorText={nameError ?? undefined}
            />
          </div>
          <Button type="submit" size="sm" loading={saving}>
            Salvar
          </Button>
        </form>
        {saved && <p className="mt-2 text-xs text-state-done">Salvo.</p>}
        {setorLabel && <p className="mono mt-2 text-xs text-ink-400">Setor: {setorLabel}</p>}
      </section>

      {appUser?.papel === "admin" && (
        <section className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
          <h2 className="text-sm font-semibold text-ink-950">Região &amp; Moeda</h2>
          <p className="mt-1 text-xs text-ink-500">
            Definidos no Onboarding Cognitivo. O seletor completo (moeda, regime de encargos CLT/Payroll) vive em{" "}
            <span className="font-medium text-ink-700">Governança → Parâmetros</span> — qualquer troca lá se
            reflete aqui e na Neural Inbox em tempo real, sem perder histórico.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-ink-500 sm:grid-cols-4">
            <dt>Região</dt>
            <dd className="mono text-ink-900">{regiaoLabel ?? "—"}</dd>
            <dt>Ralo de caixa</dt>
            <dd className="mono text-ink-900">{ralogDeCaixaLabel ?? "—"}</dd>
            <dt>Moeda</dt>
            <dd className="mono text-ink-900">{moedaAtual ? ROTULO_MOEDA[moedaAtual] : "—"}</dd>
            <dt>Regime de encargos</dt>
            <dd className="mono text-ink-900">{regimeAtual ? ROTULO_REGIME[regimeAtual] : "—"}</dd>
          </dl>
          <Button variant="secondary" size="sm" className="mt-3" onClick={abrirQuizOnboarding}>
            Refazer o quiz de onboarding
          </Button>
        </section>
      )}

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
