// Gaveta de Back-office — Document AI Vault (Gestão Inteligente de
// Documentos e Contratos).
//
// SERVER-SAFE (ver nota em `@/modules/us-real-estate-luxury/index.ts`): só
// metadados aqui, zero import de React. `temInboxExtras: false` — este é um
// painel STANDALONE (`DocumentVaultPanel`, `@/components/niche`), não um
// widget injetado na Neural Inbox (diferente de `sheet-reconciliation`).
//
// `guardrailPolicyId`: reaproveita `POLITICA_NO_CRITICO` — um documento
// pode conter cláusula financeira/PII sensível, mesmo risco de "erro tem
// custo irreversível" que já justifica a política em outros nós críticos.
//
// Sem pipeline de vendas (Artigo IV): esta gaveta economiza HORAS, não gera
// oportunidade comercial — ver `@/lib/server/backOfficeRoi` e a nota de
// escopo em `@/lib/server/roiDashboard`.

import { POLITICA_NO_CRITICO } from "@/lib/guardrails/policy";
import type { VerticalModuleDefinition } from "../types";

export const DOCUMENT_AI_VAULT_MODULE: VerticalModuleDefinition = {
  id: "document-ai-vault",
  nome: "Document AI Vault",
  descricao: "Extração de cláusulas críticas, PII Shield e resumo executivo automático de contratos.",
  guardrailPolicyId: POLITICA_NO_CRITICO.id,
  moeda: "BRL",
  valorMedioPipelineMoedaLocal: 0,
  valorMedioPipelineBrl: 0,
  jurisdicao: "br-lgpd",
  idiomaPadrao: "pt",
  fusoHorario: "America/Sao_Paulo",
  piiKindsRelevantes: ["cpf", "cnpj", "valor-financeiro", "email", "telefone", "ssn-us", "nif-pt"],
  temInboxExtras: false,
};

export * from "@/lib/documentAiVault";
