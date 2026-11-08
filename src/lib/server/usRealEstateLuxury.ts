// Gaveta Internacional — Imobiliárias de Luxo (Miami/Orlando, EUA).
//
// SERVER-ONLY (mas sem Firestore nem Admin SDK: puro e testável, mesmo
// desenho de `./imobiliarioAltoPadrao`, do qual este módulo é o equivalente
// em inglês — mesma estrutura de campos (`ResumoExecutivoHandoff`), léxico
// de detecção reescrito para o idioma real do lead (EUA/Flórida).
//
// Resolve "triagem de compradores com capacidade financeira validada":
// diferente do Vertical 1 (BR), aqui o sinal de qualificação mais forte não
// é a faixa de orçamento isolada, é a MENÇÃO a prova de capacidade
// financeira (proof of funds, pre-approval, cash buyer) — o padrão do
// mercado de luxo americano, onde um corretor não agenda showing para quem
// não comprovou capacidade.
//
// Mesma privacidade de `./imobiliarioAltoPadrao`: tudo aqui opera sobre texto
// JÁ MASCARADO pelo Shield-Layer — nenhuma função recebe nem precisa do
// valor original. "Between $800k and $1.2M" sobrevive ao mascaramento pelo
// mesmo motivo da faixa em português: o detector de PII só reconhece valores
// com símbolo de moeda explícito (ver `DETECTORES` em `@/lib/guardrails/pii`).
//
// Integração com portais de listagem (MLS/Zillow/Realtor.com): trabalho
// futuro via conector dedicado (`@/lib/server/connectors`) — mesma honestidade
// de `ChargebackRiskPanel`/`CargoTriagePanel` sobre integrações externas
// ainda não construídas. Este módulo cobre o que já funciona hoje: extração
// determinística do texto da conversa, sem depender de nenhuma API externa.

import type { ResumoExecutivoHandoff } from "@/types";

/** Phrases indicating intent to schedule an in-person property showing. */
const SHOWING_REQUEST_PATTERNS: RegExp[] = [
  /\bschedule\s+(?:a\s+)?showing\b/i,
  /\bbook\s+(?:a\s+)?(?:showing|tour|visit)\b/i,
  /\b(?:want|would\s+like|love)\s+to\s+(?:see|visit|tour)\s+(?:the|this)\s+(?:property|condo|house|home|unit)\b/i,
  /\bin[- ]person\s+(?:showing|visit|tour)\b/i,
  /\bcan\s+we\s+(?:see|visit|tour)\s+it\b/i,
];

/** `true` when the text indicates intent to schedule an in-person showing. */
export function detectShowingRequest(text: string): boolean {
  if (!text) return false;
  return SHOWING_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Proof-of-financial-capacity signal lexicon — the qualification signal the
 * US luxury market actually uses before booking a showing. First match
 * wins; order reflects strength of signal (cash buyer is the strongest).
 */
const PROOF_OF_FUNDS_LEXICON: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bcash\s+buyer\b|\bpaying\s+(?:in\s+)?cash\b/i, label: "Cash buyer" },
  {
    pattern: /\bproof\s+of\s+funds\b|\bbank\s+(?:letter|statement)\s+(?:attached|available|ready)\b/i,
    label: "Proof of funds mentioned",
  },
  {
    pattern: /\bpre[- ]?approved\b|\bpre[- ]?approval\s+letter\b|\bmortgage\s+pre[- ]?approval\b/i,
    label: "Pre-approved for mortgage",
  },
];

/** Proof-of-funds/pre-approval signal mentioned by the lead, or `null` when none was found. */
export function extractProofOfFundsSignal(recentClientMessages: string[]): string | null {
  for (const text of recentClientMessages) {
    for (const { pattern, label } of PROOF_OF_FUNDS_LEXICON) {
      if (pattern.test(text)) return label;
    }
  }
  return null;
}

/** Objection → label lexicon. First match wins — price objections are the most common, checked first. */
const OBJECTION_LEXICON: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /\b(?:too\s+expensive|out\s+of\s+(?:my|our)\s+budget|above\s+what\s+(?:i|we)\s+(?:wanted|planned))\b/i,
    label: "Price above expected budget",
  },
  {
    pattern: /\b(?:need\s+to\s+think|still\s+deciding|haven'?t\s+decided|no\s+rush)\b/i,
    label: "Undecided / still deciding",
  },
  {
    pattern: /\b(?:looking\s+at\s+another|comparing\s+with|other\s+listing|another\s+option)\b/i,
    label: "Comparing with another listing/competitor",
  },
  {
    pattern: /\b(?:financing\s+fell\s+through|couldn'?t\s+get\s+(?:the\s+)?loan|mortgage\s+(?:issue|problem|denied))\b/i,
    label: "Financing/mortgage difficulty",
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

/** Property types and South Florida / Central Florida luxury markets/neighborhoods. */
const PROPERTY_INTEREST_LEXICON: RegExp[] = [
  /\bpenthouse\b/i,
  /\bcondo(?:minium)?\b/i,
  /\bwaterfront\b/i,
  /\bsingle[- ]family\s+home\b/i,
  /\bvilla\b/i,
  /\btownhouse\b/i,
  /\bmiami\s+beach\b/i,
  /\bbrickell\b/i,
  /\bcoral\s+gables\b/i,
  /\bwinter\s+park\b/i,
  /\blake\s+nona\b/i,
];

/** First property type or neighborhood mention found, verbatim, or `null`. */
export function extractPropertyInterest(recentClientMessages: string[]): string | null {
  for (const text of recentClientMessages) {
    for (const pattern of PROPERTY_INTEREST_LEXICON) {
      const found = text.match(pattern);
      if (found) return found[0];
    }
  }
  return null;
}

/**
 * Budget range in USD, by extenso ("between $800k and $1.2M", "up to $2
 * million", "in the $1.5M range") — never the exact figure, which PiiVault
 * already masks before any persistence (see module header).
 */
const BUDGET_RANGE_PATTERNS: RegExp[] = [
  /\bbetween\s+\$?[\d.,]+\s*(?:k|m|million|thousand)?\s+and\s+\$?[\d.,]+\s*(?:k|m|million|thousand)?\b/i,
  /\bup\s+to\s+\$[\d.,]+\s*(?:k|m|million|thousand)?\b/i,
  /\bin\s+the\s+\$[\d.,]+\s*(?:k|m|million|thousand)?\s+range\b/i,
  /\$[\d.,]+\s*(?:k|m|million|thousand)\b/i,
];

/** Budget range mentioned by extenso, verbatim, or `null` when absent. */
export function extractBudgetRange(recentClientMessages: string[]): string | null {
  for (const text of recentClientMessages) {
    for (const pattern of BUDGET_RANGE_PATTERNS) {
      const found = text.match(pattern);
      if (found) return found[0].trim();
    }
  }
  return null;
}

export interface BuildExecutiveHandoffSummaryInput {
  /** `Conversation.participante.nome` — never masked by design (see `ConversationParticipant`). */
  clientName: string;
  /** Client messages, order does not matter for the extractors. Always already-masked text. */
  recentClientMessages: string[];
}

/**
 * Builds the executive handoff card for the human agent — same shape as
 * `ResumoExecutivoHandoff` (reused as-is, not a new type): a missing field
 * stays `null`, never invented (Article IV — No Invention).
 */
export function buildExecutiveHandoffSummary(input: BuildExecutiveHandoffSummaryInput): ResumoExecutivoHandoff {
  return {
    nome: input.clientName || null,
    faixaOrcamento: extractBudgetRange(input.recentClientMessages),
    imovelInteresse: extractPropertyInterest(input.recentClientMessages),
    objecaoMapeada: extractMappedObjection(input.recentClientMessages),
  };
}
