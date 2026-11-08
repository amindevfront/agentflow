// Gaveta Internacional — Construtoras, Reformas de Alto Padrão & Empreiteiras
// (EUA/Flórida).
//
// SERVER-ONLY (sem Firestore nem Admin SDK: puro e testável, mesmo desenho de
// `./imobiliarioAltoPadrao` e `./usRealEstateLuxury`).
//
// Resolve três itens do pedido: (1) qualificação de leads de alto valor em
// USD — `extractStatedBudget`/`detectProjectType`; (2) follow-up agressivo —
// `detectUrgency`, sinalização de urgência para priorizar a fila; (3)
// estimativas preliminares automatizadas — `estimatePreliminaryRange`, SEM
// inventar uma tabela de preço fechada: a faixa $/sqft é um PARÂMETRO
// configurável (mesmo desenho de `VALOR_MEDIO_PIPELINE_PADRAO_BRL` e
// `ROI_CONFIG_PADRAO` — valores de partida conservadores, documentados como
// estimativa de referência, nunca uma tabela fiscal/comercial oficial). Sem
// metragem E tipo de projeto identificados no texto, a função devolve `null`
// — nunca um número inventado para preencher a lacuna (Artigo IV).
//
// Mesma privacidade de `./imobiliarioAltoPadrao`: tudo aqui opera sobre texto
// JÁ MASCARADO pelo Shield-Layer.

import type { ResumoExecutivoHandoff } from "@/types";

export type ProjectType =
  | "kitchen-remodel"
  | "bathroom-remodel"
  | "roofing"
  | "room-addition"
  | "full-renovation"
  | "deck-patio";

const PROJECT_TYPE_LEXICON: Array<{ pattern: RegExp; type: ProjectType; label: string }> = [
  { pattern: /\bkitchen\s+remodel(?:ing)?\b/i, type: "kitchen-remodel", label: "Kitchen remodel" },
  { pattern: /\bbathroom\s+remodel(?:ing)?\b/i, type: "bathroom-remodel", label: "Bathroom remodel" },
  { pattern: /\broof(?:ing)?\s+(?:replacement|repair)?\b/i, type: "roofing", label: "Roofing" },
  { pattern: /\b(?:room|home)\s+addition\b/i, type: "room-addition", label: "Room addition" },
  { pattern: /\b(?:full|whole[- ]house)\s+renovation\b/i, type: "full-renovation", label: "Full renovation" },
  { pattern: /\bdeck\b|\bpatio\b/i, type: "deck-patio", label: "Deck/patio" },
];

/** Project type detected in the text, or `null` when none matched — never guessed. */
export function detectProjectType(text: string): { type: ProjectType; label: string } | null {
  if (!text) return null;
  for (const { pattern, type, label } of PROJECT_TYPE_LEXICON) {
    if (pattern.test(text)) return { type, label };
  }
  return null;
}

/**
 * Project type detected across the most recent client messages — same
 * "order does not matter" guarantee as every other extractor in this file
 * (and in `./imobiliarioAltoPadrao`/`./usRealEstateLuxury`): scans every
 * message, first match wins.
 */
export function extractProjectType(recentClientMessages: string[]): { type: ProjectType; label: string } | null {
  for (const text of recentClientMessages) {
    const found = detectProjectType(text);
    if (found) return found;
  }
  return null;
}

/** Urgency signals — the "aggressive follow-up" qualification cue for this market. */
const URGENCY_PATTERNS: RegExp[] = [
  /\basap\b/i,
  /\burgent(?:ly)?\b/i,
  /\bemergency\b/i,
  /\bneed(?:s)?\s+it\s+done\s+(?:this\s+week|right\s+away|asap)\b/i,
  /\bas\s+soon\s+as\s+possible\b/i,
];

/** `true` when the text signals urgency — should prioritize follow-up. */
export function detectUrgency(text: string): boolean {
  if (!text) return false;
  return URGENCY_PATTERNS.some((pattern) => pattern.test(text));
}

/** Phrases indicating intent to schedule an in-person estimate visit. */
const ESTIMATE_VISIT_PATTERNS: RegExp[] = [
  /\bschedule\s+(?:an?\s+)?(?:estimate|quote|inspection)\b/i,
  /\bcan\s+someone\s+come\s+(?:take\s+a\s+look|measure|out)\b/i,
  /\bbook\s+(?:a\s+)?(?:quote|estimate)\s+visit\b/i,
  /\bcome\s+(?:out\s+)?(?:and\s+)?measure\b/i,
];

/** `true` when the text indicates intent to schedule an in-person estimate visit. */
export function detectEstimateVisitRequest(text: string): boolean {
  if (!text) return false;
  return ESTIMATE_VISIT_PATTERNS.some((pattern) => pattern.test(text));
}

/** Objection → label lexicon, same priority order as `./usRealEstateLuxury`. */
const OBJECTION_LEXICON: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /\b(?:too\s+expensive|higher\s+than\s+(?:i|we)\s+expected|above\s+(?:my|our)\s+budget)\b/i,
    label: "Price above expected budget",
  },
  {
    pattern: /\b(?:getting|comparing)\s+other\s+quotes?\b|\bshopping\s+around\b/i,
    label: "Comparing with other contractor quotes",
  },
  {
    pattern: /\bwaiting\s+on\s+(?:financing|loan\s+approval)\b|\bfinancing\s+fell\s+through\b/i,
    label: "Financing/loan approval pending",
  },
  {
    pattern: /\binsurance\s+claim\s+(?:pending|in\s+progress|not\s+approved)\b/i,
    label: "Insurance claim pending",
  },
];

/** Objection mapped from the most recent client messages, or `null` when none was identified. */
export function extractMappedObjection(recentClientMessages: string[]): string | null {
  for (const text of recentClientMessages) {
    for (const { pattern, label } of OBJECTION_LEXICON) {
      if (pattern.test(text)) return label;
    }
  }
  return null;
}

/** Budget stated by the client, by extenso ("around $15k", "budget of $8,000-$10,000"), never the exact single figure. */
const STATED_BUDGET_PATTERNS: RegExp[] = [
  /\bbudget\s+of\s+\$[\d.,]+\s*[kK]?(?:\s*-\s*\$?[\d.,]+\s*[kK]?)?\b/i,
  /\baround\s+\$[\d.,]+\s*[kK]?\b/i,
  /\$[\d.,]+\s*[kK]?\s*-\s*\$[\d.,]+\s*[kK]?\b/i,
];

/** Budget range mentioned by the client, verbatim, or `null` when absent. */
export function extractStatedBudget(recentClientMessages: string[]): string | null {
  for (const text of recentClientMessages) {
    for (const pattern of STATED_BUDGET_PATTERNS) {
      const found = text.match(pattern);
      if (found) return found[0].trim();
    }
  }
  return null;
}

/** Square footage mentioned in the text (e.g. "about 1200 sq ft", "1,500 square feet"), or `null`. */
export function extractSquareFootage(text: string): number | null {
  if (!text) return null;
  const match = text.match(/([\d,]{2,6})\s*(?:sq\.?\s*ft\.?|square\s+feet|sf)\b/i);
  if (!match) return null;
  const valor = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

/** Same as `extractSquareFootage`, scanning every recent client message — first match wins. */
export function extractSquareFootageFromMessages(recentClientMessages: string[]): number | null {
  for (const text of recentClientMessages) {
    const found = extractSquareFootage(text);
    if (found !== null) return found;
  }
  return null;
}

export interface PreliminaryRateReference {
  minUsdPerSqft: number;
  maxUsdPerSqft: number;
}

/**
 * Faixa $/sqft de REFERÊNCIA por tipo de projeto — valores de partida
 * conservadores (mercado de reforma residencial nos EUA, 2025), documentados
 * como estimativa, nunca uma tabela fiscal/comercial oficial. Cada workspace
 * deve recalibrar ao seu próprio mercado/fornecedores (mesmo espírito de
 * `ROI_CONFIG_PADRAO` em `@/lib/roi`).
 */
export const DEFAULT_PRELIMINARY_RATE_REFERENCE_USD: Record<ProjectType, PreliminaryRateReference> = {
  "kitchen-remodel": { minUsdPerSqft: 150, maxUsdPerSqft: 300 },
  "bathroom-remodel": { minUsdPerSqft: 200, maxUsdPerSqft: 400 },
  roofing: { minUsdPerSqft: 5, maxUsdPerSqft: 12 },
  "room-addition": { minUsdPerSqft: 180, maxUsdPerSqft: 350 },
  "full-renovation": { minUsdPerSqft: 100, maxUsdPerSqft: 250 },
  "deck-patio": { minUsdPerSqft: 25, maxUsdPerSqft: 60 },
};

export interface PreliminaryEstimateRange {
  minUsd: number;
  maxUsd: number;
}

/**
 * Preliminary, non-binding estimate range — `null` when either the project
 * type or the square footage could not be identified (never fabricated to
 * fill the gap, Article IV). Always labeled "preliminary" in the UI
 * (`RemodelingEstimatePanel`), never a closed quote — the guardrail
 * (`bloquearPromessaComercialNaoAutorizada`, reused from
 * `POLITICA_IMOBILIARIO_ALTO_PADRAO`) still blocks the AI from committing to
 * a closed price in the conversation itself.
 */
export function estimatePreliminaryRange(
  projectType: ProjectType | null,
  squareFootage: number | null,
  rateReference: Record<ProjectType, PreliminaryRateReference> = DEFAULT_PRELIMINARY_RATE_REFERENCE_USD
): PreliminaryEstimateRange | null {
  if (!projectType || !squareFootage || squareFootage <= 0) return null;
  const rate = rateReference[projectType];
  return {
    minUsd: Math.round(rate.minUsdPerSqft * squareFootage),
    maxUsd: Math.round(rate.maxUsdPerSqft * squareFootage),
  };
}

export interface BuildExecutiveHandoffSummaryInput {
  clientName: string;
  recentClientMessages: string[];
}

/** Same shape as `ResumoExecutivoHandoff` (reused, not a new type) — see `./usRealEstateLuxury`. */
export function buildExecutiveHandoffSummary(input: BuildExecutiveHandoffSummaryInput): ResumoExecutivoHandoff {
  const projeto = extractProjectType(input.recentClientMessages);
  return {
    nome: input.clientName || null,
    faixaOrcamento: extractStatedBudget(input.recentClientMessages),
    imovelInteresse: projeto?.label ?? null,
    objecaoMapeada: extractMappedObjection(input.recentClientMessages),
  };
}
