"use client";

// Painel de Governança — guardrails, transbordo, cofre e auditoria.
//
// Reúne os controles de conformidade em um só lugar porque, numa auditoria,
// eles são consultados juntos: "qual política barrou isso, quem revisou, com
// que credencial, e onde está o registro imutável".

import { useEffect, useState } from "react";
import Link from "next/link";
import { BusinessROIWidget } from "@/components/BusinessROIWidget";
import { AiActReadinessPanel } from "@/components/governance/AiActReadinessPanel";
import { ArRecoveryStatusPanel } from "@/components/governance/ArRecoveryStatusPanel";
import { AuditTrailPanel } from "@/components/governance/AuditTrailPanel";
import { CompliancePreventivoPanel } from "@/components/governance/CompliancePreventivoPanel";
import { CredentialVaultPanel } from "@/components/governance/CredentialVaultPanel";
import { ExecutiveReportPanel } from "@/components/governance/ExecutiveReportPanel";
import { GlobalComplianceReadinessPanel } from "@/components/governance/GlobalComplianceReadinessPanel";
import { GuardrailInspectorPanel } from "@/components/governance/GuardrailInspectorPanel";
import { HandoffQueuePanel } from "@/components/governance/HandoffQueuePanel";
import { HealthScorePanel } from "@/components/governance/HealthScorePanel";
import { LgpdReadinessPanel } from "@/components/governance/LgpdReadinessPanel";
import { OpexTaxShieldPanel } from "@/components/governance/OpexTaxShieldPanel";
import { RoiConfigPanel } from "@/components/governance/RoiConfigPanel";
import { RoiOpportunityPanel } from "@/components/governance/RoiOpportunityPanel";
import { SimuladorContingenciaPanel } from "@/components/governance/SimuladorContingenciaPanel";
import { DocumentVaultPanel } from "@/components/niche/DocumentVaultPanel";
import { Banner } from "@/components/ui/Banner";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedFilter } from "@/components/ui/SegmentedFilter";
import { drenarFilaAuditoria } from "@/lib/auditLog";
import { precisaConfigurarNicho } from "@/lib/governanceGuards";
import { useWorkspace } from "@/lib/workspace";
import { useWorkspaceDoc } from "@/lib/queries/workspace";
import { obterIdsModulosAtivos } from "@/modules/registry";

type Aba =
  | "oportunidade"
  | "transbordo"
  | "guardrails"
  | "compliance"
  | "cofre"
  | "auditoria"
  | "opex"
  | "parametros"
  | "saude"
  | "ai-act"
  | "lgpd"
  | "global"
  | "backoffice";

const ABAS: Array<{ valor: Aba; label: string }> = [
  { valor: "oportunidade", label: "Oportunidade & Pipeline" },
  { valor: "transbordo", label: "Transbordo" },
  { valor: "guardrails", label: "Guardrails" },
  { valor: "compliance", label: "Compliance" },
  { valor: "cofre", label: "Cofre" },
  { valor: "auditoria", label: "Auditoria" },
  { valor: "opex", label: "Economia em Encargos" },
  { valor: "parametros", label: "Matriz de Lucro & Encargos" },
  { valor: "saude", label: "Health Score" },
  { valor: "ai-act", label: "EU AI Act" },
  { valor: "lgpd", label: "LGPD" },
  { valor: "global", label: "Global (GDPR/EUA)" },
  { valor: "backoffice", label: "Back-office" },
];

/** Link padrão para destravar uma gaveta de back-office desligada — mesmo texto nas duas (Document AI Vault / AR Recovery). */
function CtaAtivarEmConfiguracoes() {
  return (
    <Link href="/settings" className="text-xs font-medium text-signal-600 hover:underline">
      ir para Configurações → Gavetas extras
    </Link>
  );
}

export default function GovernancePage() {
  const [aba, setAba] = useState<Aba>("oportunidade");
  const { workspaceId, pendingSync } = useWorkspace();
  const { data: workspace, isLoading: workspaceCarregando } = useWorkspaceDoc(workspaceId);
  const idsModulosAtivos = obterIdsModulosAtivos(workspace);
  const documentAiVaultAtivo = idsModulosAtivos.includes("document-ai-vault");
  const arRecoveryAtivo = idsModulosAtivos.includes("ar-recovery-engine");

  // Guia de 4 Passos (Configurações → Fluxo → Sandbox → Governança):
  // quem pula direto para a Governança por URL, sem nunca ter passado por
  // Configurações, não tem `setor` gravado — em vez de deixar cada painel
  // (Oportunidade & Pipeline, Back-office, etc.) mostrar isso como se fosse
  // um erro próprio e desconectado, um único aviso no topo já explica a
  // causa real e guia de volta (lógica em `@/lib/governanceGuards`, testável
  // sem DOM).
  const mostrarAvisoNicho = precisaConfigurarNicho({ pendingSync, workspaceCarregando, workspace });

  useEffect(() => {
    // Eventos de auditoria que ficaram presos na fila local (queda de rede,
    // sessão expirada) são reenviados ao abrir o painel de governança.
    drenarFilaAuditoria().catch((erro) =>
      console.error("[auditoria] reenvio automático falhou:", erro)
    );
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {mostrarAvisoNicho && (
        <Banner
          action={
            <Link href="/settings" className="text-sm font-medium underline">
              ir para Configurações
            </Link>
          }
        >
          Defina o nicho do seu negócio em Configurações antes de usar a Governança — é o que liga os painéis certos
          para o seu tipo de empresa.
        </Banner>
      )}

      <div className="flex items-start justify-between gap-3">
        <BusinessROIWidget compacto className="flex-1" />
        <ExecutiveReportPanel />
      </div>

      <nav aria-label="Seções de governança">
        <SegmentedFilter
          rotuloGrupo="Seções de governança"
          opcoes={ABAS}
          selecionado={aba}
          onChange={setAba}
        />
      </nav>

      {aba === "oportunidade" && <RoiOpportunityPanel />}
      {aba === "transbordo" && <HandoffQueuePanel />}
      {aba === "guardrails" && <GuardrailInspectorPanel />}
      {aba === "compliance" && <CompliancePreventivoPanel />}
      {aba === "cofre" && <CredentialVaultPanel />}
      {aba === "auditoria" && <AuditTrailPanel />}
      {aba === "opex" && <OpexTaxShieldPanel />}
      {aba === "parametros" && (
        <div className="flex flex-col gap-4">
          <SimuladorContingenciaPanel />
          <RoiConfigPanel />
        </div>
      )}
      {aba === "saude" && <HealthScorePanel />}
      {aba === "ai-act" && <AiActReadinessPanel />}
      {aba === "lgpd" && <LgpdReadinessPanel />}
      {aba === "global" && <GlobalComplianceReadinessPanel />}
      {aba === "backoffice" && (
        <div className="flex flex-col gap-4">
          {documentAiVaultAtivo ? (
            <DocumentVaultPanel />
          ) : (
            <EmptyState
              title="Document AI Vault desligado"
              description="Ligue esta gaveta para analisar contratos e extrair cláusulas críticas."
              action={<CtaAtivarEmConfiguracoes />}
            />
          )}
          {arRecoveryAtivo ? (
            <ArRecoveryStatusPanel />
          ) : (
            <EmptyState
              title="AR Recovery Engine desligado"
              description="Ligue esta gaveta para monitorar faturas/documentos vencidos e disparar cobrança humanizada."
              action={<CtaAtivarEmConfiguracoes />}
            />
          )}
        </div>
      )}
    </div>
  );
}
