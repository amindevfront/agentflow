"use client";

// Anexos rápidos por nicho (Imobiliário/Construtoras) — memorial descritivo,
// plantas e tabela de disponibilidade. Catálogo de LINKS (ver nota em
// `@/types`, `NicheAttachment`), reaproveitado em dois contextos:
//
//   - Fluxos: gerenciamento do catálogo (criar/remover).
//   - Neural Inbox: mesmo catálogo, com um botão "Inserir" por item que
//     escreve o link formatado na caixa de resposta (prop `onInsert`).

import { useEffect, useState } from "react";
import type { NicheAttachment, NicheAttachmentTipo } from "@/types";
import { useWorkspace } from "@/lib/workspace";
import { auth } from "@/lib/firebase";
import {
  ROTULO_TIPO_ANEXO,
  criarAnexoDeNicho,
  formatarAnexoParaMensagem,
  removerAnexoDeNicho,
  subscribeNicheAttachments,
} from "@/lib/nicheAttachments";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";

const TIPOS: NicheAttachmentTipo[] = ["memorial-descritivo", "planta", "tabela-disponibilidade", "outro"];

interface NicheAttachmentsPanelProps {
  /** Quando presente, cada item ganha um botão "Inserir" que chama isto com o texto formatado. */
  onInsert?: (texto: string) => void;
  className?: string;
}

export function NicheAttachmentsPanel({ onInsert, className }: NicheAttachmentsPanelProps) {
  const { workspaceId } = useWorkspace();
  const [anexos, setAnexos] = useState<NicheAttachment[]>([]);
  const [formAberto, setFormAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<NicheAttachmentTipo>("memorial-descritivo");
  const [url, setUrl] = useState("");
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeNicheAttachments(setAnexos, workspaceId);
  }, [workspaceId]);

  async function handleCriar() {
    const uid = auth?.currentUser?.uid;
    if (!uid || !nome.trim() || !url.trim()) return;
    setProcessando(true);
    setErro(null);
    try {
      await criarAnexoDeNicho({ nome: nome.trim(), tipo, url: url.trim(), workspaceId: workspaceId ?? undefined, criadoPor: uid });
      setNome("");
      setUrl("");
      setFormAberto(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível adicionar o anexo.");
    } finally {
      setProcessando(false);
    }
  }

  async function handleRemover(id: string) {
    setProcessando(true);
    setErro(null);
    try {
      await removerAnexoDeNicho(id);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível remover o anexo.");
    } finally {
      setProcessando(false);
    }
  }

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink-950">Anexos rápidos</h3>
          <p className="mt-0.5 text-xs text-ink-400">
            Memorial descritivo, plantas e tabela de disponibilidade — link, não upload de arquivo.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setFormAberto((v) => !v)}>
          {formAberto ? "Cancelar" : "Adicionar"}
        </Button>
      </div>

      {formAberto && (
        <div className="mt-2 flex flex-col gap-2 rounded-[var(--radius-sm)] border border-signal-500 bg-signal-50 p-3">
          <Field label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Memorial — Edifício Horizonte" />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="natt-tipo" className="text-sm font-medium text-ink-700">
              Tipo
            </label>
            <select
              id="natt-tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as NicheAttachmentTipo)}
              className="h-10 rounded-[var(--radius-sm)] border border-ink-100 bg-white px-3 text-sm text-ink-950 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
            >
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO_ANEXO[t]}
                </option>
              ))}
            </select>
          </div>
          <Field label="URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
          {erro && <p className="text-xs text-state-error">{erro}</p>}
          <Button size="sm" loading={processando} disabled={!nome.trim() || !url.trim()} onClick={handleCriar}>
            Salvar anexo
          </Button>
        </div>
      )}

      <div className="mt-3">
        {anexos.length === 0 ? (
          <EmptyState title="Nenhum anexo cadastrado" description="Adicione os links de referência do seu nicho para reaproveitar no atendimento." />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {anexos.map((anexo) => (
              <li
                key={anexo.id}
                className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-ink-100 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink-900">{anexo.nome}</p>
                  <p className="mono text-[11px] text-ink-400">{ROTULO_TIPO_ANEXO[anexo.tipo]}</p>
                </div>
                <div className="flex flex-none items-center gap-1.5">
                  {onInsert && (
                    <Button size="sm" variant="secondary" onClick={() => onInsert(formatarAnexoParaMensagem(anexo))}>
                      Inserir
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" disabled={processando} onClick={() => handleRemover(anexo.id)}>
                    Remover
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default NicheAttachmentsPanel;
