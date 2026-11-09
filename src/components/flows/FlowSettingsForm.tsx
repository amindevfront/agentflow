"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { createFlow, updateFlow } from "@/lib/firestore";
import { useWorkspace } from "@/lib/workspace";
import { useWorkspaceDoc } from "@/lib/queries/workspace";
import { obterExemploFluxo } from "@/lib/flowDemoData";
import {
  armazenarCredencial,
  obterCredencial,
  rotacionarCredencial,
  statusEfetivo,
} from "@/lib/credentials";
import { reportarErro } from "@/lib/telemetry/errorReporting";
import type { CredentialMetadata, Flow } from "@/types";

const WEBHOOK_REGEX = /^https:\/\/[\w-]+(\.[\w-]+)+(\/.*)?$/i;

/**
 * Endpoint de teste público do próprio AgentFlow — preenchido com um clique
 * quando o gatilho é Webhook e o operador só quer destravar o salvamento
 * para testar o fluxo (sem ter um endpoint real em mãos ainda). Nunca
 * inserido em silêncio: é sempre uma ação explícita do operador (botão
 * "usar URL de teste"), nunca escrito automaticamente no campo.
 */
const WEBHOOK_URL_TESTE = "https://agentflow-black.vercel.app/api/webhook";

/** Só o gatilho Webhook depende de fato de um endereço — os demais nunca deveriam travar o salvamento por isso. */
function webhookEhObrigatorio(gatilho: string): boolean {
  return gatilho === "webhook";
}

/** Mesmos rótulos das opções do seletor de gatilho, reaproveitados nas mensagens de ajuda. */
const ROTULO_GATILHO: Record<string, string> = {
  webhook: "Webhook",
  agendado: "Agendado",
  formulario: "Formulário",
  manual: "Manual",
};

interface FlowSettingsFormProps {
  flow: Flow | null;
  onSaved: (flowId: string) => void;
}

/**
 * O token de API nunca é persistido neste formulário. Ele é digitado uma
 * única vez e selado pelo cofre Zero-Trust (`@/lib/credentials`) — o
 * documento do fluxo armazena apenas a referência (`apiTokenCredentialId`),
 * nunca o valor em claro.
 *
 * Isso corrige uma falha real da v1: o campo anterior, `apiToken`, gravava o
 * segredo diretamente em `flows/{id}`, legível por qualquer membro do
 * workspace (`allow read: if belongsToWorkspace(...)`) — completamente fora
 * do cofre construído para esse exato propósito.
 */
export function FlowSettingsForm({ flow, onSaved }: FlowSettingsFormProps) {
  const { workspaceId } = useWorkspace();
  // Cacheado (ver `src/lib/queries/workspace.ts`) — só pra saber qual exemplo
  // de Preenchimento Mágico sugerir; nenhuma leitura extra de Firestore além
  // da que `/flows` já paga.
  const { data: workspace } = useWorkspaceDoc(workspaceId);
  const [nome, setNome] = useState(flow?.nome ?? "");
  const [gatilho, setGatilho] = useState(flow?.gatilho ?? "webhook");
  const [origem, setOrigem] = useState(flow?.origem ?? "");
  const [webhookUrl, setWebhookUrl] = useState(flow?.webhookUrl ?? "");

  const [credencialVinculada, setCredencialVinculada] = useState<CredentialMetadata | null>(null);
  const [carregandoCredencial, setCarregandoCredencial] = useState(Boolean(flow?.apiTokenCredentialId));
  const [trocandoToken, setTrocandoToken] = useState(false);
  const [novoToken, setNovoToken] = useState("");
  const [tokenVisible, setTokenVisible] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Confirmação explícita de que o fluxo foi salvo — sem isso, o único sinal
  // era o formulário continuar na tela como se nada tivesse acontecido
  // (mesma causa da confusão "não tem um botão que salva esse fluxo": o
  // salvamento sempre funcionou, só nunca disse isso em voz alta).
  const [savedRecently, setSavedRecently] = useState(false);

  // Qualquer edição de verdade depois de salvar apaga a confirmação — ela
  // não pode continuar na tela depois que o conteúdo salvo já mudou.
  useEffect(() => {
    setSavedRecently(false);
  }, [nome, gatilho, origem, webhookUrl]);

  // Reidrata o estado do formulário quando o fluxo selecionado muda — sem
  // isso, trocar de fluxo na lista manteria os campos do anterior na tela.
  useEffect(() => {
    setNome(flow?.nome ?? "");
    setGatilho(flow?.gatilho ?? "webhook");
    setOrigem(flow?.origem ?? "");
    setWebhookUrl(flow?.webhookUrl ?? "");
    setNovoToken("");
    setTrocandoToken(false);
    setSaveError(null);
    setSavedRecently(false);

    const credentialId = flow?.apiTokenCredentialId;
    if (!credentialId) {
      setCredencialVinculada(null);
      setCarregandoCredencial(false);
      return;
    }

    setCarregandoCredencial(true);
    let cancelado = false;
    obterCredencial(credentialId)
      .then((credencial) => {
        if (!cancelado) setCredencialVinculada(credencial);
      })
      .catch(() => {
        if (!cancelado) setCredencialVinculada(null);
      })
      .finally(() => {
        if (!cancelado) setCarregandoCredencial(false);
      });

    return () => {
      cancelado = true;
    };
  }, [flow]);

  const nomeTouched = nome.length > 0;
  const nomeInvalid = nomeTouched && nome.trim().length < 3;

  // Validação inteligente: a URL do webhook só é EXIGIDA quando o gatilho
  // escolhido de fato depende dela. Para "agendado"/"formulário"/"manual",
  // o campo é opcional por natureza — deixá-lo vazio nunca deveria travar o
  // salvamento (antes deste ajuste, o formulário não bloqueava por estar
  // vazio, mas também não explicava isso; agora o estado é explícito nos
  // três lugares que dependem dele: validação, mensagem e botão).
  const webhookObrigatorio = webhookEhObrigatorio(gatilho);
  const webhookTouched = webhookUrl.trim().length > 0;
  const webhookInvalid = webhookTouched && !WEBHOOK_REGEX.test(webhookUrl.trim());
  const webhookValid = webhookTouched && !webhookInvalid;
  const webhookFaltando = webhookObrigatorio && !webhookTouched;

  const tokenTouched = novoToken.length > 0;
  const tokenInvalid = tokenTouched && novoToken.trim().length < 8;

  // Cada pendência vira uma linha explicável no painel de ajuda — nunca só
  // "o botão está cinza, adivinha por quê" (ver callout abaixo do formulário).
  const pendencias: string[] = [];
  if (nome.trim().length < 3) {
    pendencias.push("Nome do fluxo — informe pelo menos 3 caracteres.");
  }
  if (webhookFaltando) {
    pendencias.push('URL do webhook — obrigatória para o gatilho "Webhook" (ou use o endereço de teste abaixo).');
  }
  if (webhookInvalid) {
    pendencias.push("URL do webhook — formato inválido (use https:// seguido de um domínio).");
  }
  if (tokenInvalid) {
    pendencias.push("Token de API — informe pelo menos 8 caracteres, ou cancele a troca.");
  }

  const canSubmit = pendencias.length === 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !workspaceId) return;
    setSaving(true);
    setSaveError(null);

    try {
      // Sela o token ANTES de tocar no documento do fluxo: se o selo falhar,
      // nada é salvo pela metade (nenhum fluxo com referência pendurada em
      // uma credencial que não existe).
      let apiTokenCredentialId = flow?.apiTokenCredentialId ?? null;
      const tokenParaSelar = novoToken.trim();

      if (tokenParaSelar.length > 0) {
        if (apiTokenCredentialId) {
          await rotacionarCredencial(apiTokenCredentialId, tokenParaSelar, flow?.workspaceId ?? workspaceId);
        } else {
          const criada = await armazenarCredencial({
            nome: `Token do fluxo: ${nome.trim()}`,
            tipo: "api-key",
            segredo: tokenParaSelar,
            conectorId: null,
            workspaceId,
          });
          apiTokenCredentialId = criada.id;
        }
      }

      if (flow) {
        await updateFlow(flow.id, { nome, gatilho, origem, webhookUrl, apiTokenCredentialId });
        onSaved(flow.id);
      } else {
        const id = await createFlow(workspaceId, {
          nome,
          gatilho,
          origem,
          webhookUrl,
          apiTokenCredentialId,
          status: "ocioso",
          steps: [{ id: "etapa-1", titulo: "Receber gatilho" }],
        });
        onSaved(id);
      }

      setNovoToken("");
      setTrocandoToken(false);
      setSavedRecently(true);
    } catch (err) {
      // Nunca expõe o texto técnico (ex.: erro do cofre de credenciais,
      // código do Firestore) ao dono do negócio — só registra para
      // diagnóstico e mostra um aviso acionável.
      reportarErro(err, "flows:salvar-fluxo");
      setSaveError("Não foi possível salvar o fluxo agora. Tente novamente em alguns segundos.");
    } finally {
      setSaving(false);
    }
  }

  const statusCredencial = credencialVinculada ? statusEfetivo(credencialVinculada) : null;

  /**
   * Preenchimento Mágico por Nicho (Modo Copiloto Guiado): preenche os
   * campos com um exemplo de demonstração calibrado para o nicho ativo do
   * workspace — pra implementador/vendedor nunca precisar digitar nada numa
   * demo. Só aparece criando um fluxo NOVO (`!flow`): rodar isto sobre um
   * fluxo real já salvo sobrescreveria configuração de produção de verdade,
   * o que nunca deveria acontecer com um clique de atalho.
   */
  function handlePreenchimentoMagico() {
    const exemplo = obterExemploFluxo(workspace?.setor);
    setNome(exemplo.nomeFluxo);
    setGatilho(exemplo.gatilho);
    setOrigem(exemplo.origem);
    setWebhookUrl(exemplo.gatilho === "webhook" ? WEBHOOK_URL_TESTE : "");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink-950">
            {flow ? "Configurações do fluxo selecionado" : "Novo fluxo"}
          </h2>
          <p className="mt-0.5 text-xs text-ink-400">
            Validação reativa antes de salvar — nada é aceito fora do formato esperado.
          </p>
        </div>
        {!flow && (
          <button
            type="button"
            onClick={handlePreenchimentoMagico}
            className="flex-none whitespace-nowrap rounded-full border border-signal-500/40 bg-signal-50 px-3 py-1.5 text-xs font-medium text-signal-700 hover:bg-signal-100"
            title="Preenche um exemplo de demonstração calibrado para o seu nicho — nunca sobrescreve um fluxo real já salvo."
          >
            Preencher com Dados de Demonstração
          </button>
        )}
      </div>

      <Field
        label="Nome do fluxo"
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        errorText={nomeInvalid ? "Informe pelo menos 3 caracteres." : undefined}
        required
      />

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-ink-700" htmlFor="gatilho">
          Gatilho
        </label>
        <select
          id="gatilho"
          value={gatilho}
          onChange={(e) => setGatilho(e.target.value)}
          className="h-10 rounded-[var(--radius-sm)] border border-ink-100 bg-white px-3 text-sm text-ink-950 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
        >
          <option value="webhook">Webhook</option>
          <option value="agendado">Agendado</option>
          <option value="formulario">Formulário</option>
          <option value="manual">Manual</option>
        </select>
      </div>

      <Field
        label="Origem"
        placeholder="ex.: novo e-mail em contratos@"
        value={origem}
        onChange={(e) => setOrigem(e.target.value)}
      />

      <div className="flex flex-col gap-1.5">
        <Field
          label="URL do webhook"
          placeholder={webhookObrigatorio ? "https://" : "Opcional para este gatilho"}
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          errorText={
            webhookInvalid
              ? "Endereço incompleto — use https:// e um domínio válido."
              : webhookFaltando
                ? 'Obrigatória para o gatilho "Webhook" — cole a sua ou use a de teste abaixo.'
                : undefined
          }
          okText={webhookValid ? "Endereço válido." : undefined}
          helpText={
            !webhookObrigatorio && !webhookTouched
              ? `Opcional para o gatilho "${ROTULO_GATILHO[gatilho] ?? gatilho}" — pode deixar em branco.`
              : undefined
          }
        />
        {(webhookObrigatorio || webhookTouched) && webhookUrl.trim() !== WEBHOOK_URL_TESTE && (
          <button
            type="button"
            onClick={() => setWebhookUrl(WEBHOOK_URL_TESTE)}
            className="self-start text-xs font-medium text-signal-600 hover:underline"
          >
            usar URL de teste do AgentFlow
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-700">Token de API</span>

        {carregandoCredencial ? (
          <p className="text-xs text-ink-400">Carregando status do token…</p>
        ) : credencialVinculada && !trocandoToken ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-ink-100 bg-mist-50 px-3 py-2">
            <span
              className={
                statusCredencial === "ativa"
                  ? "mono rounded-full bg-state-done-bg px-2 py-0.5 text-[11px] font-medium text-state-done"
                  : "mono rounded-full bg-state-error-bg px-2 py-0.5 text-[11px] font-medium text-state-error"
              }
            >
              {statusCredencial}
            </span>
            <span className="mono text-xs text-ink-500">
              ••••{credencialVinculada.sufixo} · v{credencialVinculada.versao}
            </span>
            <button
              type="button"
              onClick={() => setTrocandoToken(true)}
              className="ml-auto text-xs font-medium text-signal-600 hover:underline"
            >
              trocar token
            </button>
          </div>
        ) : (
          <>
            <div className="relative">
              <input
                id="api-token"
                type={tokenVisible ? "text" : "password"}
                autoComplete="off"
                value={novoToken}
                onChange={(e) => setNovoToken(e.target.value)}
                placeholder={credencialVinculada ? "Novo valor para substituir o token atual" : "Cole o token aqui"}
                className="h-10 w-full rounded-[var(--radius-sm)] border border-ink-100 bg-white px-3 pr-16 text-sm text-ink-950 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
              />
              <button
                type="button"
                onClick={() => setTokenVisible((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-signal-600 hover:underline"
              >
                {tokenVisible ? "ocultar" : "revelar"}
              </button>
            </div>
            {tokenInvalid && <span className="text-xs text-state-error">Mínimo de 8 caracteres.</span>}
            {credencialVinculada && (
              <button
                type="button"
                onClick={() => {
                  setTrocandoToken(false);
                  setNovoToken("");
                }}
                className="self-start text-xs font-medium text-ink-500 hover:underline"
              >
                cancelar troca
              </button>
            )}
          </>
        )}

        <span className="text-xs text-ink-400">
          O token é cifrado no cofre (AES-256-GCM) assim que salvo — este formulário nunca grava o
          valor em claro no documento do fluxo.
        </span>
      </div>

      {saveError && <p className="text-xs text-state-error">{saveError}</p>}

      {savedRecently && !saveError && (
        <p
          role="status"
          className="rounded-[var(--radius-sm)] border border-state-done-ink/30 bg-state-done-bg px-3 py-2.5 text-xs text-state-done"
        >
          ✓ Fluxo salvo! Role até o Sandbox, mais abaixo, para testar e ver aparecendo na Neural Inbox.
        </p>
      )}

      {!canSubmit && (
        <div
          role="status"
          className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-state-run-ink/30 bg-state-run-bg px-3 py-2.5"
        >
          <p className="text-xs font-semibold text-state-run">Para salvar, corrija:</p>
          <ul className="flex flex-col gap-0.5 pl-4 text-xs text-ink-700">
            {pendencias.map((pendencia) => (
              <li key={pendencia} className="list-disc">
                {pendencia}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button
        type="submit"
        loading={saving}
        disabled={!canSubmit}
        title={!canSubmit ? pendencias.join(" ") : undefined}
        className="w-full sm:w-auto"
      >
        Salvar configurações
      </Button>
    </form>
  );
}
