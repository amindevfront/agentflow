// Gaveta Internacional — Imobiliárias de Luxo (Miami/Orlando, EUA).
//
// SERVER-SAFE: nenhum import de React/componente aqui — ver `./InboxExtras`
// para a UI injetada na Neural Inbox (consumida só por
// `@/modules/registry.client`). Reaproveita a MESMA política de guardrail do
// Módulo Vertical 1 (BR) — `POLITICA_IMOBILIARIO_ALTO_PADRAO` — porque o
// risco de negócio é estruturalmente idêntico (Proteção de Caixa: nenhum
// valor/condição comercial fechada sem validação prévia), e o detector que a
// sustenta (`detectarPromessaComercialNaoAutorizada`, em
// `@/lib/guardrails/consistency`) já cobre o equivalente em inglês deste
// sinal — ver o comentário "Expansão Enterprise Global" naquele arquivo.

import { POLITICA_IMOBILIARIO_ALTO_PADRAO } from "@/lib/guardrails/policy";
import type { VerticalModuleDefinition } from "../types";

export const US_REAL_ESTATE_LUXURY_MODULE: VerticalModuleDefinition = {
  id: "us-real-estate-luxury",
  nome: "US Luxury Real Estate (Miami/Orlando)",
  descricao:
    "Buyer qualification with validated proof-of-funds/pre-approval, budget range extraction (USD) and showing-request detection.",
  guardrailPolicyId: POLITICA_IMOBILIARIO_ALTO_PADRAO.id,
  moeda: "USD",
  // Comissão média ESTIMADA por showing confirmado em imóvel de luxo —
  // valor de partida conservador, cada workspace deve recalibrar ao seu
  // próprio ticket médio real (mesmo espírito de `VALOR_MEDIO_PIPELINE_PADRAO_BRL`
  // em `@/lib/server/roiDashboard`).
  valorMedioPipelineMoedaLocal: 25_000,
  // Equivalente em BRL ao câmbio de referência de `ROI_CONFIG_PADRAO.cambioUsdBrl`
  // (5.4 nesta versão) — 25_000 × 5.4 = 135_000. Recalculado manualmente, não
  // importado de `@/lib/roi`, para manter este arquivo livre do SDK cliente
  // do Firebase que `@/lib/roi` carrega (ver nota de bundle em `@/modules/types`).
  valorMedioPipelineBrl: 135_000,
  jurisdicao: "us-privacy",
  idiomaPadrao: "en",
  // Miami e Orlando estão ambas em Eastern Time.
  fusoHorario: "America/New_York",
  piiKindsRelevantes: ["ssn-us", "cartao-credito", "conta-bancaria", "valor-financeiro", "email", "telefone"],
  temInboxExtras: true,
};

export * from "@/lib/server/usRealEstateLuxury";
