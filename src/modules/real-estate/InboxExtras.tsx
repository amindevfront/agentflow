"use client";

// UI injetada na Neural Inbox pela gaveta Imobiliário/Construtoras.
//
// Ordem deliberada: o Handover de Alto Ticket vem PRIMEIRO porque é o único
// painel que pode encerrar a autonomia do agente na conversa aberta (ver
// `HighTicketHandoverPanel`) — quando um lead pede proposta, o operador
// precisa ver isso antes de qualquer outra coisa, não depois de rolar a
// coluna inteira.

import type { InboxModuleContext } from "../types";
import { HighTicketHandoverPanel } from "@/components/niche/HighTicketHandoverPanel";
import { NicheAttachmentsPanel } from "@/components/niche/NicheAttachmentsPanel";
import { DistratoRiskPanel } from "@/components/niche/DistratoRiskPanel";

export function RealEstateInboxExtras(contexto: InboxModuleContext) {
  return (
    <>
      <HighTicketHandoverPanel {...contexto} />
      <section className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
        <NicheAttachmentsPanel onInsert={contexto.inserirNaResposta} />
      </section>
      <DistratoRiskPanel />
    </>
  );
}
