// Gaveta de Back-office — Document AI Vault (Gestão Inteligente de
// Documentos e Contratos).
//
// Isomórfico e puro (sem Firestore, sem Admin SDK, sem rede) — roda tanto
// no painel (`DocumentVaultPanel`, análise instantânea no cliente) quanto
// em qualquer código de servidor que queira reaproveitar, mesmo desenho de
// `@/lib/distrato`/`@/lib/chargebackRisk` (calculadoras de nicho puras,
// fora de `src/lib/server/`, exatamente porque são consumidas direto pelo
// painel "use client").
//
// Mesma filosofia de todo detector determinístico deste código: léxico de
// palavras-chave, sem IA generativa — auditável e reproduzível (Artigo IV —
// No Invention: uma cláusula ausente simplesmente não aparece na lista,
// nunca é inventada). "Resumo executivo automático" aqui é um resumo
// ESTRUTURADO (contagem + lista de cláusulas por severidade), não um texto
// gerado por LLM — mesma honestidade de `construirResumoExecutivoHandoff`
// (`@/lib/server/imobiliarioAltoPadrao`).
//
// Bilíngue (PT/EN): contratos internacionais (EUA/Portugal) usam a mesma
// gaveta — ver Expansão Enterprise Global, `@/lib/guardrails/consistency`
// para o precedente de léxico duplo.
//
// Tudo aqui opera sobre texto JÁ MASCARADO pelo Shield-Layer
// (`@/lib/guardrails/piiVault`) — nenhuma função deste módulo recebe nem
// precisa do texto original em claro.

import type { ClausulaCritica, ClausulaCriticaTipo } from "@/types";

interface DefinicaoClausula {
  tipo: ClausulaCriticaTipo;
  rotulo: string;
  severidade: ClausulaCritica["severidade"];
  padroes: RegExp[];
}

/**
 * Catálogo de cláusulas críticas reconhecidas — severidade reflete o risco
 * operacional de passar batido (ex.: renovação automática/multa custam caro
 * se não forem antecipadas; foro/jurisdição é informativo, não um risco
 * financeiro direto).
 */
const CATALOGO_CLAUSULAS: DefinicaoClausula[] = [
  {
    tipo: "rescisao-unilateral",
    rotulo: "Rescisão unilateral",
    severidade: "alta",
    padroes: [
      /\brescis[ãa]o\s+unilateral\b/i,
      /\bresilir\s+(?:o\s+contrato\s+)?a\s+qualquer\s+tempo\b/i,
      /\bterminate\s+(?:this\s+agreement\s+)?(?:at\s+)?(?:its\s+)?sole\s+discretion\b/i,
      /\bunilateral\s+termination\b/i,
    ],
  },
  {
    tipo: "renovacao-automatica",
    rotulo: "Renovação automática",
    severidade: "alta",
    padroes: [
      /\brenova(?:ç|c)[ãa]o\s+autom[áa]tica\b/i,
      /\bprorroga(?:do|r)\s+automaticamente\b/i,
      /\bautomatic(?:ally)?\s+renew(?:al|s)?\b/i,
      /\bauto-?renewal\b/i,
    ],
  },
  {
    tipo: "multa-penalidade",
    rotulo: "Multa/penalidade",
    severidade: "alta",
    padroes: [
      /\bmulta\s+(?:de\s+)?\d{1,3}\s*%/i,
      /\bpenalidade\s+(?:contratual|de\s+rescis[ãa]o)\b/i,
      /\bpenalty\s+(?:clause|fee)\b/i,
      /\bliquidated\s+damages\b/i,
    ],
  },
  {
    tipo: "confidencialidade",
    rotulo: "Confidencialidade/NDA",
    severidade: "media",
    padroes: [
      /\bcl[áa]usula\s+de\s+confidencialidade\b/i,
      /\bacordo\s+de\s+confidencialidade\b/i,
      /\bnon-?disclosure\s+agreement\b/i,
      /\bconfidentiality\s+(?:clause|obligations?)\b/i,
    ],
  },
  {
    tipo: "nao-concorrencia",
    rotulo: "Não concorrência",
    severidade: "media",
    padroes: [
      /\bn[ãa]o[- ]concorr[êe]ncia\b/i,
      /\bn[ãa]o\s+competi(?:çã|c[ãa])o\b/i,
      /\bnon-?compete\s+clause\b/i,
      /\bnon-?competition\b/i,
    ],
  },
  {
    tipo: "exclusividade",
    rotulo: "Exclusividade",
    severidade: "media",
    padroes: [/\bcl[áa]usula\s+de\s+exclusividade\b/i, /\bexclusivity\s+clause\b/i, /\bexclusive\s+dealing\b/i],
  },
  {
    tipo: "limitacao-responsabilidade",
    rotulo: "Limitação de responsabilidade",
    severidade: "media",
    padroes: [
      /\blimita(?:ç|c)[ãa]o\s+de\s+responsabilidade\b/i,
      /\blimitation\s+of\s+liability\b/i,
      /\bliability\s+cap\b/i,
    ],
  },
  {
    tipo: "foro-jurisdicao",
    rotulo: "Foro/jurisdição",
    severidade: "baixa",
    padroes: [/\bforo\s+d[ae]\s+comarca\b/i, /\bgoverning\s+law\b/i, /\bjurisdiction\s+clause\b/i],
  },
];

/**
 * Analisa o texto (já mascarado) de um contrato e devolve as cláusulas
 * críticas detectadas, na ordem do catálogo. Cada cláusula ausente
 * simplesmente não aparece na lista — nunca inventada.
 */
export function analisarClausulasCriticas(textoMascarado: string): ClausulaCritica[] {
  if (!textoMascarado) return [];
  const encontradas: ClausulaCritica[] = [];

  for (const definicao of CATALOGO_CLAUSULAS) {
    for (const padrao of definicao.padroes) {
      const casamento = textoMascarado.match(padrao);
      if (casamento) {
        encontradas.push({
          tipo: definicao.tipo,
          rotulo: definicao.rotulo,
          trechoDetectado: casamento[0],
          severidade: definicao.severidade,
        });
        break; // Um padrão já basta por tipo de cláusula — evita duplicar o mesmo tipo.
      }
    }
  }

  return encontradas;
}

/**
 * Monta o resumo executivo ESTRUTURADO (contagem + lista por severidade) —
 * nunca um texto gerado por LLM. `null` apenas quando o texto está vazio
 * (nada para resumir), nunca por falha silenciosa.
 */
export function gerarResumoExecutivoContrato(textoMascarado: string, clausulas: ClausulaCritica[]): string | null {
  if (!textoMascarado) return null;
  if (clausulas.length === 0) {
    return "Nenhuma cláusula crítica do catálogo foi identificada neste documento.";
  }

  const altas = clausulas.filter((c) => c.severidade === "alta");
  const partes = [
    `${clausulas.length} cláusula(s) crítica(s) identificada(s)` +
      (altas.length > 0 ? `, ${altas.length} de severidade ALTA` : "") +
      ".",
    ...clausulas.map((c) => `• ${c.rotulo} (${c.severidade}): "${c.trechoDetectado}"`),
  ];
  return partes.join("\n");
}
