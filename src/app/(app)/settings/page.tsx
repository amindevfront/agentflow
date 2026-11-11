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
import { obterModulo } from "@/modules/registry";
import { patchWorkspace } from "@/lib/firestore";
import { reportarErro } from "@/lib/telemetry/errorReporting";
import { auth } from "@/lib/firebase";
import { fetchComTimeout } from "@/lib/fetchComTimeout";
import type { Moeda, NicheKey, RegimeEncargos } from "@/types";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";

/** Ação rara e cara (lotes de exclusão no Firestore) — mais lenta que o resto da API, nunca pendurada para sempre numa rede instável. */
const TIMEOUT_RESET_MS = 30_000;

/** Palavra exigida no campo de confirmação — o botão "Resetar" só habilita quando o texto digitado é exatamente este. */
const PALAVRA_CONFIRMACAO_RESET = "RESETAR";

interface RespostaResetAmbienteTeste {
  conversasExcluidas?: number;
  mensagensExcluidas?: number;
  fluxosExcluidos?: number;
  entradaAuditoriaId?: string;
  erro?: { codigo: string; mensagem: string };
}

/**
 * Gavetas de back-office — funcionam JUNTO do nicho principal, nunca no
 * lugar dele (ver `obterIdsModulosAtivos` em `@/modules/registry`). Lista
 * curta e fixa de propósito: são as únicas gavetas hoje pensadas para
 * ligar/desligar como extra, independente do nicho de indústria.
 */
const GAVETAS_EXTRAS: NicheKey[] = ["document-ai-vault", "sheet-reconciliation", "ar-recovery-engine"];

const ROTULO_MOEDA: Record<Moeda, string> = {
  BRL: "Real (R$)",
  USD: "Dólar (US$)",
  GBP: "Libra (£)",
  EUR: "Euro (€)",
};
const ROTULO_REGIME: Record<RegimeEncargos, string> = {
  "clt-br": "CLT (Brasil)",
  "payroll-us-uk": "Payroll Tax (EUA/UK)",
  "1099-us": "Contractor 1099 (EUA)",
  "seguranca-social-pt": "Segurança Social (Portugal)",
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
  const [gavetaErro, setGavetaErro] = useState<string | null>(null);

  // Zona de risco — Resetar ambiente de testes (ver `@/lib/server/testEnvironmentResetAdmin`).
  const [resetModalAberto, setResetModalAberto] = useState(false);
  const [resetConfirmTexto, setResetConfirmTexto] = useState("");
  const [resetando, setResetando] = useState(false);
  const [resetErro, setResetErro] = useState<string | null>(null);
  const [resetResultado, setResetResultado] = useState<RespostaResetAmbienteTeste | null>(null);

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

  // `?.label` (não `[chave].label` direto): `setor`/`regiaoOperacao`/`ralogDeCaixa`
  // são lidos de um documento do Firestore sem validação de runtime — um
  // valor legado de um preset já removido (ex.: nicho descontinuado) indexaria
  // `undefined` e quebraria a tela inteira com `TypeError`, exatamente a classe
  // de bug que esta auditoria pede para eliminar.
  const setorLabel = workspace?.setor ? NICHE_PRESETS[workspace.setor]?.label ?? null : null;
  const moduloDoSetor = workspace?.setor ? obterModulo(workspace.setor) : null;
  const regiaoLabel = workspace?.regiaoOperacao ? REGIAO_PRESETS[workspace.regiaoOperacao]?.label ?? null : null;
  const ralogDeCaixaLabel = workspace?.ralogDeCaixa ? PAIN_POINT_PRESETS[workspace.ralogDeCaixa]?.label ?? null : null;
  const extrasAtivas = new Set((workspace?.modulosAtivos ?? []).filter((id) => id !== workspace?.setor));

  /**
   * `modulosAtivos` é um OVERRIDE completo (ver `obterIdsModulosAtivos`): se
   * virar não-vazio sem o `setor` dentro dele, o workspace perde o nicho
   * principal. Por isso o próprio `setor` sempre entra junto de qualquer
   * extra ligada — e a lista volta a `[]` (nunca inventada vazia-com-setor)
   * quando a última extra é desligada, pra cair no fallback normal.
   */
  async function handleToggleGaveta(id: NicheKey, ativar: boolean) {
    if (!workspaceId || !workspace?.setor) return;
    setGavetaErro(null);
    try {
      const extrasAtuais = [...extrasAtivas];
      const novasExtras = ativar ? Array.from(new Set([...extrasAtuais, id])) : extrasAtuais.filter((m) => m !== id);
      const modulosAtivos: NicheKey[] = novasExtras.length > 0 ? [workspace.setor, ...novasExtras] : [];
      await patchWorkspace(workspaceId, { modulosAtivos });
      invalidarWorkspace(workspaceId);
    } catch (erro) {
      // Sem isto, uma escrita negada (rede instável, regra do Firestore)
      // deixava o checkbox "mentindo" — marcado na tela sem nunca ter
      // persistido — e a falha virava uma promise rejeitada sem dono. A
      // mensagem exibida é sempre fixa: o texto técnico (código do
      // Firestore, "Failed to fetch") vai só para o log de diagnóstico.
      reportarErro(erro, "settings:gaveta-extra");
      setGavetaErro("Não foi possível salvar esta gaveta agora. Tente novamente em alguns instantes.");
    }
  }

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
    } catch (erro) {
      // Texto técnico (código do Firestore, "Failed to fetch") vai só para o
      // log de diagnóstico — o campo sempre mostra uma mensagem fixa e amigável.
      reportarErro(erro, "settings:salvar-nome-workspace");
      setNameError("Não foi possível salvar o nome agora. Tente novamente em alguns instantes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleResetarAmbienteTeste() {
    setResetErro(null);
    setResetando(true);
    try {
      const usuarioAtual = auth?.currentUser;
      if (!usuarioAtual) throw new Error("Sessão expirada. Entre novamente para resetar o ambiente de testes.");

      const resposta = await fetchComTimeout(
        "/api/workspace/reset-ambiente-teste",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${await usuarioAtual.getIdToken()}`,
          },
          body: JSON.stringify({}),
        },
        "Não foi possível conectar ao servidor para resetar o ambiente de testes. Verifique sua conexão e tente novamente.",
        TIMEOUT_RESET_MS
      );

      const dados = (await resposta.json().catch(() => ({}))) as RespostaResetAmbienteTeste;
      if (!resposta.ok) {
        throw new Error(
          dados.erro?.mensagem ?? "Falha ao resetar o ambiente de testes. Tente novamente em alguns instantes."
        );
      }

      setResetResultado(dados);
      setResetModalAberto(false);
      setResetConfirmTexto("");
    } catch (erro) {
      reportarErro(erro, "settings:resetar-ambiente-teste");
      setResetErro(erro instanceof Error ? erro.message : "Não foi possível resetar o ambiente de testes.");
    } finally {
      setResetando(false);
    }
  }

  async function handleSignOut() {
    // Mesmo que o SDK falhe ao avisar o servidor (rede instável), o operador
    // nunca deve ficar travado num botão "Sair" que parece não fazer nada —
    // sempre navega para o login, que é o estado seguro por padrão.
    try {
      await signOut();
    } finally {
      router.push("/login");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
        <h2 className="text-sm font-semibold text-ink-950">Workspace</h2>
        {appUser?.papel === "admin" ? (
          <>
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
          </>
        ) : (
          // Renomear o workspace é uma decisão administrativa (mesma
          // checagem de `isAdminOf` que `firestore.rules` já exige nesta
          // escrita) — exibir aqui como texto, não como formulário editável,
          // evita um "Salvar" que parece funcionar mas é sempre rejeitado
          // pelo banco para quem está em `operacoes`.
          <p className="mt-3 text-sm text-ink-700">{workspaceName || "—"}</p>
        )}
        {setorLabel && (
          <div className="mt-3 rounded-[var(--radius-sm)] border border-signal-500/30 bg-signal-50 p-3">
            <p className="text-xs font-medium text-ink-500">Nicho ativo</p>
            <p className="mt-0.5 text-sm font-semibold text-ink-950">{setorLabel}</p>
            <p className="mt-1 text-xs text-ink-500">
              {moduloDoSetor?.descricao ??
                "Este nicho ainda não tem guardrail/painel dedicado — a Neural Inbox funciona no modo padrão, sem nenhum recurso extra específico de setor."}
            </p>
            {appUser?.papel === "admin" && (
              <Button variant="secondary" size="sm" className="mt-2" onClick={abrirQuizOnboarding}>
                Trocar nicho
              </Button>
            )}
          </div>
        )}
      </section>

      {appUser?.papel === "admin" && (
        <>
          <section className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
            <h2 className="text-sm font-semibold text-ink-950">Região &amp; Moeda</h2>
            <p className="mt-1 text-xs text-ink-500">
              Definidos junto com o nicho (cartão Workspace, acima — o mesmo botão &quot;Trocar nicho&quot; atualiza
              os três). O seletor completo de moeda/regime de encargos vive em{" "}
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
          </section>

          {workspace?.setor && (
            <section className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
              <h2 className="text-sm font-semibold text-ink-950">Gavetas extras (opcional)</h2>
              <p className="mt-1 text-xs text-ink-500">
                Ligue funcionalidades de back-office além do seu nicho principal — funcionam juntas, sem precisar
                trocar de nicho.
              </p>
              {gavetaErro && <p className="mt-2 text-xs text-state-error">{gavetaErro}</p>}
              <div className="mt-3 flex flex-col gap-2">
                {GAVETAS_EXTRAS.map((id) => {
                  const modulo = obterModulo(id);
                  if (!modulo) return null;
                  const ativa = extrasAtivas.has(id);
                  return (
                    <label
                      key={id}
                      className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-ink-100 p-3"
                    >
                      <span>
                        <span className="block text-sm font-medium text-ink-950">{modulo.nome}</span>
                        <span className="block text-xs text-ink-500">{modulo.descricao}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={ativa}
                        onChange={(e) => handleToggleGaveta(id, e.target.checked)}
                        className="h-4 w-4 flex-none accent-signal-600"
                      />
                    </label>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {appUser?.papel === "admin" && (
        <section className="rounded-[var(--radius-md)] border border-state-error bg-state-error-bg p-4">
          <h2 className="text-sm font-semibold text-state-error">Zona de risco</h2>
          <p className="mt-1 text-xs text-ink-700">
            Zerar conversas e fluxos de teste antes de abrir pro cliente. Use isto depois de aprender ou demonstrar o
            produto no Sandbox/Fluxos/Neural Inbox — e antes do primeiro contato de verdade chegar a este workspace.
          </p>
          <ul className="mt-2 list-disc pl-4 text-xs text-ink-500">
            <li>Apaga todas as conversas da Neural Inbox (de teste e manuais) e todos os fluxos deste workspace.</li>
            <li>Não toca em configuração do workspace, credenciais do Cofre, conectores já plugados nem na auditoria existente.</li>
            <li>Fica registrado na trilha de auditoria: quem resetou e quando.</li>
          </ul>
          {resetResultado && !resetErro && (
            <p className="mt-2 text-xs text-state-done">
              Resetado: {resetResultado.conversasExcluidas ?? 0} conversa(s), {resetResultado.mensagensExcluidas ?? 0}{" "}
              mensagem(ns) e {resetResultado.fluxosExcluidos ?? 0} fluxo(s) excluídos.
            </p>
          )}
          {resetErro && <p className="mt-2 text-xs text-state-error">{resetErro}</p>}
          <Button
            variant="danger-solid"
            size="sm"
            className="mt-3"
            onClick={() => {
              setResetErro(null);
              setResetResultado(null);
              setResetConfirmTexto("");
              setResetModalAberto(true);
            }}
          >
            Zerar conversas e fluxos de teste
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

      <Modal
        open={resetModalAberto}
        onClose={() => {
          if (resetando) return;
          setResetModalAberto(false);
          setResetConfirmTexto("");
        }}
        titleId="reset-ambiente-teste-title"
        title="Zerar conversas e fluxos de teste?"
        body={`Todas as conversas da Neural Inbox (de teste e manuais) e todos os fluxos deste workspace serão apagados permanentemente. Configuração do workspace, credenciais do Cofre, conectores e a trilha de auditoria existente não são afetados. Para confirmar, digite ${PALAVRA_CONFIRMACAO_RESET} abaixo.`}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={resetando}
              onClick={() => {
                setResetModalAberto(false);
                setResetConfirmTexto("");
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="danger-solid"
              size="sm"
              loading={resetando}
              disabled={resetConfirmTexto !== PALAVRA_CONFIRMACAO_RESET}
              onClick={handleResetarAmbienteTeste}
            >
              Sim, resetar
            </Button>
          </>
        }
      >
        <Field
          label={`Digite "${PALAVRA_CONFIRMACAO_RESET}" para confirmar`}
          value={resetConfirmTexto}
          onChange={(e) => setResetConfirmTexto(e.target.value)}
          placeholder={PALAVRA_CONFIRMACAO_RESET}
          autoFocus
          disabled={resetando}
        />
      </Modal>
    </div>
  );
}
