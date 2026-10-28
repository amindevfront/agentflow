// Lead Qualificado de Alto Padrão — nicho Imobiliário/Construtoras.
//
// Mesma filosofia de todo detector determinístico deste módulo (radar de
// sentimento, compliance preventivo): léxico de sinais com peso, sem rede,
// sem IA generativa — auditável e reproduzível. A qualificação exige as
// DUAS dimensões ao mesmo tempo — capacidade de investimento E urgência de
// compra — porque cada uma isolada é fraca demais: "tenho orçamento" sem
// pressa é um lead frio pesquisando; "preciso decidir essa semana" sem
// capacidade financeira clara é só um lead ansioso. As duas juntas são o
// sinal real de que vale priorizar o atendimento.

export interface SinalLexico {
  padrao: RegExp;
  categoria: string;
}

const SINAIS_CAPACIDADE: SinalLexico[] = [
  { padrao: /\bà\s*vista\b/i, categoria: "pagamento à vista" },
  { padrao: /\bsem\s+(?:precisar\s+de\s+)?financiamento\b/i, categoria: "sem financiamento" },
  { padrao: /\bor[çc]amento\s+(?:de\s+)?(?:at[ée]\s+)?r?\$?\s*\d/i, categoria: "orçamento declarado" },
  { padrao: /\bposso\s+pagar\b/i, categoria: "capacidade de pagamento declarada" },
  { padrao: /\btenho\s+(?:o\s+)?valor\s+(?:todo\s+)?(?:dispon[íi]vel|em\s+m[ãa]os)\b/i, categoria: "capital disponível" },
  { padrao: /\bcapital\s+(?:dispon[íi]vel|pronto)\b/i, categoria: "capital disponível" },
  { padrao: /\bentrada\s+de\s+r?\$?\s*\d/i, categoria: "entrada financeira declarada" },
];

const SINAIS_URGENCIA: SinalLexico[] = [
  { padrao: /\burgente\b/i, categoria: "urgência declarada" },
  { padrao: /\bpreciso\s+(?:decidir|fechar|resolver)\s+(?:essa|esta)\s+semana\b/i, categoria: "decisão nesta semana" },
  { padrao: /\bantes\s+do\s+fim\s+do\s+m[êe]s\b/i, categoria: "prazo até fim do mês" },
  { padrao: /\bquero\s+fechar\s+(?:hoje|agora|logo|j[áa])\b/i, categoria: "fechamento imediato" },
  { padrao: /\bmudan[çc]a\s+urgente\b/i, categoria: "mudança urgente" },
  { padrao: /\bpreciso\s+(?:me\s+)?mudar\s+(?:logo|rápido|urgente)\b/i, categoria: "necessidade de mudança rápida" },
];

function sinaisCasados(texto: string, lexico: SinalLexico[]): string[] {
  const categorias = new Set<string>();
  for (const sinal of lexico) {
    if (sinal.padrao.test(texto)) categorias.add(sinal.categoria);
  }
  return [...categorias];
}

export interface LeadAltoPadraoResultado {
  /** `true` somente quando AMBAS as dimensões (capacidade + urgência) foram detectadas. */
  qualificado: boolean;
  sinaisCapacidade: string[];
  sinaisUrgencia: string[];
}

/**
 * Avalia o conjunto de mensagens do cliente em busca de sinais de alta
 * intenção de compra qualificada. Determinístico: mesma entrada, mesmo
 * resultado, sempre — necessário para que a tag na UI seja auditável.
 */
export function detectarLeadAltoPadrao(mensagensCliente: string[]): LeadAltoPadraoResultado {
  const sinaisCapacidade = new Set<string>();
  const sinaisUrgencia = new Set<string>();

  for (const mensagem of mensagensCliente) {
    if (typeof mensagem !== "string" || mensagem.trim().length === 0) continue;
    sinaisCasados(mensagem, SINAIS_CAPACIDADE).forEach((s) => sinaisCapacidade.add(s));
    sinaisCasados(mensagem, SINAIS_URGENCIA).forEach((s) => sinaisUrgencia.add(s));
  }

  return {
    qualificado: sinaisCapacidade.size > 0 && sinaisUrgencia.size > 0,
    sinaisCapacidade: [...sinaisCapacidade],
    sinaisUrgencia: [...sinaisUrgencia],
  };
}
