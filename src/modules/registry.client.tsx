"use client";

// Registro CLIENTE da UI injetada por gaveta (`InboxExtras`) — par do
// registro server-safe em `./registry.ts`.
//
// Separado deliberadamente: `./registry.ts` é importado por código
// SERVER-ONLY (`@/lib/server/roiDashboard`), que nunca deve puxar
// componentes React (hooks de cliente, `useWorkspace`, etc.) para o seu
// bundle. Este arquivo só é importado por componentes "use client"
// (hoje, só `NeuralInbox`).
//
// `tests/moduleRegistry.test.ts` confere que toda gaveta com
// `temInboxExtras: true` em `./registry.ts` tem uma entrada correspondente
// aqui — as duas listas não podem divergir silenciosamente.

import type { ComponentType } from "react";
import type { NicheKey } from "@/types";
import type { InboxModuleContext } from "./types";
import { RealEstateInboxExtras } from "./real-estate/InboxExtras";
import { ClinicsInboxExtras } from "./clinics/InboxExtras";
import { LogisticsInboxExtras } from "./logistics/InboxExtras";
import { EcommerceInboxExtras } from "./ecommerce/InboxExtras";
import { UsRealEstateLuxuryInboxExtras } from "./us-real-estate-luxury/InboxExtras";
import { UsConstructionRemodelingInboxExtras } from "./us-construction-remodeling/InboxExtras";
import { SheetReconciliationInboxExtras } from "./sheet-reconciliation/InboxExtras";

export const INBOX_EXTRAS_REGISTRY: Partial<Record<NicheKey, ComponentType<InboxModuleContext>>> = {
  "construtora-imobiliaria": RealEstateInboxExtras,
  "clinica-alto-padrao": ClinicsInboxExtras,
  "clinica-medica-exames": ClinicsInboxExtras,
  "logistica-portuaria": LogisticsInboxExtras,
  ecommerce: EcommerceInboxExtras,
  // --- Expansão Enterprise Global (EUA/Flórida e Portugal) ---
  "us-real-estate-luxury": UsRealEstateLuxuryInboxExtras,
  "us-construction-remodeling": UsConstructionRemodelingInboxExtras,
  // Reaproveita a MESMA UI de Inbox do Vertical 2 (BR) — ver nota em
  // `@/modules/portugal-clinics-health/index.ts`.
  "portugal-clinics-health": ClinicsInboxExtras,
  // --- Full-Scope Enterprise Operations (gavetas de back-office) ---
  // `document-ai-vault`/`ar-recovery-engine` não entram aqui: são painéis
  // standalone/de Governança, não widgets de Neural Inbox — ver
  // `temInboxExtras: false` em seus respectivos `index.ts`.
  "sheet-reconciliation": SheetReconciliationInboxExtras,
};

/**
 * Componentes `InboxExtras` das gavetas ativas, deduplicados e na mesma
 * ordem de `ids` — consumido por `NeuralInbox` para renderizar a UI
 * específica de cada módulo ativo do workspace, sem nenhum `if` por nicho
 * na própria tela.
 */
export function obterInboxExtras(ids: NicheKey[]): ComponentType<InboxModuleContext>[] {
  const vistos = new Set<ComponentType<InboxModuleContext>>();
  const resultado: ComponentType<InboxModuleContext>[] = [];
  for (const id of ids) {
    const Componente = INBOX_EXTRAS_REGISTRY[id];
    if (Componente && !vistos.has(Componente)) {
      vistos.add(Componente);
      resultado.push(Componente);
    }
  }
  return resultado;
}
