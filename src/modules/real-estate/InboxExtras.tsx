"use client";

// UI injetada na Neural Inbox pela gaveta Imobiliário/Construtoras.
// Mesmos dois painéis que antes viviam hardcoded em `NeuralInbox.tsx` sob
// `workspace?.setor === "construtora-imobiliaria"` — só realocados para a
// gaveta, comportamento idêntico.

import type { InboxModuleContext } from "../types";
import { NicheAttachmentsPanel } from "@/components/niche/NicheAttachmentsPanel";
import { DistratoRiskPanel } from "@/components/niche/DistratoRiskPanel";

export function RealEstateInboxExtras({ inserirNaResposta }: InboxModuleContext) {
  return (
    <>
      <section className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
        <NicheAttachmentsPanel onInsert={inserirNaResposta} />
      </section>
      <DistratoRiskPanel />
    </>
  );
}
