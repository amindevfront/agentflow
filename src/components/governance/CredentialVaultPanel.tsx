"use client";

// Cofre Zero-Trust de credenciais.
//
// A UI exibe apenas metadados: nome, tipo, versão, sufixo de 4 caracteres e
// fingerprint. Não existe botão "revelar" — o segredo não volta ao browser em
// nenhuma circunstância, nem para quem o cadastrou. Para trocar a credencial, o
// caminho é rotacionar, nunca ler e reescrever.

import { useEffect, useState } from "react";
import type { CredentialKind, CredentialMetadata } from "@/types";
import {
  ROTULO_TIPO_CREDENCIAL,
  armazenarCredencial,
  revogarCredencial,
  rotacionarCredencial,
  statusEfetivo,
  subscribeCredenciais,
} from "@/lib/credentials";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { cn, formatRelativeTime } from "@/lib/utils";

const TIPOS: CredentialKind[] = [
  "api-key",
  "bearer-token",
  "oauth-refresh-token",
  "webhook-secret",
  "basic-auth",
  "chave-privada",
];

const corStatus: Record<CredentialMetadata["status"], string> = {
  ativa: "bg-state-done-bg text-state-done",
  revogada: "bg-state-error-bg text-state-error",
  expirada: "bg-state-run-bg text-state-run",
};

const ROTULO_STATUS: Record<CredentialMetadata["status"], string> = {
  ativa: "ativa",
  revogada: "revogada",
  expirada: "expirada",
};

export function CredentialVaultPanel() {
  const [credenciais, setCredenciais] = useState<CredentialMetadata[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<CredentialKind>("api-key");
  const [segredo, setSegredo] = useState("");
  const [expiraEm, setExpiraEm] = useState("");

  const [rotacionandoId, setRotacionandoId] = useState<string | null>(null);
  const [novoSegredo, setNovoSegredo] = useState("");
  const [revogacaoAlvo, setRevogacaoAlvo] = useState<CredentialMetadata | null>(null);

  useEffect(() => {
    return subscribeCredenciais(setCredenciais, {
      onError: () => setErro("Não foi possível carregar o cofre de credenciais agora. Tente novamente em instantes."),
    });
  }, []);

  async function handleCriar() {
    setErro(null);
    setAviso(null);
    setSalvando(true);
    try {
      const criada = await armazenarCredencial({
        nome,
        tipo,
        segredo,
        expiraEm: expiraEm ? new Date(expiraEm).toISOString() : null,
      });
      // Limpa o campo do segredo imediatamente: não há motivo para ele
      // continuar em memória do browser depois de selado.
      setSegredo("");
      setNome("");
      setExpiraEm("");
      setAviso(`Credencial "${criada.nome}" selada na versão ${criada.versao}.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível armazenar a credencial.");
    } finally {
      setSalvando(false);
    }
  }

  async function handleRotacionar(credencial: CredentialMetadata) {
    setErro(null);
    setAviso(null);
    setSalvando(true);
    try {
      const atualizada = await rotacionarCredencial(credencial.id, novoSegredo, credencial.workspaceId);
      setNovoSegredo("");
      setRotacionandoId(null);
      setAviso(`"${credencial.nome}" rotacionada para a versão ${atualizada.versao}.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível rotacionar a credencial.");
    } finally {
      setSalvando(false);
    }
  }

  async function handleRevogar() {
    if (!revogacaoAlvo) return;
    setErro(null);
    setSalvando(true);
    try {
      await revogarCredencial(revogacaoAlvo.id, revogacaoAlvo.workspaceId);
      setAviso(`"${revogacaoAlvo.nome}" revogada.`);
      setRevogacaoAlvo(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível revogar a credencial.");
    } finally {
      setSalvando(false);
    }
  }

  const segredoCurto = segredo.length > 0 && segredo.length < 8;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
        <div>
          <h3 className="text-sm font-semibold text-ink-950">Nova credencial</h3>
          <p className="mt-0.5 text-xs text-ink-400">
            O segredo é cifrado no servidor (AES-256-GCM) e nunca retorna ao navegador.
          </p>
        </div>

        <Field
          label="Nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: API de faturamento"
          helpText="Identificação da credencial na listagem."
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="cred-tipo" className="text-sm font-medium text-ink-700">
            Tipo
          </label>
          <select
            id="cred-tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as CredentialKind)}
            className="h-10 rounded-[var(--radius-sm)] border border-ink-100 bg-white px-3 text-sm text-ink-950 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
          >
            {TIPOS.map((valor) => (
              <option key={valor} value={valor}>
                {ROTULO_TIPO_CREDENCIAL[valor]}
              </option>
            ))}
          </select>
        </div>

        <Field
          label="Segredo"
          type="password"
          autoComplete="off"
          value={segredo}
          onChange={(e) => setSegredo(e.target.value)}
          placeholder="Cole o valor da credencial"
          errorText={segredoCurto ? "Mínimo de 8 caracteres." : undefined}
          helpText="Enviado uma única vez, sobre TLS, e descartado do navegador após o selo."
        />

        <Field
          label="Expira em (opcional)"
          type="date"
          value={expiraEm}
          onChange={(e) => setExpiraEm(e.target.value)}
          helpText="Credenciais com validade recebem alerta visual ao vencer."
        />

        <Button
          size="sm"
          loading={salvando}
          disabled={nome.trim().length === 0 || segredo.length < 8}
          onClick={handleCriar}
        >
          Selar credencial
        </Button>

        {erro && <p className="text-xs text-state-error">{erro}</p>}
        {aviso && <p className="text-xs text-state-done">{aviso}</p>}
      </section>

      <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-950">Credenciais do workspace</h3>
          <span className="mono text-xs text-ink-400">{credenciais.length}</span>
        </div>

        {credenciais.length === 0 ? (
          <EmptyState
            title="Nenhuma credencial no cofre"
            description="Credenciais de conectores e webhooks ficam cifradas em repouso e são usadas apenas pelo motor de execução."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {credenciais.map((credencial) => {
              const status = statusEfetivo(credencial);
              return (
                <li
                  key={credencial.id}
                  className="rounded-[var(--radius-sm)] border border-ink-100 px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-950">
                      {credencial.nome}
                    </span>
                    <span
                      className={cn(
                        "flex-none rounded-full px-2.5 py-1 text-[11px] font-medium",
                        corStatus[status]
                      )}
                    >
                      {ROTULO_STATUS[status]}
                    </span>
                  </div>

                  <p className="mt-0.5 text-xs text-ink-500">
                    {ROTULO_TIPO_CREDENCIAL[credencial.tipo]} · criada{" "}
                    {formatRelativeTime(new Date(credencial.criadoEm))}
                  </p>
                  <p className="mono mt-0.5 text-[11px] text-ink-400">
                    v{credencial.versao} · ••••{credencial.sufixo} · impressão {credencial.fingerprint}
                  </p>
                  {credencial.expiraEm && (
                    <p className="mono mt-0.5 text-[11px] text-ink-400">
                      expira em {new Date(credencial.expiraEm).toLocaleDateString("pt-BR")}
                    </p>
                  )}

                  {status !== "revogada" && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {rotacionandoId === credencial.id ? (
                        <>
                          <input
                            type="password"
                            autoComplete="off"
                            aria-label={`Novo segredo para ${credencial.nome}`}
                            value={novoSegredo}
                            onChange={(e) => setNovoSegredo(e.target.value)}
                            placeholder="Novo segredo"
                            className="h-9 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-ink-100 bg-white px-3 text-sm outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
                          />
                          <Button
                            size="sm"
                            loading={salvando}
                            disabled={novoSegredo.length < 8}
                            onClick={() => handleRotacionar(credencial)}
                          >
                            Confirmar
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setRotacionandoId(null);
                              setNovoSegredo("");
                            }}
                          >
                            Cancelar
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setRotacionandoId(credencial.id);
                              setNovoSegredo("");
                            }}
                          >
                            Rotacionar
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setRevogacaoAlvo(credencial)}
                          >
                            Revogar
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Modal
        open={revogacaoAlvo !== null}
        onClose={() => setRevogacaoAlvo(null)}
        titleId="cofre-revogar-title"
        title="Revogar esta credencial?"
        body="Fluxos que dependem dela passam a falhar imediatamente. O registro permanece no cofre, marcado como revogado, para que a auditoria preserve o histórico."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setRevogacaoAlvo(null)}>
              Cancelar
            </Button>
            <Button variant="danger-solid" size="sm" loading={salvando} onClick={handleRevogar}>
              Sim, revogar
            </Button>
          </>
        }
      />
    </div>
  );
}
