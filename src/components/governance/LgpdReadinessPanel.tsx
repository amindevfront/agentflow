"use client";

// Relatório de Prontidão para Regulação Brasileira (LGPD).
//
// Mesma fonte de dados em tempo real do `AiActReadinessPanel`/`AuditTrailPanel`
// — trilha de auditoria. Este painel não introduz nenhum dado novo, só
// reavalia o que já existe contra o checklist de `@/lib/lgpdReadiness`.
//
// A verificação de integridade da cadeia exige uma chamada ao servidor
// (conferência do HMAC) — por isso começa como "sem_dados" até o operador
// clicar em "Verificar integridade", igual aos demais painéis de auditoria.

import { useEffect, useMemo, useState } from "react";
import type { AuditChainVerification, AuditEntry } from "@/types";
import { registrarEventoAuditoriaSilencioso, subscribeTrilhaAuditoria, verificarTrilhaAuditoria } from "@/lib/auditLog";
import { avaliarProntidaoLgpd, type StatusItemProntidaoLgpd } from "@/lib/lgpdReadiness";
import { useWorkspace } from "@/lib/workspace";
import { auth } from "@/lib/firebase";
import { reportarErro } from "@/lib/telemetry/errorReporting";
import { Button } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/MetricCard";
import { cn } from "@/lib/utils";

// Mesmo teto de leitura de `AiActReadinessPanel` — só para o registro geral
// de operações; aqui não há uma noção de "retenção mínima" (diferente do
// AI Act, a LGPD pede minimização/eliminação, não um piso de dias), então
// o volume de entradas carregadas basta.
const TETO_LEITURA = 2000;

function acionarDownload(bytes: Uint8Array, nomeArquivo: string): void {
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const ROTULO_STATUS: Record<StatusItemProntidaoLgpd, string> = {
  atende: "atende",
  nao_atende: "não atende",
  sem_dados: "sem dados ainda",
  fora_do_escopo: "fora do escopo do software",
};

const CORES_STATUS: Record<StatusItemProntidaoLgpd, string> = {
  atende: "bg-state-done-bg text-state-done",
  nao_atende: "bg-state-error-bg text-state-error",
  sem_dados: "bg-state-idle-bg text-state-idle",
  fora_do_escopo: "bg-mist-50 text-ink-500",
};

export function LgpdReadinessPanel() {
  const { workspaceId, appUser } = useWorkspace();
  const [entradas, setEntradas] = useState<AuditEntry[]>([]);
  const [verificacao, setVerificacao] = useState<AuditChainVerification | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeTrilhaAuditoria(setEntradas, {
      workspaceId,
      limite: TETO_LEITURA,
      onError: () => setErro("Não foi possível carregar a trilha de auditoria agora."),
    });
  }, [workspaceId]);

  const resultado = useMemo(
    () => avaliarProntidaoLgpd({ totalEntradasAuditoria: entradas.length, verificacaoCadeia: verificacao }),
    [entradas.length, verificacao]
  );

  async function handleVerificar() {
    setErro(null);
    setVerificando(true);
    try {
      const { verificacao: resultadoVerificacao } = await verificarTrilhaAuditoria(entradas);
      setVerificacao(resultadoVerificacao);
    } catch (e) {
      reportarErro(e, "lgpd:verificar-trilha");
      setErro("Não foi possível verificar a integridade da trilha agora. Tente novamente em alguns instantes.");
    } finally {
      setVerificando(false);
    }
  }

  async function handleBaixarPdf() {
    if (!workspaceId) return;
    setErro(null);
    setGerandoPdf(true);
    try {
      await registrarEventoAuditoriaSilencioso({
        tipo: "relatorio.lgpd.gerado",
        recurso: "relatorio-prontidao-lgpd",
        workspaceId,
        detalhes: {
          totalAtende: resultado.totalAtende,
          totalAvaliavelPorSoftware: resultado.totalAvaliavelPorSoftware,
        },
      });

      // `pdf-lib` só é carregado quando o download é de fato acionado — mesmo
      // padrão de `AiActReadinessPanel`/`ExecutiveReportPanel`.
      const { gerarRelatorioProntidaoLgpdPdf } = await import("@/lib/reports/lgpdReadinessPdf");
      const bytes = await gerarRelatorioProntidaoLgpdPdf({
        workspaceId,
        resultado,
        geradoEm: new Date().toISOString(),
        geradoPor: appUser?.email ?? auth?.currentUser?.email ?? "usuário autenticado",
      });

      acionarDownload(bytes, `agentflow-prontidao-lgpd-${workspaceId}.pdf`);
    } catch (e) {
      reportarErro(e, "lgpd:baixar-pdf");
      setErro("Não foi possível gerar o relatório de prontidão agora. Tente novamente em alguns instantes.");
    } finally {
      setGerandoPdf(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-[var(--radius-md)] border border-signal-500 bg-signal-50 p-3 text-xs text-ink-700">
          <strong className="text-ink-950">Isto não é um certificado de conformidade.</strong> É um checklist técnico
          dos controles que o AgentFlow já oferece e que se relacionam diretamente a obrigações da LGPD (registro de
          operações, segurança, minimização de dados). Itens marcados como &ldquo;fora do escopo do software&rdquo;
          continuam sendo decisão e responsabilidade do controlador (o cliente) — base legal, encarregado, RIPD e
          comunicação de incidente à ANPD nenhum software decide sozinho.
        </div>
        <Button size="sm" variant="secondary" loading={gerandoPdf} onClick={handleBaixarPdf} disabled={!workspaceId} className="flex-none">
          Baixar Relatório PDF
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <MetricCard
          rotulo="Controles técnicos atendidos"
          valor={`${resultado.totalAtende}/${resultado.totalAvaliavelPorSoftware}`}
          detalhe="avaliáveis pelo software, exclui itens fora do escopo"
          tom={resultado.totalAtende === resultado.totalAvaliavelPorSoftware ? "positivo" : "atencao"}
        />
        <MetricCard
          rotulo="Integridade do registro"
          valor={verificacao === null ? "não verificada" : verificacao.integra ? "íntegro" : "com problema"}
          detalhe={verificacao === null ? "clique em verificar abaixo" : `${verificacao.entradasVerificadas} entrada(s)`}
          tom={verificacao === null ? "neutro" : verificacao.integra ? "positivo" : "erro"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" loading={verificando} onClick={handleVerificar} disabled={entradas.length === 0}>
          Verificar integridade do registro
        </Button>
        <span className="text-xs text-ink-400">Confere hash-chain e assinatura HMAC antes de declarar o item como atendido.</span>
      </div>

      {erro && <p className="text-xs text-state-error">{erro}</p>}

      <ul className="flex flex-col gap-1.5">
        {resultado.itens.map((item) => (
          <li key={item.id} className="flex flex-col gap-1 rounded-[var(--radius-sm)] border border-ink-100 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-ink-950">{item.titulo}</span>
              <span className={cn("flex-none rounded-full px-2.5 py-1 text-[11px] font-medium", CORES_STATUS[item.status])}>
                {ROTULO_STATUS[item.status]}
              </span>
            </div>
            {item.baseLegal && <span className="mono text-[11px] text-signal-700">{item.baseLegal}</span>}
            <p className="text-xs text-ink-500">{item.detalhe}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default LgpdReadinessPanel;
