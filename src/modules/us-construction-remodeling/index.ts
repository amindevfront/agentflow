// Gaveta Internacional — Construtoras, Reformas de Alto Padrão & Empreiteiras
// (EUA/Flórida).
//
// SERVER-SAFE (ver nota em `@/modules/us-real-estate-luxury/index.ts`).
// Mesma política reaproveitada (`POLITICA_IMOBILIARIO_ALTO_PADRAO`): um
// orçamento de reforma fechado antes da visita presencial é o mesmo risco
// financeiro de "valor de tabela sem validação da diretoria".

import { POLITICA_IMOBILIARIO_ALTO_PADRAO } from "@/lib/guardrails/policy";
import type { VerticalModuleDefinition } from "../types";

export const US_CONSTRUCTION_REMODELING_MODULE: VerticalModuleDefinition = {
  id: "us-construction-remodeling",
  nome: "US Construction & Remodeling Contractors (Florida)",
  descricao:
    "High-value lead qualification in USD, urgency-based aggressive follow-up and automated preliminary (non-binding) estimate ranges.",
  guardrailPolicyId: POLITICA_IMOBILIARIO_ALTO_PADRAO.id,
  moeda: "USD",
  // Valor médio ESTIMADO de oportunidade por visita de estimativa confirmada
  // — valor de partida conservador, ver nota equivalente em
  // `@/modules/us-real-estate-luxury/index.ts`.
  valorMedioPipelineMoedaLocal: 8_000,
  // 8_000 × 5.4 (câmbio de referência de `ROI_CONFIG_PADRAO.cambioUsdBrl`) = 43_200.
  valorMedioPipelineBrl: 43_200,
  jurisdicao: "us-privacy",
  idiomaPadrao: "en",
  fusoHorario: "America/New_York",
  piiKindsRelevantes: ["ssn-us", "cartao-credito", "valor-financeiro", "email", "telefone"],
  temInboxExtras: true,
};

export * from "@/lib/server/usConstructionRemodeling";
