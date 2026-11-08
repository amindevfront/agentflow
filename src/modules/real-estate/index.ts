// Gaveta Vertical — Construtoras e Imobiliárias de Alto Padrão.
//
// SERVER-SAFE: nenhum import de React/componente aqui — ver `./InboxExtras`
// para a UI injetada na Neural Inbox (consumida só por `@/modules/registry.client`,
// nunca por este arquivo). Reaproveita 100% da lógica de domínio já construída
// e testada em `@/lib/server/imobiliarioAltoPadrao` e da política em
// `@/lib/guardrails/policy` — esta gaveta é a casca de registro, não uma
// reimplementação.

import { POLITICA_IMOBILIARIO_ALTO_PADRAO } from "@/lib/guardrails/policy";
import type { VerticalModuleDefinition } from "../types";

export const REAL_ESTATE_MODULE: VerticalModuleDefinition = {
  id: "construtora-imobiliaria",
  nome: "Construtoras & Imobiliárias de Alto Padrão",
  descricao:
    "Handoff com Resumo Executivo Mastigado, Radar de Risco de Distrato e anexos rápidos (memorial, plantas, disponibilidade).",
  guardrailPolicyId: POLITICA_IMOBILIARIO_ALTO_PADRAO.id,
  moeda: "BRL",
  valorMedioPipelineMoedaLocal: 15_000,
  valorMedioPipelineBrl: 15_000,
  jurisdicao: "br-lgpd",
  idiomaPadrao: "pt",
  fusoHorario: "America/Sao_Paulo",
  piiKindsRelevantes: ["cpf", "cnpj", "valor-financeiro", "email", "telefone"],
  temInboxExtras: true,
};

export * from "@/lib/server/imobiliarioAltoPadrao";
