// Compliance Preventivo — blindagem trabalhista & LGPD.
//
// Varre mensagens de OPERADORES e AGENTES DE IA (nunca do cliente — aqui o
// risco é o que a empresa diz, não o que o cliente sente, que já é o radar
// de sentimento em `@/lib/sentiment/radar`) em busca de dois riscos
// concretos de passivo trabalhista/regulatório:
//
//   1. Promessa comercial/financeira indevida — "garantido", "aprovação
//      garantida", "sem risco nenhum" — o tipo de afirmação que, registrada
//      por escrito, sustenta uma ação por propaganda enganosa (CDC art. 37)
//      ou cobrança de obrigação que a empresa nunca se comprometeu a cumprir.
//   2. Conduta inadequada — linguagem ofensiva, assédio ou aproximação
//      pessoal indevida — o tipo de mensagem que, vinda de um preposto da
//      empresa (humano ou IA), é a evidência central de uma reclamação
//      trabalhista ou cível.
//
// Mesma filosofia de todo detector determinístico deste módulo: léxico de
// sinais com peso, sem rede, sem IA generativa — auditável e reproduzível.
// Por desenho, NUNCA bloqueia o envio: um falso positivo em linguagem
// natural é esperado, e impedir uma resposta legítima por engano custa mais
// do que o risco que esta checagem existe para mitigar. O papel dela é abrir
// um alerta preventivo (ticket de transbordo) para revisão humana — ver
// `enviarMensagemOperador` em `@/lib/inbox/firestore`.

import type { GuardrailSeverity, GuardrailViolation } from "@/types";

interface SinalLexico {
  padrao: RegExp;
  peso: number;
  categoria: string;
}

const LEXICO_PROMESSA_INDEVIDA: SinalLexico[] = [
  { padrao: /\b(garantid[oa]s?|garantimos|100\s*%\s*garantido)\b/i, peso: 24, categoria: "promessa de resultado garantido" },
  { padrao: /\b(sem\s+nenhum\s+risco|zero\s+risco|risco\s+zero)\b/i, peso: 20, categoria: "promessa de ausência de risco" },
  { padrao: /\b(aprova(?:c|ç)[ãa]o\s+garantida|cr[ée]dito\s+garantido|empr[ée]stimo\s+garantido)\b/i, peso: 28, categoria: "promessa financeira indevida" },
  { padrao: /\b(juro\s+que|prometo\s+que|tenho\s+certeza\s+absoluta)\b/i, peso: 14, categoria: "compromisso pessoal informal" },
  { padrao: /\bn[ãa]o\s+vai\s+se\s+arrepender\b/i, peso: 10, categoria: "promessa de satisfação" },
  { padrao: /\bdevolu(?:c|ç)[ãa]o\s+total\s+garantida\b/i, peso: 18, categoria: "promessa de reembolso incondicional" },
  { padrao: /\bmelhor\s+(?:do\s+que|que)\s+(?:qualquer|todo[s]?)\s+concorrente\b/i, peso: 12, categoria: "comparação competitiva indevida" },
];

const LEXICO_CONDUTA_INADEQUADA: SinalLexico[] = [
  { padrao: /\b(gata|gato|lind[ao]|gostos[ao]|bonit[ao])\b/i, peso: 26, categoria: "comentário pessoal inapropriado" },
  { padrao: /\b(sair\s+com\s+voc[eê]|ir\s+num\s+encontro|seu\s+(?:whatsapp|zap)\s+pessoal|me\s+chama\s+(?:no\s+)?particular)\b/i, peso: 24, categoria: "aproximação pessoal indevida" },
  { padrao: /\b(cala\s+a\s+boca|idiota|burr[oa]|in[úu]til|est[úu]pid[oa]|imbecil)\b/i, peso: 32, categoria: "linguagem ofensiva" },
  { padrao: /\b(ningu[ée]m\s+vai\s+acreditar\s+em\s+voc[eê]|voc[eê]\s+vai\s+se\s+lamentar|vai\s+se\s+arrepender\s+disso)\b/i, peso: 30, categoria: "ameaça ou intimidação" },
];

/** Severidade a partir do peso acumulado — mesma escala usada em todo o motor de guardrails. */
function severidadePorPeso(peso: number): GuardrailSeverity {
  if (peso >= 28) return "critica";
  if (peso >= 18) return "alta";
  if (peso >= 1) return "media";
  return "info";
}

function avaliarLexico(texto: string, lexico: SinalLexico[]): { peso: number; categorias: string[] } {
  let peso = 0;
  const categorias = new Set<string>();
  for (const sinal of lexico) {
    if (sinal.padrao.test(texto)) {
      peso += sinal.peso;
      categorias.add(sinal.categoria);
    }
  }
  return { peso, categorias: [...categorias] };
}

export interface CompliancePreventivoResultado {
  violacoes: GuardrailViolation[];
  /** Categorias textuais detectadas — para telemetria e para o brief do painel de compliance. */
  categorias: string[];
}

/**
 * Detecta risco de passivo trabalhista/regulatório em uma mensagem de
 * operador ou IA. Texto de entrada deve já estar mascarado (Shield-Layer) —
 * este detector olha apenas para o conteúdo da conduta, não para PII.
 */
export function detectarCompliancePreventivo(texto: string): CompliancePreventivoResultado {
  if (!texto || texto.trim().length === 0) {
    return { violacoes: [], categorias: [] };
  }

  const violacoes: GuardrailViolation[] = [];
  const categorias: string[] = [];

  const promessa = avaliarLexico(texto, LEXICO_PROMESSA_INDEVIDA);
  if (promessa.peso > 0) {
    violacoes.push({
      regra: "promessa-comercial-indevida",
      severidade: severidadePorPeso(promessa.peso),
      mensagem: `Possível promessa comercial/financeira indevida: ${promessa.categorias.join(", ")}.`,
      score: promessa.peso,
    });
    categorias.push(...promessa.categorias);
  }

  const conduta = avaliarLexico(texto, LEXICO_CONDUTA_INADEQUADA);
  if (conduta.peso > 0) {
    violacoes.push({
      regra: "conduta-inadequada",
      severidade: severidadePorPeso(conduta.peso),
      mensagem: `Possível risco de assédio/conduta inadequada: ${conduta.categorias.join(", ")}.`,
      score: conduta.peso,
    });
    categorias.push(...conduta.categorias);
  }

  return { violacoes, categorias: [...new Set(categorias)] };
}
