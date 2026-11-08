// Gaveta Vertical — Clínicas de Saúde, Estética Avançada & Especialistas de
// Alto Padrão.
//
// SERVER-SAFE (ver nota em `@/modules/real-estate/index.ts`). Atende dois
// `NicheKey` no registro (`clinica-alto-padrao` e `clinica-medica-exames`) —
// mesmo agrupamento que já existia no `if` hardcoded de `NeuralInbox.tsx`.

import { POLITICA_CLINICA_ALTO_PADRAO } from "@/lib/guardrails/policy";
import type { VerticalModuleDefinition } from "../types";

export const CLINICS_MODULE: VerticalModuleDefinition = {
  id: "clinica-alto-padrao",
  nome: "Clínicas de Saúde, Estética Avançada & Especialistas de Alto Padrão",
  descricao:
    "Guardrail Clínico/Ético, confirmação de agendamento anti-no-show e check-in pós-atendimento.",
  guardrailPolicyId: POLITICA_CLINICA_ALTO_PADRAO.id,
  moeda: "BRL",
  valorMedioPipelineMoedaLocal: 3_500,
  valorMedioPipelineBrl: 3_500,
  jurisdicao: "br-lgpd",
  idiomaPadrao: "pt",
  fusoHorario: "America/Sao_Paulo",
  piiKindsRelevantes: ["cpf", "email", "telefone", "valor-financeiro"],
  temInboxExtras: true,
};

/**
 * Mesma gaveta (mesmo guardrail clínico, mesma UI de Inbox — ver
 * `./InboxExtras`) aplicada ao nicho "Clínica Médica & Exames". Deliberadamente
 * SEM valor de pipeline padrão: diferente do procedimento estético de alto
 * padrão, o ticket médio de uma consulta/exame nunca foi calibrado aqui —
 * `clinica-medica-exames` já era `0` na tabela original de
 * `@/lib/server/roiDashboard` antes desta gaveta existir, e continua `0`
 * agora (Artigo IV — No Invention: compartilhar a UI não significa inventar
 * um valor financeiro que nunca foi validado para este nicho).
 */
export const CLINICS_EXAMS_MODULE: VerticalModuleDefinition = {
  ...CLINICS_MODULE,
  id: "clinica-medica-exames",
  valorMedioPipelineMoedaLocal: 0,
  valorMedioPipelineBrl: 0,
};

export * from "@/lib/server/clinicaAltoPadrao";
