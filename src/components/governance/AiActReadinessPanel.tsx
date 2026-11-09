"use client";

// Relatório de Prontidão para Regulação de IA (EU AI Act e equivalentes).
//
// Mesma fonte de dados em tempo real dos demais painéis de Governança —
// trilha de auditoria (`AuditTrailPanel`) e fila de transbordo
// (`HandoffQueuePanel`). Este painel não introduz nenhum dado novo, só
// reavalia o que já existe contra o checklist de `@/lib/aiActReadiness`.
//
// A verificação de integridade da cadeia exige uma chamada ao servidor
// (conferência do HMAC) — por isso começa como "sem_dados" até o operador
// clicar em "Verificar integridade", igual ao `AuditTrailPanel`.

import { useEffect, useMemo, useState } from "react";
import type { AuditChainVerification, AuditEntry, HandoffTicket } from "@/types";
import { registrarEventoAuditoriaSilencioso, subscribeTrilhaAuditoria, verificarTrilhaAuditoria } from "@/lib/auditLog";
import { estatisticasFila, subscribeFilaTransbordo } from "@/lib/humanInTheLoop";
import { avaliarProntidaoAiAct, type StatusItemProntidao } from "@/lib/aiActReadiness";
import { useWorkspace } from "@/lib/workspace";
import { auth } from "@/lib/firebase";
import { reportarErro } from "@/lib/telemetry/errorReporting";
import { Button } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/MetricCard";
import { cn } from "@/lib/utils";

function acionarDownload(bytes: Uint8Array, nomeArquivo: string): void {
  // `pdf-lib` devolve `Uint8Array<ArrayBufferLike>` — o construtor de `Blob`
  // exige um buffer concreto (`ArrayBuffer`), daí a cópia explícita.
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

// Teto alto de leitura só para esta estimativa de retenção: quanto mais
// entradas couberem na janela carregada, mais perto a "primeira entrada"
// observada fica da primeira entrada REAL. Se o workspace tiver mais eventos
// que este teto, a estimativa de retenção é conservadora — subestima os dias
// cobertos, nunca sobre-estima (ver `@/lib/aiActReadiness`).
const TETO_LEITURA_PARA_RETENCAO = 2000;

const ROTULO_STATUS: Record<StatusItemProntidao, string> = {
  atende: "atende",
  em_formacao: "em formação",
  nao_atende: "não atende",
  sem_dados: "sem dados ainda",
  fora_do_escopo: "fora do escopo do software",
};

const CORES_STATUS: Record<StatusItemProntidao, string> = {
  atende: "bg-state-done-bg text-state-done",
  em_formacao: "bg-state-run-bg text-state-run",
  nao_atende: "bg-state-error-bg text-state-error",
  sem_dados: "bg-state-idle-bg text-state-idle",
  fora_do_escopo: "bg-mist-50 text-ink-500",
};

export function AiActReadinessPanel() {
  const { workspaceId, appUser } = useWorkspace();
  const [entradas, setEntradas] = useState<AuditEntry[]>([]);
  const [tickets, setTickets] = useState<HandoffTicket[]>([]);
  const [verificacao, setVerificacao] = useState<AuditChainVerification | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    const cancelamentos = [
      subscribeTrilhaAuditoria(setEntradas, {
        workspaceId,
        limite: TETO_LEITURA_PARA_RETENCAO,
        onError: () => setErro("Não foi possível carregar a trilha de auditoria agora."),
      }),
      subscribeFilaTransbordo(setTickets, { workspaceId, limite: 300 }),
    ];
    return () => cancelamentos.forEach((cancelar) => cancelar());
  }, [workspaceId]);

  const ticketStats = useMemo(() => estatisticasFila(tickets), [tickets]);
  // `subscribeTrilhaAuditoria` entrega da mais recente para a mais antiga —
  // a última posição do array é a entrada mais antiga carregada.
  const primeiraEntradaEm = entradas.length > 0 ? entradas[entradas.length - 1].corpo.ocorridoEm : null;

  const resultado = useMemo(
    () =>
      avaliarProntidaoAiAct({
        totalEntradasAuditoria: entradas.length,
        primeiraEntradaEm,
        verificacaoCadeia: verificacao,
        ticketStats,
      }),
    [entradas.length, primeiraEntradaEm, verificacao, ticketStats]
  );

  async function handleVerificar() {
    setErro(null);
    setVerificando(true);
    try {
      const { verificacao: resultadoVerificacao } = await verificarTrilhaAuditoria(entradas);
      setVerificacao(resultadoVerificacao);
    } catch (e) {
      reportarErro(e, "ai-act:verificar-trilha");
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
        tipo: "relatorio.prontidao.gerado",
        recurso: "relatorio-prontidao-ai-act",
        workspaceId,
        detalhes: {
          totalAtende: resultado.totalAtende,
          totalAvaliavelPorSoftware: resultado.totalAvaliavelPorSoftware,
          diasRetencaoDemonstrados: resultado.diasRetencaoDemonstrados ?? -1,
        },
      });

      // `pdf-lib` só é carregado quando o download é de fato acionado — mesmo
      // padrão de `ExecutiveReportPanel` (mantém o bundle da Governança leve).
      const { gerarRelatorioProntidaoAiActPdf } = await import("@/lib/reports/aiActReadinessPdf");
      const bytes = await gerarRelatorioProntidaoAiActPdf({
        workspaceId,
        resultado,
        geradoEm: new Date().toISOString(),
        geradoPor: appUser?.email ?? auth?.currentUser?.email ?? "usuário autenticado",
      });

      acionarDownload(bytes, `agentflow-prontidao-ai-act-${workspaceId}.pdf`);
    } catch (e) {
      reportarErro(e, "ai-act:baixar-pdf");
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
          dos controles que o AgentFlow já oferece e que se relacionam diretamente ao Artigo 12 do AI Act
          (registro, integridade e retenção de eventos). Itens marcados como &ldquo;fora do escopo do software&rdquo;
          continuam sendo decisão e responsabilidade do cliente/seu jurídico — nenhum software determina sozinho se
          um caso de uso é &ldquo;alto risco&rdquo;.
        </div>
        <Button size="sm" variant="secondary" loading={gerandoPdf} onClick={handleBaixarPdf} disabled={!workspaceId} className="flex-none">
          Baixar Relatório PDF
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          rotulo="Controles técnicos atendidos"
          valor={`${resultado.totalAtende}/${resultado.totalAvaliavelPorSoftware}`}
          detalhe="avaliáveis pelo software, exclui itens fora do escopo"
          tom={resultado.totalAtende === resultado.totalAvaliavelPorSoftware ? "positivo" : "atencao"}
        />
        <MetricCard
          rotulo="Retenção de auditoria demonstrada"
          valor={resultado.diasRetencaoDemonstrados !== null ? `${resultado.diasRetencaoDemonstrados} dias` : "—"}
          detalhe="mínimo exigido pelo Art. 12: 180 dias (6 meses)"
          tom={
            resultado.diasRetencaoDemonstrados === null
              ? "neutro"
              : resultado.diasRetencaoDemonstrados >= 180
                ? "positivo"
                : "atencao"
          }
        />
        <MetricCard
          rotulo="Integridade da cadeia"
          valor={verificacao === null ? "não verificada" : verificacao.integra ? "íntegra" : "com problema"}
          detalhe={verificacao === null ? "clique em verificar abaixo" : `${verificacao.entradasVerificadas} entrada(s)`}
          tom={verificacao === null ? "neutro" : verificacao.integra ? "positivo" : "erro"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" loading={verificando} onClick={handleVerificar} disabled={entradas.length === 0}>
          Verificar integridade da cadeia
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

export default AiActReadinessPanel;
