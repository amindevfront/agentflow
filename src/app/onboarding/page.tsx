"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getAppUser, persistWorkspace, prepareWorkspace, upsertAppUser } from "@/lib/firestore";
import { NICHE_ORDER, NICHE_PRESETS } from "@/lib/niches";
import { withTimeout, retryWithTimeout } from "@/lib/promiseUtils";
import { savePendingProfile, clearPendingProfile } from "@/lib/pendingWorkspace";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import type { AppUser, NicheKey } from "@/types";

type Step = "checking" | "checkFailed" | "workspace" | "niche" | "saving";

const READ_TIMEOUT_MS = 3000;
const WRITE_TIMEOUT_MS = 3000;
const WRITE_MAX_ATTEMPTS = 3;
const WRITE_BASE_DELAY_MS = 800;

/**
 * Triagem de nicho do onboarding (ver docs/architecture/adr-0002 e
 * ADR-0003). Só é alcançada por usuários autenticados sem documento em
 * `users/{uid}` — quem aceita um convite nunca passa por aqui (ver
 * `WorkspaceProvider`).
 *
 * Resiliência: a leitura inicial (`getAppUser`) e a gravação final
 * (`persistWorkspace` + `upsertAppUser`) nunca travam a tela indefinidamente.
 * Ambas têm timeout + (a gravação) retry com backoff; se mesmo assim
 * falharem, o fluxo degrada para um perfil otimista local em vez de prender
 * o usuário em "Preparando sua conta…" — ver `src/lib/pendingWorkspace.ts`.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [step, setStep] = useState<Step>("checking");
  const [nomeWorkspace, setNomeWorkspace] = useState("");
  const [setor, setSetor] = useState<NicheKey | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [checkAttempt, setCheckAttempt] = useState(0);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    setStep("checking");

    withTimeout(getAppUser(user.uid), READ_TIMEOUT_MS)
      .then((found) => {
        if (cancelled) return;
        if (found) {
          router.replace("/flows");
          return;
        }
        setStep("workspace");
      })
      .catch(() => {
        // Sem `.catch()` aqui, qualquer timeout/erro de rede deixava a tela
        // presa em "Preparando sua conta…" para sempre — esse era o bug
        // relatado. Agora: se não conseguimos confirmar se o perfil já
        // existe, deixamos o usuário decidir (tentar de novo ou seguir
        // mesmo assim), nunca escondemos o problema atrás de um spinner.
        if (!cancelled) setStep("checkFailed");
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, router, checkAttempt]);

  function handleWorkspaceSubmit(e: FormEvent) {
    e.preventDefault();
    if (!nomeWorkspace.trim()) return;
    setStep("niche");
  }

  async function handleNicheSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user || !setor) return;
    setSyncWarning(null);
    setStep("saving");

    const { ref, workspace } = prepareWorkspace(nomeWorkspace.trim(), setor);
    const appUser: AppUser = {
      uid: user.uid,
      nome: user.displayName ?? user.email?.split("@")[0] ?? "Usuário",
      email: user.email ?? "",
      avatarUrl: user.photoURL ?? null,
      papel: "admin",
      workspaceId: workspace.id,
    };

    // workspaceId já é definitivo neste ponto (gerado no cliente por
    // `prepareWorkspace`, sem round-trip) — por isso é seguro navegar de
    // forma otimista adiante mesmo que a confirmação no Firestore demore.
    //
    // Ordem importa para retry ser seguro: `upsertAppUser` grava o PRÓPRIO
    // doc (`users/{uid}`), sempre permitido por `firestore.rules`
    // independente de já existir — idempotente em qualquer tentativa.
    // Depois disso, `isAdminOf(workspaceId)` passa a ser verdadeiro, o que
    // torna a gravação do workspace igualmente segura de repetir mesmo se
    // uma tentativa anterior tiver succeeded no servidor sem confirmar a
    // tempo para o cliente (ver ADR-0003 — evita exigir uma regra de
    // `firestore.rules` mais permissiva, que abriria brecha de um usuário
    // sem perfil sobrescrever o workspace de outro tenant).
    const result = await retryWithTimeout(
      async () => {
        await upsertAppUser(appUser);
        await persistWorkspace(ref, workspace);
      },
      { maxAttempts: WRITE_MAX_ATTEMPTS, timeoutMs: WRITE_TIMEOUT_MS, baseDelayMs: WRITE_BASE_DELAY_MS }
    );

    if (result.ok) {
      clearPendingProfile(user.uid);
      router.push("/flows");
      return;
    }

    // As tentativas em primeiro plano se esgotaram — nunca travamos o
    // usuário aqui. Guardamos o perfil otimista (consultado por
    // `WorkspaceProvider`) e seguimos para o app; a sincronização real
    // continua tentando em segundo plano.
    savePendingProfile(user.uid, { appUser, workspace });
    setSyncWarning(
      "Não foi possível confirmar a criação do workspace no servidor agora — você já pode continuar, e tentaremos sincronizar sozinhos."
    );
    void backgroundSync(user.uid, ref, workspace, appUser);
    router.push("/flows");
  }

  if (step === "checking") {
    return <p className="text-center text-sm text-ink-400">Preparando sua conta…</p>;
  }

  if (step === "checkFailed") {
    return (
      <EmptyState
        title="Não foi possível verificar sua conta"
        description="A conexão com o servidor demorou demais ou falhou. Tente novamente, continue mesmo assim para configurar seu workspace, ou volte para o login."
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setCheckAttempt((n) => n + 1)}>
              Tentar novamente
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setStep("workspace")}>
              Continuar mesmo assim
            </Button>
            <Button size="sm" variant="secondary" onClick={() => router.push("/login")}>
              Ir para o Login
            </Button>
          </div>
        }
      />
    );
  }

  if (step === "workspace") {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <p className="mono text-xs font-semibold uppercase tracking-wide text-signal-600">Passo 1 de 2</p>
          <h1 className="mt-1 text-lg font-semibold text-ink-950">Como se chama seu workspace?</h1>
          <p className="mt-1 text-sm text-ink-500">Normalmente o nome da sua empresa ou operação.</p>
        </div>
        <form onSubmit={handleWorkspaceSubmit} className="flex flex-col gap-4">
          <Field
            label="Nome do workspace"
            autoFocus
            required
            value={nomeWorkspace}
            onChange={(e) => setNomeWorkspace(e.target.value)}
            placeholder="Ex.: Construtora Horizonte"
          />
          <Button type="submit" className="w-full">
            Continuar
          </Button>
        </form>
      </div>
    );
  }

  const saving = step === "saving";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="mono text-xs font-semibold uppercase tracking-wide text-signal-600">Passo 2 de 2</p>
        <h1 className="mt-1 text-lg font-semibold text-ink-950">Qual é o seu setor primário?</h1>
        <p className="mt-1 text-sm text-ink-500">
          Usamos isso para sugerir os playbooks de IA certos para a sua operação.
        </p>
      </div>

      <form onSubmit={handleNicheSubmit} className="flex flex-col gap-4">
        <div role="radiogroup" aria-label="Setor primário" className="grid gap-2 sm:grid-cols-2">
          {NICHE_ORDER.map((key) => {
            const preset = NICHE_PRESETS[key];
            const selected = setor === key;
            return (
              <label
                key={key}
                className={cn(
                  "flex cursor-pointer flex-col gap-1 rounded-[var(--radius-md)] border p-3 text-left transition-colors",
                  selected ? "border-signal-600 bg-signal-50" : "border-ink-100 hover:bg-mist-50"
                )}
              >
                <input
                  type="radio"
                  name="setor"
                  value={key}
                  checked={selected}
                  onChange={() => setSetor(key)}
                  className="sr-only"
                />
                <span className="text-sm font-semibold text-ink-950">{preset.label}</span>
                <span className="text-xs text-ink-500">{preset.descricao}</span>
              </label>
            );
          })}
        </div>

        {syncWarning && <p className="text-xs text-state-run-ink">{syncWarning}</p>}

        <Button type="submit" loading={saving} disabled={!setor} className="w-full">
          Criar workspace
        </Button>
        <Button type="button" variant="secondary" disabled={saving} onClick={() => setStep("workspace")} className="w-full">
          Voltar
        </Button>
      </form>
    </div>
  );
}

/**
 * Última linha de defesa: continua tentando confirmar a escrita no Firestore
 * mesmo depois do usuário já ter navegado para `/flows` com o perfil
 * otimista. Roda "solto" (não ligado ao ciclo de vida do componente, que já
 * desmontou) — Promises não são canceladas pela navegação do Next.js.
 */
async function backgroundSync(
  uid: string,
  ref: ReturnType<typeof prepareWorkspace>["ref"],
  workspace: ReturnType<typeof prepareWorkspace>["workspace"],
  appUser: AppUser
): Promise<void> {
  // Mesma ordem (perfil antes do workspace) e mesmo motivo de
  // `handleNicheSubmit`: torna o retry seguro sob `firestore.rules` sem
  // precisar afrouxá-las (ver comentário lá).
  const result = await retryWithTimeout(
    async () => {
      await upsertAppUser(appUser);
      await persistWorkspace(ref, workspace);
    },
    { maxAttempts: 4, timeoutMs: 5000, baseDelayMs: 2000 }
  );
  if (result.ok) {
    clearPendingProfile(uid);
  } else {
    console.error(
      "[onboarding] sincronização em segundo plano esgotou as tentativas — perfil continua apenas local:",
      result.error
    );
  }
}
