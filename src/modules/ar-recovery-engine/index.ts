// Gaveta de Back-office — AR Recovery Engine (Motor de Cobrança e
// Follow-up de Papelada).
//
// SERVER-SAFE (ver nota em `@/modules/us-real-estate-luxury/index.ts`).
// `temInboxExtras: false` — o status é um painel de Governança
// (`ArRecoveryStatusPanel`, workspace-wide), não um widget por conversa da
// Neural Inbox; o motor em si roda via tick externo
// (`@/lib/server/arRecoveryEngine`, `/api/ar-recovery/tick`).
//
// `guardrailPolicyId`: reaproveita `POLITICA_IMOBILIARIO_ALTO_PADRAO` — a
// mesma Proteção de Caixa (nenhum perdão/desconto/renegociação sem
// validação prévia) se aplica diretamente a mensagens de cobrança.
//
// Sem pipeline de vendas (Artigo IV) — ver nota em
// `@/modules/document-ai-vault/index.ts`.

import { POLITICA_IMOBILIARIO_ALTO_PADRAO } from "@/lib/guardrails/policy";
import type { VerticalModuleDefinition } from "../types";

export const AR_RECOVERY_ENGINE_MODULE: VerticalModuleDefinition = {
  id: "ar-recovery-engine",
  nome: "AR Recovery Engine",
  descricao: "Monitor autônomo de documentos/faturas vencidas, com follow-up humanizado e escalonamento via HITL.",
  guardrailPolicyId: POLITICA_IMOBILIARIO_ALTO_PADRAO.id,
  moeda: "BRL",
  valorMedioPipelineMoedaLocal: 0,
  valorMedioPipelineBrl: 0,
  jurisdicao: "br-lgpd",
  idiomaPadrao: "pt",
  fusoHorario: "America/Sao_Paulo",
  piiKindsRelevantes: ["cpf", "cnpj", "valor-financeiro", "email", "telefone"],
  temInboxExtras: false,
};

export * from "@/lib/arRecoveryEngine";
