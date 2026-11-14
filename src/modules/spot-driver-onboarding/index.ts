// Gaveta de Back-office — Fleet & SPOT Driver Onboarding (Logística/
// Transportadoras: Fadel, Comex, distribuidoras pesadas).
//
// SERVER-SAFE (ver nota em `@/modules/us-real-estate-luxury/index.ts`).
// `temInboxExtras: false` — a Gestão de Frota é um painel de Governança
// (`SpotFleetStatusPanel`, workspace-wide) que reaproveita `HandoffQueuePanel`
// filtrado pelos motivos desta gaveta, não um widget por conversa da Neural
// Inbox; o motor em si roda via tick externo
// (`@/lib/server/spotDriverOnboardingAdmin`, `/api/spot-driver/tick`).
//
// `guardrailPolicyId`: reaproveita `POLITICA_NO_CRITICO` — um cadastro de
// motorista com documentação vencida/irregular tem o mesmo "erro é
// irreversível" (frota liberada sem compliance) que já justifica a política
// em outros nós críticos (mesmo racional de `document-ai-vault`).
//
// Sem pipeline de vendas (Artigo IV) — esta gaveta economiza HORAS e evita
// gargalo de pátio, não gera oportunidade comercial, ver nota em
// `@/modules/document-ai-vault/index.ts`.

import { POLITICA_NO_CRITICO } from "@/lib/guardrails/policy";
import type { VerticalModuleDefinition } from "../types";

export const SPOT_DRIVER_ONBOARDING_MODULE: VerticalModuleDefinition = {
  id: "spot-driver-onboarding",
  nome: "Fleet & SPOT Driver Onboarding",
  descricao:
    "Triagem autônoma de motoristas SPOT via WhatsApp/Telegram, validação de CNH/CRLV/ANTT/Comprovante de Residência e Dossiê de Risco e Prontidão para aprovação em 1 clique.",
  guardrailPolicyId: POLITICA_NO_CRITICO.id,
  moeda: "BRL",
  valorMedioPipelineMoedaLocal: 0,
  valorMedioPipelineBrl: 0,
  jurisdicao: "br-lgpd",
  idiomaPadrao: "pt",
  fusoHorario: "America/Sao_Paulo",
  piiKindsRelevantes: ["cpf", "cnpj", "cep", "valor-financeiro", "telefone"],
  temInboxExtras: false,
};

export * from "@/lib/spotDriverOnboarding";
