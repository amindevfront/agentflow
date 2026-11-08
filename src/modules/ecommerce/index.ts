// Gaveta Vertical — E-commerce (risco de chargeback & devolução).
//
// SERVER-SAFE (ver nota em `@/modules/real-estate/index.ts`). Mesmo racional
// de `@/modules/logistics/index.ts` para a política recomendada: sem regra
// de negócio dedicada formalizada ainda, usa `no-critico` em vez de inventar.
import { POLITICA_NO_CRITICO } from "@/lib/guardrails/policy";
import type { VerticalModuleDefinition } from "../types";

export const ECOMMERCE_MODULE: VerticalModuleDefinition = {
  id: "ecommerce",
  nome: "E-commerce",
  descricao: "Radar de Risco de Chargeback & Devolução.",
  guardrailPolicyId: POLITICA_NO_CRITICO.id,
  moeda: "BRL",
  valorMedioPipelineMoedaLocal: 0,
  valorMedioPipelineBrl: 0,
  jurisdicao: "br-lgpd",
  idiomaPadrao: "pt",
  fusoHorario: "America/Sao_Paulo",
  piiKindsRelevantes: ["cartao-credito", "email", "cep"],
  temInboxExtras: true,
};
