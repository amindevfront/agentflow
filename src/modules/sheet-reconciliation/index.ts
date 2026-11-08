// Gaveta de Back-office — Sheet Reconciliation (Conciliação de Planilhas
// via IA).
//
// SERVER-SAFE (ver nota em `@/modules/us-real-estate-luxury/index.ts`).
// `guardrailPolicyId`: reaproveita `POLITICA_PADRAO` — risco baixo (dado
// operacional, não comercial/clínico/financeiro sensível por natureza).
//
// Sem pipeline de vendas (Artigo IV) — ver nota em
// `@/modules/document-ai-vault/index.ts`.

import { POLITICA_PADRAO } from "@/lib/guardrails/policy";
import type { VerticalModuleDefinition } from "../types";

export const SHEET_RECONCILIATION_MODULE: VerticalModuleDefinition = {
  id: "sheet-reconciliation",
  nome: "Sheet Reconciliation",
  descricao: "Conciliação de planilhas/tabelas operacionais em tempo real, a partir das conversas da Neural Inbox.",
  guardrailPolicyId: POLITICA_PADRAO.id,
  moeda: "BRL",
  valorMedioPipelineMoedaLocal: 0,
  valorMedioPipelineBrl: 0,
  jurisdicao: "br-lgpd",
  idiomaPadrao: "pt",
  fusoHorario: "America/Sao_Paulo",
  piiKindsRelevantes: ["valor-financeiro", "email", "telefone"],
  temInboxExtras: true,
};

export * from "@/lib/sheetReconciliation";
