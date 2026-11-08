"use client";

// UI injetada na Neural Inbox pela gaveta Logística — mesmo painel que antes
// vivia hardcoded sob `workspace?.setor === "logistica-portuaria"`.

import type { InboxModuleContext } from "../types";
import { CargoTriagePanel } from "@/components/niche/CargoTriagePanel";

export function LogisticsInboxExtras({ ultimaMensagemCliente, inserirNaResposta }: InboxModuleContext) {
  return <CargoTriagePanel textoParaExtrairCodigo={ultimaMensagemCliente} onInsertResposta={inserirNaResposta} />;
}
