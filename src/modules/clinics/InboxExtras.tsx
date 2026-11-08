"use client";

// UI injetada na Neural Inbox pela gaveta Clínicas — mesmo painel que antes
// vivia hardcoded sob `workspace?.setor === "clinica-alto-padrao" || "clinica-medica-exames"`.

import type { InboxModuleContext } from "../types";
import { AppointmentRemindersPanel } from "@/components/niche/AppointmentRemindersPanel";

export function ClinicsInboxExtras({ conversaSelecionada }: InboxModuleContext) {
  return <AppointmentRemindersPanel conversaSelecionada={conversaSelecionada} />;
}
