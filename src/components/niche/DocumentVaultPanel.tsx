"use client";

// Document AI Vault — Gestão Inteligente de Documentos e Contratos.
//
// O usuário arrasta/seleciona um arquivo (nome capturado para o registro) e
// cola o texto do contrato — extração automática de texto de PDF é
// trabalho futuro (parser dedicado, mesma honestidade de "integração com
// portais é trabalho futuro" em `@/lib/server/usRealEstateLuxury`): esta
// versão analisa o TEXTO em claro que o operador já tem em mãos (copiado do
// próprio PDF, de um e-mail, etc.), o que já resolve o grosso do problema
// sem fingir uma capacidade de OCR que não existe aqui.
//
// Pipeline, nesta ordem: Shield-Layer (`interceptarMensagem`) mascara PII
// ANTES de qualquer análise ou persistência → `analisarClausulasCriticas` +
// `gerarResumoExecutivoContrato` (léxico determinístico, sem IA generativa)
// → salvo em `documentosContratos` → ganho operacional creditado via
// `/api/back-office/ganho-operacional` (horas economizadas, reflete no
// BusinessROIWidget).

import { useEffect, useState } from "react";
import type { DocumentoContrato } from "@/types";
import { useWorkspace } from "@/lib/workspace";
import { auth } from "@/lib/firebase";
import { interceptarMensagem } from "@/lib/guardrails/piiVault";
import { analisarClausulasCriticas, gerarResumoExecutivoContrato } from "@/lib/documentAiVault";
import { salvarDocumentoAnalisado, subscribeDocumentosContratos } from "@/lib/documentosContratos";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";

const CORES_SEVERIDADE: Record<string, string> = {
  alta: "bg-state-error-bg text-state-error",
  media: "bg-state-run-bg text-state-run",
  baixa: "bg-state-idle-bg text-state-idle",
};

export function DocumentVaultPanel() {
  const { workspaceId } = useWorkspace();
  const [documentos, setDocumentos] = useState<DocumentoContrato[]>([]);
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [textoContrato, setTextoContrato] = useState("");
  const [arrastando, setArrastando] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeDocumentosContratos(setDocumentos, workspaceId);
  }, [workspaceId]);

  function handleDrop(evento: React.DragEvent<HTMLDivElement>) {
    evento.preventDefault();
    setArrastando(false);
    const arquivo = evento.dataTransfer.files?.[0];
    if (!arquivo) return;
    setNomeArquivo(arquivo.name);
    if (arquivo.type === "text/plain" || arquivo.name.endsWith(".txt")) {
      arquivo.text().then(setTextoContrato).catch(() => undefined);
    }
  }

  async function handleAnalisar() {
    const uid = auth?.currentUser?.uid;
    if (!uid || !textoContrato.trim()) return;
    setProcessando(true);
    setErro(null);
    try {
      const { textoMascarado } = interceptarMensagem(textoContrato);
      const clausulasCriticas = analisarClausulasCriticas(textoMascarado);
      const resumoExecutivo = gerarResumoExecutivoContrato(textoMascarado, clausulasCriticas);

      await salvarDocumentoAnalisado({
        nomeArquivo: nomeArquivo.trim() || "Documento sem nome",
        textoMascarado,
        clausulasCriticas,
        resumoExecutivo,
        criadoPor: uid,
        workspaceId: workspaceId ?? undefined,
      });

      const usuario = auth?.currentUser;
      if (usuario) {
        await fetch("/api/back-office/ganho-operacional", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${await usuario.getIdToken()}` },
          body: JSON.stringify({ origem: "document-ai-vault", descricao: `Análise de "${nomeArquivo || "documento"}"` }),
        }).catch(() => undefined);
      }

      setNomeArquivo("");
      setTextoContrato("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível analisar o documento.");
    } finally {
      setProcessando(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-ink-950">Document AI Vault</h3>
        <p className="mt-0.5 text-xs text-ink-400">
          Extração de cláusulas críticas, Shield-Layer de PII e resumo executivo automático.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={handleDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-1 rounded-[var(--radius-sm)] border-2 border-dashed p-4 text-center text-xs text-ink-400",
          arrastando ? "border-signal-500 bg-signal-50" : "border-ink-100"
        )}
      >
        <span>Arraste um arquivo .txt aqui, ou cole o texto do contrato abaixo</span>
        <span className="text-[11px] text-ink-300">
          Extração automática de texto de PDF é trabalho futuro — cole o texto já extraído para análise imediata.
        </span>
      </div>

      {nomeArquivo && <p className="mono text-xs text-ink-500">Arquivo: {nomeArquivo}</p>}

      <textarea
        value={textoContrato}
        onChange={(e) => setTextoContrato(e.target.value)}
        placeholder="Cole aqui o texto do contrato..."
        rows={6}
        className="rounded-[var(--radius-sm)] border border-ink-100 bg-white p-3 text-sm text-ink-950 outline-none placeholder:text-ink-300 focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
      />

      {erro && <p className="text-xs text-state-error">{erro}</p>}

      <Button size="sm" disabled={!textoContrato.trim()} loading={processando} onClick={handleAnalisar}>
        Analisar documento
      </Button>

      {documentos.length === 0 ? (
        <EmptyState
          title="Nenhum documento analisado ainda"
          description="Cole o texto de um contrato acima para extrair cláusulas críticas e gerar o resumo executivo."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {documentos.map((documento) => (
            <li key={documento.id} className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-ink-100 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink-950">{documento.nomeArquivo}</span>
                <span className="mono text-[11px] text-ink-400">
                  {documento.clausulasCriticas.length} cláusula(s)
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {documento.clausulasCriticas.map((clausula, indice) => (
                  <span
                    key={indice}
                    className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", CORES_SEVERIDADE[clausula.severidade])}
                  >
                    {clausula.rotulo}
                  </span>
                ))}
              </div>
              {documento.resumoExecutivo && (
                <p className="whitespace-pre-line text-xs text-ink-500">{documento.resumoExecutivo}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default DocumentVaultPanel;
