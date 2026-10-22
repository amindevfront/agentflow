"use client";

// Painel de Governança — guardrails, transbordo, cofre e auditoria.
//
// Reúne os controles de conformidade em um só lugar porque, numa auditoria,
// eles são consultados juntos: "qual política barrou isso, quem revisou, com
// que credencial, e onde está o registro imutável".

import { useEffect, useState } from "react";
import { BusinessROIWidget } from "@/components/BusinessROIWidget";
import { AuditTrailPanel } from "@/components/governance/AuditTrailPanel";
import { CredentialVaultPanel } from "@/components/governance/CredentialVaultPanel";
import { GuardrailInspectorPanel } from "@/components/governance/GuardrailInspectorPanel";
import { HandoffQueuePanel } from "@/components/governance/HandoffQueuePanel";
import { RoiConfigPanel } from "@/components/governance/RoiConfigPanel";
import { SegmentedFilter } from "@/components/ui/SegmentedFilter";
import { drenarFilaAuditoria } from "@/lib/auditLog";

type Aba = "transbordo" | "guardrails" | "cofre" | "auditoria" | "parametros";

const ABAS: Array<{ valor: Aba; label: string }> = [
  { valor: "transbordo", label: "Transbordo" },
  { valor: "guardrails", label: "Guardrails" },
  { valor: "cofre", label: "Cofre" },
  { valor: "auditoria", label: "Auditoria" },
  { valor: "parametros", label: "Parâmetros" },
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
      <BusinessROIWidget compacto />

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
      {aba === "cofre" && <CredentialVaultPanel />}
      {aba === "auditoria" && <AuditTrailPanel />}
      {aba === "parametros" && <RoiConfigPanel />}
    </div>
  );
}
