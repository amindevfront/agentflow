"use client";

// Painel de Governança — guardrails, transbordo, cofre e auditoria.
//
// Reúne os controles de conformidade em um só lugar porque, numa auditoria,
// eles são consultados juntos: "qual política barrou isso, quem revisou, com
// que credencial, e onde está o registro imutável".

import { useEffect, useState } from "react";
import { BusinessROIWidget } from "@/components/BusinessROIWidget";
import { AuditTrailPanel } from "@/components/governance/AuditTrailPanel";
import { CompliancePreventivoPanel } from "@/components/governance/CompliancePreventivoPanel";
import { CredentialVaultPanel } from "@/components/governance/CredentialVaultPanel";
import { ExecutiveReportPanel } from "@/components/governance/ExecutiveReportPanel";
import { GuardrailInspectorPanel } from "@/components/governance/GuardrailInspectorPanel";
import { HandoffQueuePanel } from "@/components/governance/HandoffQueuePanel";
import { OpexTaxShieldPanel } from "@/components/governance/OpexTaxShieldPanel";
import { RoiConfigPanel } from "@/components/governance/RoiConfigPanel";
import { SimuladorContingenciaPanel } from "@/components/governance/SimuladorContingenciaPanel";
import { SegmentedFilter } from "@/components/ui/SegmentedFilter";
import { drenarFilaAuditoria } from "@/lib/auditLog";

type Aba = "transbordo" | "guardrails" | "compliance" | "cofre" | "auditoria" | "opex" | "parametros";

const ABAS: Array<{ valor: Aba; label: string }> = [
  { valor: "transbordo", label: "Transbordo" },
  { valor: "guardrails", label: "Guardrails" },
  { valor: "compliance", label: "Compliance" },
  { valor: "cofre", label: "Cofre" },
  { valor: "auditoria", label: "Auditoria" },
  { valor: "opex", label: "OpEx & Tax Shield" },
  { valor: "parametros", label: "Matriz de Lucro & Encargos" },
];

export default function GovernancePage() {
  const [aba, setAba] = useState<Aba>("transbordo");

  useEffect(() => {
    // Eventos de auditoria que ficaram presos na fila local (queda de rede,
    // sessão expirada) são reenviados ao abrir o painel de governança.
    drenarFilaAuditoria().catch((erro) =>
      console.error("[auditoria] reenvio automático falhou:", erro)
    );
  }, []);

  return (
    <div className="flex flex-col gap-4">
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
    </div>
  );
}
