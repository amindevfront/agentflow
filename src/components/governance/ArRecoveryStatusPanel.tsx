"use client";

// AR Recovery Engine — painel de status (Governança).
//
// Visão geral dos documentos/faturas monitorados pelo motor autônomo de
// cobrança (`@/lib/arRecoveryEngine`/`@/lib/server/arRecoveryEngine`) — o
// tick em si roda via scheduler externo (`/api/ar-recovery/tick`), nunca
// disparado por este painel: aqui o operador cadastra documentos e consulta
// o status, mesmo padrão de `DistratoRiskPanel` (ferramenta interna, não um
// gerador de mensagem automática ao devedor).

import { useEffect, useMemo, useState } from "react";
import type { DocumentoPendente, NivelUrgenciaCobranca } from "@/types";
import { useWorkspace } from "@/lib/workspace";
import {
  atualizarStatusDocumentoPendente,
  criarDocumentoPendente,
  subscribeDocumentosPendentes,
} from "@/lib/documentosPendentes";
import { calcularDiasAtraso, classificarUrgenciaCobranca } from "@/lib/arRecoveryEngine";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";

const CORES_URGENCIA: Record<NivelUrgenciaCobranca, string> = {
  "no-prazo": "bg-state-done-bg text-state-done",
  atencao: "bg-state-idle-bg text-state-idle",
  atraso: "bg-state-run-bg text-state-run",
  critico: "bg-state-error-bg text-state-error",
};

const ROTULO_URGENCIA: Record<NivelUrgenciaCobranca, string> = {
  "no-prazo": "no prazo",
  atencao: "atenção",
  atraso: "em atraso",
  critico: "crítico",
};

const PRIORIDADE_URGENCIA: Record<NivelUrgenciaCobranca, number> = {
  critico: 0,
  atraso: 1,
  atencao: 2,
  "no-prazo": 3,
};

export function ArRecoveryStatusPanel() {
  const { workspaceId } = useWorkspace();
  const [documentos, setDocumentos] = useState<DocumentoPendente[]>([]);
  const [referencia, setReferencia] = useState(() => new Date());
  const [formAberto, setFormAberto] = useState(false);
  const [referenciaDoc, setReferenciaDoc] = useState("");
  const [devedorNome, setDevedorNome] = useState("");
  const [vencimentoEm, setVencimentoEm] = useState("");
  const [processandoId, setProcessandoId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeDocumentosPendentes(setDocumentos, workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    const intervalo = setInterval(() => setReferencia(new Date()), 60_000);
    return () => clearInterval(intervalo);
  }, []);

  const linhas = useMemo(
    () =>
      documentos
        .filter((d) => d.status !== "pago" && d.status !== "cancelado")
        .map((documento) => ({
          documento,
          diasAtraso: calcularDiasAtraso(documento, referencia),
          nivel: classificarUrgenciaCobranca(calcularDiasAtraso(documento, referencia)),
        }))
        .sort((a, b) => PRIORIDADE_URGENCIA[a.nivel] - PRIORIDADE_URGENCIA[b.nivel]),
    [documentos, referencia]
  );

  const emRisco = linhas.filter((l) => l.nivel === "atraso" || l.nivel === "critico").length;

  async function handleCriar() {
    if (!referenciaDoc.trim() || !devedorNome.trim() || !vencimentoEm) return;
    setErro(null);
    try {
      await criarDocumentoPendente({
        tipo: "fatura",
        referencia: referenciaDoc.trim(),
        devedorNome: devedorNome.trim(),
        vencimentoEm: new Date(vencimentoEm).toISOString(),
        workspaceId: workspaceId ?? undefined,
      });
      setReferenciaDoc("");
      setDevedorNome("");
      setVencimentoEm("");
      setFormAberto(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível cadastrar o documento.");
    }
  }

  async function handleMarcarPago(documento: DocumentoPendente) {
    setProcessandoId(documento.id);
    setErro(null);
    try {
      await atualizarStatusDocumentoPendente(documento, "pago");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível atualizar o status.");
    } finally {
      setProcessandoId(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink-950">AR Recovery Engine</h3>
          <p className="mt-0.5 text-xs text-ink-400">
            {emRisco > 0 ? `${emRisco} documento(s) exigem atenção agora` : "Monitor de documentos/faturas pendentes"}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setFormAberto((v) => !v)}>
          {formAberto ? "Cancelar" : "Cadastrar documento"}
        </Button>
      </div>

      {formAberto && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-signal-500 bg-signal-50 p-3">
          <Field label="Referência" value={referenciaDoc} onChange={(e) => setReferenciaDoc(e.target.value)} placeholder="Ex.: NF-1234" />
          <Field label="Devedor" value={devedorNome} onChange={(e) => setDevedorNome(e.target.value)} />
          <Field label="Vencimento" type="date" value={vencimentoEm} onChange={(e) => setVencimentoEm(e.target.value)} />
          {erro && <p className="text-xs text-state-error">{erro}</p>}
          <Button size="sm" disabled={!referenciaDoc.trim() || !devedorNome.trim() || !vencimentoEm} onClick={handleCriar}>
            Salvar documento
          </Button>
        </div>
      )}

      {!formAberto && erro && <p className="text-xs text-state-error">{erro}</p>}

      {linhas.length === 0 ? (
        <EmptyState
          title="Nenhum documento pendente"
          description="Cadastre faturas/contratos com vencimento para o AR Recovery Engine monitorar."
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {linhas.map(({ documento, diasAtraso, nivel }) => (
            <li key={documento.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-ink-100 px-3 py-2">
              <div>
                <span className="text-sm font-semibold text-ink-950">
                  {documento.referencia} · {documento.devedorNome}
                </span>
                <p className="text-xs text-ink-500">
                  {documento.tentativasCobranca} tentativa(s) · {diasAtraso >= 0 ? `${diasAtraso} dia(s) de atraso` : "ainda não venceu"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", CORES_URGENCIA[nivel])}>
                  {ROTULO_URGENCIA[nivel]}
                </span>
                <Button size="sm" variant="secondary" loading={processandoId === documento.id} onClick={() => handleMarcarPago(documento)}>
                  Marcar como pago
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default ArRecoveryStatusPanel;
