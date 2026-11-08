"use client";

// UI injetada na Neural Inbox pela gaveta E-commerce — mesmo painel que antes
// vivia hardcoded sob `workspace?.setor === "ecommerce"`. Painel
// autossuficiente (lê o workspace via seu próprio `useWorkspace`), por isso
// ignora o `InboxModuleContext` recebido.

import { ChargebackRiskPanel } from "@/components/niche/ChargebackRiskPanel";

export function EcommerceInboxExtras() {
  return <ChargebackRiskPanel />;
}
