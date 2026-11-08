// Gaveta Vertical — Advocacia, Contabilidade & Serviços B2B.
//
// SERVER-SAFE (ver nota em `@/modules/real-estate/index.ts`). Sem `InboxExtras`
// nesta versão: não existe ainda um painel de nicho dedicado para esta
// vertical (mesmo estado de antes desta gaveta existir — `NeuralInbox.tsx`
// nunca teve um ramo `workspace?.setor === "advocacia-contabilidade"`) —
// registrar a gaveta mesmo sem UI prova que o registro não exige UI para
// ter valor: o Guardrail Ético-Profissional e o cálculo de pipeline já
// valem por si.

import { POLITICA_ADVOCACIA_CONTABILIDADE } from "@/lib/guardrails/policy";
import type { VerticalModuleDefinition } from "../types";

export const PROFESSIONAL_SERVICES_MODULE: VerticalModuleDefinition = {
  id: "advocacia-contabilidade",
  nome: "Advocacia, Contabilidade & Serviços B2B",
  descricao:
    "Guardrail Ético-Profissional — nenhuma garantia de resultado de processo/causa, prazo judicial ou honorário fixado sem análise técnica.",
  guardrailPolicyId: POLITICA_ADVOCACIA_CONTABILIDADE.id,
  moeda: "BRL",
  valorMedioPipelineMoedaLocal: 8_000,
  valorMedioPipelineBrl: 8_000,
  jurisdicao: "br-lgpd",
  idiomaPadrao: "pt",
  fusoHorario: "America/Sao_Paulo",
  piiKindsRelevantes: ["cpf", "cnpj", "valor-financeiro"],
  temInboxExtras: false,
};

export * from "@/lib/server/advocaciaContabilidadeB2B";
