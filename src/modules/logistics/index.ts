// Gaveta Vertical — Logística Portuária (rastreio de carga, demurrage,
// exposição cambial).
//
// SERVER-SAFE (ver nota em `@/modules/real-estate/index.ts`). Sem política de
// guardrail dedicada ainda nesta vertical (nenhuma regra de negócio
// específica foi formalizada em `@/lib/guardrails/policy` para ela) — usa
// `no-critico` como recomendação honesta, o mesmo piso rígido de qualquer nó
// cujo erro tem custo irreversível (aqui: desvio de SLA/custo de demurrage),
// em vez de inventar uma política "logistica-portuaria" sem regra de negócio
// real por trás (Artigo IV — No Invention).
import { POLITICA_NO_CRITICO } from "@/lib/guardrails/policy";
import type { VerticalModuleDefinition } from "../types";

export const LOGISTICS_MODULE: VerticalModuleDefinition = {
  id: "logistica-portuaria",
  nome: "Logística Portuária",
  descricao: "Triagem operacional de status de carga, risco de demurrage e exposição cambial.",
  guardrailPolicyId: POLITICA_NO_CRITICO.id,
  moeda: "BRL",
  // Nenhum protocolo de confirmação de agendamento implementado para este
  // nicho ainda — ver `@/lib/server/roiDashboard`, mesmo racional do `0`
  // de `VALOR_MEDIO_PIPELINE_PADRAO_BRL` antes desta gaveta existir.
  valorMedioPipelineMoedaLocal: 0,
  valorMedioPipelineBrl: 0,
  jurisdicao: "br-lgpd",
  idiomaPadrao: "pt",
  fusoHorario: "America/Sao_Paulo",
  piiKindsRelevantes: ["cnpj", "email", "valor-financeiro"],
  temInboxExtras: true,
};
