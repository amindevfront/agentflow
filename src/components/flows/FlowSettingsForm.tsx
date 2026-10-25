"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { createFlow, updateFlow } from "@/lib/firestore";
import { useWorkspace } from "@/lib/workspace";
import {
  armazenarCredencial,
  obterCredencial,
  rotacionarCredencial,
  statusEfetivo,
} from "@/lib/credentials";
import type { CredentialMetadata, Flow } from "@/types";

const WEBHOOK_REGEX = /^https:\/\/[\w-]+(\.[\w-]+)+(\/.*)?$/i;

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

  const webhookTouched = webhookUrl.length > 0;
  const webhookInvalid = webhookTouched && !WEBHOOK_REGEX.test(webhookUrl);
  const webhookValid = webhookTouched && WEBHOOK_REGEX.test(webhookUrl);

  const tokenTouched = novoToken.length > 0;
  const tokenInvalid = tokenTouched && novoToken.trim().length < 8;

  const canSubmit = nome.trim().length >= 3 && !webhookInvalid && !tokenInvalid;

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
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  const statusCredencial = credencialVinculada ? statusEfetivo(credencialVinculada) : null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-ink-950">
          {flow ? "Configurações do fluxo selecionado" : "Novo fluxo"}
        </h2>
        <p className="mt-0.5 text-xs text-ink-400">
          Validação reativa antes de salvar — nada é aceito fora do formato esperado.
        </p>
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

      <Field
        label="URL do webhook"
        placeholder="https://"
        value={webhookUrl}
        onChange={(e) => setWebhookUrl(e.target.value)}
        errorText={webhookInvalid ? "Endereço incompleto — use https:// e um domínio válido." : undefined}
        okText={webhookValid ? "Endereço válido." : undefined}
      />

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

      <Button type="submit" loading={saving} disabled={!canSubmit}>
        Salvar configurações
      </Button>
    </form>
  );
}
