"use client";

// Relatório de Prontidão Internacional — GDPR (União Europeia) e Privacidade
// nos EUA — par de `LgpdReadinessPanel`/`AiActReadinessPanel` pra Expansão
// Enterprise Global (Multi-Região & Multi-Canal). Mesma fonte de dados em
// tempo real (trilha de auditoria), mesmo disclaimer de "não é certificado
// de conformidade" — ver `@/lib/internationalReadiness` pra o racional
// completo de por que GDPR e "US Privacy" são avaliados separadamente, e por
// que o segundo nunca cita "CCPA" sozinho.

import { useEffect, useMemo, useState } from "react";
import type { AuditChainVerification, AuditEntry } from "@/types";
import { registrarEventoAuditoriaSilencioso, subscribeTrilhaAuditoria, verificarTrilhaAuditoria } from "@/lib/auditLog";
import {
  avaliarProntidaoGdpr,
  avaliarProntidaoUsPrivacy,
  type ProntidaoInternacionalResultado,
  type StatusItemProntidaoInternacional,
} from "@/lib/internationalReadiness";
import { useWorkspace } from "@/lib/workspace";
import { auth } from "@/lib/firebase";
import { reportarErro } from "@/lib/telemetry/errorReporting";
import { Button } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/MetricCard";
import { cn } from "@/lib/utils";

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

const ROTULO_STATUS: Record<StatusItemProntidaoInternacional, string> = {
  atende: "atende",
  nao_atende: "não atende",
  sem_dados: "sem dados ainda",
  fora_do_escopo: "fora do escopo",
};

const CORES_STATUS: Record<StatusItemProntidaoInternacional, string> = {
  atende: "bg-state-done-bg text-state-done",
  nao_atende: "bg-state-error-bg text-state-error",
  sem_dados: "bg-state-idle-bg text-state-idle",
  fora_do_escopo: "bg-mist-50 text-ink-500",
};

interface SecaoProps {
  titulo: string;
  resultado: ProntidaoInternacionalResultado;
  verificacao: AuditChainVerification | null;
  gerando: boolean;
  onBaixarPdf: () => void;
}

function SecaoChecklist({ titulo, resultado, verificacao, gerando, onBaixarPdf }: SecaoProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink-950">{titulo}</h3>
        <Button size="sm" variant="secondary" loading={gerando} onClick={onBaixarPdf} className="flex-none">
          Baixar PDF
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
          detalhe={verificacao === null ? "verifique na aba Auditoria" : `${verificacao.entradasVerificadas} entrada(s)`}
          tom={verificacao === null ? "neutro" : verificacao.integra ? "positivo" : "erro"}
        />
      </div>

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

export function GlobalComplianceReadinessPanel() {
  const { workspaceId, appUser } = useWorkspace();
  const [entradas, setEntradas] = useState<AuditEntry[]>([]);
  const [verificacao, setVerificacao] = useState<AuditChainVerification | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [gerandoGdpr, setGerandoGdpr] = useState(false);
  const [gerandoUs, setGerandoUs] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeTrilhaAuditoria(setEntradas, {
      workspaceId,
      limite: TETO_LEITURA,
      onError: () => setErro("Não foi possível carregar a trilha de auditoria agora."),
    });
  }, [workspaceId]);

  const resultadoGdpr = useMemo(
    () => avaliarProntidaoGdpr({ totalEntradasAuditoria: entradas.length, verificacaoCadeia: verificacao }),
    [entradas.length, verificacao]
  );
  const resultadoUs = useMemo(
    () => avaliarProntidaoUsPrivacy({ totalEntradasAuditoria: entradas.length, verificacaoCadeia: verificacao }),
    [entradas.length, verificacao]
  );

  async function handleVerificar() {
    setErro(null);
    setVerificando(true);
    try {
      const { verificacao: resultado } = await verificarTrilhaAuditoria(entradas);
      setVerificacao(resultado);
    } catch (e) {
      reportarErro(e, "compliance-global:verificar-trilha");
      setErro("Não foi possível verificar a integridade da trilha agora. Tente novamente em alguns instantes.");
    } finally {
      setVerificando(false);
    }
  }

  async function baixarPdf(regime: "gdpr" | "us-privacy") {
    if (!workspaceId) return;
    const setGerando = regime === "gdpr" ? setGerandoGdpr : setGerandoUs;
    const resultado = regime === "gdpr" ? resultadoGdpr : resultadoUs;
    setErro(null);
    setGerando(true);
    try {
      await registrarEventoAuditoriaSilencioso({
        tipo: "relatorio.compliance-global.gerado",
        recurso: `relatorio-prontidao-${regime}`,
        workspaceId,
        detalhes: {
          regime,
          totalAtende: resultado.totalAtende,
          totalAvaliavelPorSoftware: resultado.totalAvaliavelPorSoftware,
        },
      });

      const { gerarRelatorioProntidaoPdf } = await import("@/lib/reports/lgpdReadinessPdf");
      const geradoPor = appUser?.email ?? auth?.currentUser?.email ?? "usuário autenticado";
      const geradoEm = new Date().toISOString();

      const bytes =
        regime === "gdpr"
          ? await gerarRelatorioProntidaoPdf({
              workspaceId,
              resultado,
              geradoEm,
              geradoPor,
              tituloRelatorio: "Relatório de Prontidão — GDPR",
              subtituloRegime: "GDPR — Regulamento (UE) 2016/679",
              textoAviso:
                "Isto não é um certificado de conformidade. É um checklist técnico dos controles que o AgentFlow já " +
                "oferece, mapeados a obrigações do GDPR (registro de tratamento, segurança, minimização de dados). " +
                "Itens fora do escopo do software continuam sendo decisão e responsabilidade do controlador — o cliente.",
              tituloDocumento: "AgentFlow — Relatório de Prontidão GDPR",
              assuntoDocumento: "GDPR — checklist de controles técnicos",
            })
          : await gerarRelatorioProntidaoPdf({
              workspaceId,
              resultado,
              geradoEm,
              geradoPor,
              tituloRelatorio: "Relatório de Prontidão — Privacidade (EUA)",
              subtituloRegime: "Leis estaduais de privacidade dos EUA (ex.: CCPA/CPRA)",
              textoAviso:
                "Isto não é um certificado de conformidade com CCPA, CPRA ou qualquer lei estadual específica — cada " +
                "estado dos EUA tem escopo e limiares próprios. É um checklist técnico dos controles que o AgentFlow " +
                "já oferece e que se relacionam a direitos comuns a essas leis (minimização, segurança, canal de " +
                "comunicação). Itens fora do escopo do software continuam sendo decisão do negócio do cliente.",
              tituloDocumento: "AgentFlow — Relatório de Prontidão de Privacidade (EUA)",
              assuntoDocumento: "Privacidade EUA — checklist de controles técnicos",
            });

      acionarDownload(bytes, `agentflow-prontidao-${regime}-${workspaceId}.pdf`);
    } catch (e) {
      reportarErro(e, "compliance-global:baixar-pdf");
      setErro("Não foi possível gerar o relatório agora. Tente novamente em alguns instantes.");
    } finally {
      setGerando(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[var(--radius-md)] border border-signal-500 bg-signal-50 p-3 text-xs text-ink-700">
        <strong className="text-ink-950">Isto não é um certificado de conformidade.</strong> São dois checklists
        técnicos — GDPR (União Europeia) e Privacidade nos EUA — dos controles que o AgentFlow já oferece. Conformidade
        legal é sempre do controlador (o cliente), nunca do software sozinho.
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" loading={verificando} onClick={handleVerificar} disabled={entradas.length === 0}>
          Verificar integridade do registro
        </Button>
        <span className="text-xs text-ink-400">Confere hash-chain e assinatura HMAC antes de declarar qualquer item como atendido.</span>
      </div>

      {erro && <p className="text-xs text-state-error">{erro}</p>}

      <SecaoChecklist
        titulo="GDPR (União Europeia)"
        resultado={resultadoGdpr}
        verificacao={verificacao}
        gerando={gerandoGdpr}
        onBaixarPdf={() => baixarPdf("gdpr")}
      />

      <div className="border-t border-ink-100" />

      <SecaoChecklist
        titulo="Privacidade nos EUA (ex.: CCPA/CPRA na Califórnia e leis estaduais similares)"
        resultado={resultadoUs}
        verificacao={verificacao}
        gerando={gerandoUs}
        onBaixarPdf={() => baixarPdf("us-privacy")}
      />
    </div>
  );
}

export default GlobalComplianceReadinessPanel;
