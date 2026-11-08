// Gaveta Internacional — Clínicas e Centros de Saúde (Portugal/Europa).
//
// SERVER-SAFE (ver nota em `@/modules/us-real-estate-luxury/index.ts`). Sem
// nenhum arquivo de domínio próprio: reaproveita 100% da lógica já construída
// em `@/lib/server/clinicaAltoPadrao` (mesmo idioma — Portugal também fala
// português, diferente das gavetas americanas) e a MESMA UI de Inbox de
// `@/modules/clinics` (`ClinicsInboxExtras`/`AppointmentRemindersPanel`) — o
// que muda aqui é só a camada de localização: moeda EUR, jurisdição GDPR
// (`eu-gdpr`, ver `@/lib/jurisdiction`) e fuso de Lisboa. "Agendamento
// multicanal e redução de faltas" já É o fluxo anti-no-show existente;
// "conformidade total com GDPR" é a tag de jurisdição abaixo — o motor de
// consentimento/mascaramento de PII é o mesmo para qualquer workspace, nunca
// um regime "mais fraco" por padrão.

import { POLITICA_CLINICA_ALTO_PADRAO } from "@/lib/guardrails/policy";
import type { VerticalModuleDefinition } from "../types";

export const PORTUGAL_CLINICS_HEALTH_MODULE: VerticalModuleDefinition = {
  id: "portugal-clinics-health",
  nome: "Clínicas & Centros de Saúde (Portugal/Europa)",
  descricao:
    "Guardrail Clínico/Ético, agendamento multicanal e redução de faltas, com conformidade GDPR (UE).",
  guardrailPolicyId: POLITICA_CLINICA_ALTO_PADRAO.id,
  moeda: "EUR",
  // Ticket médio ESTIMADO por consulta/avaliação confirmada — valor de
  // partida conservador para um centro de saúde generalista (não
  // necessariamente "alto padrão" como o Vertical 2 original).
  valorMedioPipelineMoedaLocal: 200,
  // 200 × 5.9 (câmbio de referência de `ROI_CONFIG_PADRAO.cambioEurBrl`) = 1_180.
  valorMedioPipelineBrl: 1_180,
  jurisdicao: "eu-gdpr",
  idiomaPadrao: "pt",
  fusoHorario: "Europe/Lisbon",
  piiKindsRelevantes: ["nif-pt", "email", "telefone", "cep"],
  temInboxExtras: true,
};

export * from "@/lib/server/clinicaAltoPadrao";
