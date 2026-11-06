// Módulo Vertical 1 — Construtoras e Imobiliárias de Alto Padrão.
//
// SERVER-ONLY (mas sem Firestore nem Admin SDK: puro e testável, como
// `./episodicMemory` e `./hitlStore`).
//
// Resolve o item "Handoff com Resumo Executivo Mastigado": ao detectar que o
// lead pediu para agendar uma visita presencial, monta um card estruturado
// (Nome, faixa de orçamento, imóvel de interesse, objeção mapeada) para o
// corretor humano assumir a conversa sem repetir perguntas já respondidas.
//
// Tudo aqui opera sobre texto JÁ MASCARADO pelo Shield-Layer
// (`@/lib/guardrails/piiVault`) — nenhuma função deste módulo recebe nem
// precisa do valor original. Isso não é uma limitação: `faixaOrcamento` é
// desenhado para nunca precisar do valor exato. O protocolo de qualificação
// do nicho (`@/lib/nichePrompts`) instrui o agente a sempre pedir/repetir o
// orçamento como uma FAIXA por extenso ("até 800 mil", "entre 1 e 1,5
// milhão") — formato que o detector de PII não mascara (ele só reconhece
// valores com símbolo de moeda explícito, ver `DETECTORES` em
// `@/lib/guardrails/pii`), então a faixa sobrevive ao mascaramento
// naturalmente, sem exigir descriptografia do cofre selado em nenhum ponto.
//
// Mesma filosofia de todo detector determinístico deste código: léxico de
// palavras-chave, sem IA generativa — auditável e reproduzível (Artigo IV —
// No Invention: um campo ausente fica `null`, nunca inventado).

import type { ResumoExecutivoHandoff } from "@/types";

/**
 * Frases que indicam intenção de agendar uma visita presencial ao imóvel —
 * o gatilho do Handoff com Resumo Executivo Mastigado.
 */
const PADROES_AGENDAMENTO_VISITA: RegExp[] = [
  /\bagendar\s+(?:uma\s+)?visita\b/i,
  /\bmarcar\s+(?:uma\s+)?visita\b/i,
  /\bvisita\s+presencial\b/i,
  /\b(?:quero|gostaria\s+de|posso)\s+visitar\b/i,
  /\bconhecer\s+(?:o\s+im[óo]vel|o\s+apartamento|a\s+casa|pessoalmente)\b/i,
  /\bir\s+ver\s+(?:o\s+im[óo]vel|o\s+apartamento|a\s+casa)\b/i,
];

/** `true` quando o texto indica intenção de agendar uma visita presencial. */
export function detectarGatilhoAgendamentoVisita(texto: string): boolean {
  if (!texto) return false;
  return PADROES_AGENDAMENTO_VISITA.some((padrao) => padrao.test(texto));
}

/**
 * Léxico de objeção → rótulo mapeado. A primeira que casar vence — a ordem
 * reflete a objeção mais comumente decisiva primeiro (preço é o motivo mais
 * citado para não avançar, em qualquer pesquisa de vendas de alto ticket).
 */
const LEXICO_OBJECAO: Array<{ padrao: RegExp; rotulo: string }> = [
  {
    padrao: /\b(?:muito\s+)?car[oa]\b|\bfora\s+do\s+(?:meu\s+)?or[çc]amento\b|\bacima\s+do\s+que\s+(?:eu\s+)?(?:posso|pretendia)\b/i,
    rotulo: "Preço acima do orçamento esperado",
  },
  {
    padrao: /\bvou\s+pensar\b|\bpreciso\s+(?:conversar|decidir)\b|\bainda\s+n[ãa]o\s+decidi\b|\bn[ãa]o\s+tenho\s+pressa\b/i,
    rotulo: "Indecisão / ainda não decidiu",
  },
  {
    padrao: /\bvi\s+outr[oa]\s+(?:im[óo]vel|op[çc][ãa]o|apartamento)\b|\bcomparando\s+com\b|\best[óo]u\s+vendo\s+outras\s+op[çc][õo]es\b/i,
    rotulo: "Comparando com outra opção/concorrente",
  },
  {
    padrao: /\bn[ãa]o\s+consegui\s+(?:o\s+)?financiamento\b|\bproblema\s+(?:no|com\s+o)\s+cr[ée]dito\b|\bn[ãa]o\s+aprovaram\b/i,
    rotulo: "Dificuldade de financiamento/crédito",
  },
];

/** Objeção mapeada a partir das mensagens recentes do cliente, ou `null` quando nenhuma foi identificada. */
export function extrairObjecaoMapeada(mensagensClienteRecentes: string[]): string | null {
  for (const texto of mensagensClienteRecentes) {
    for (const { padrao, rotulo } of LEXICO_OBJECAO) {
      if (padrao.test(texto)) return rotulo;
    }
  }
  return null;
}

/** Tipos de imóvel e bairros/destinos de alto padrão reconhecidos. */
const LEXICO_IMOVEL: RegExp[] = [
  /\bcobertura\b/i,
  /\bapartamento\b/i,
  /\bduplex\b/i,
  /\bstudio\b|\bkitnet\b/i,
  /\bcasa\b/i,
  /\bterreno\b/i,
  /\bpraia\s+brava\b/i,
  /\bjurer[êe]\b/i,
  /\bbalne[áa]rio\s+cambori[úu]\b/i,
];

/** Primeira menção a tipo de imóvel ou bairro/destino encontrada no texto, verbatim (sem reformular), ou `null`. */
export function extrairImovelInteresse(mensagensClienteRecentes: string[]): string | null {
  for (const texto of mensagensClienteRecentes) {
    for (const padrao of LEXICO_IMOVEL) {
      const encontrado = texto.match(padrao);
      if (encontrado) return encontrado[0];
    }
  }
  return null;
}

/**
 * Faixa de orçamento por extenso ("até 800 mil", "entre 1 e 1,5 milhão", "na
 * faixa de 2 milhões") — nunca o valor exato em R$, que o PiiVault já
 * mascara antes de qualquer persistência (ver cabeçalho do módulo).
 */
const PADROES_FAIXA_ORCAMENTO: RegExp[] = [
  /\bentre\s+[\d.,]+\s*e\s+[\d.,]+\s*(?:mil|milh[ãõ]o|milh[õo]es)\b/i,
  /\bat[ée]\s+(?:r\$\s*)?[\d.,]+\s*(?:mil|milh[ãõ]o|milh[õo]es)\b/i,
  /\bna\s+faixa\s+de\s+[\d.,]+\s*(?:mil|milh[ãõ]o|milh[õo]es)\b/i,
  /\b[\d.,]+\s*(?:mil|milh[ãõ]o|milh[õo]es)\b/i,
];

/** Faixa de orçamento mencionada por extenso, verbatim, ou `null` quando ausente. */
export function extrairFaixaOrcamento(mensagensClienteRecentes: string[]): string | null {
  for (const texto of mensagensClienteRecentes) {
    for (const padrao of PADROES_FAIXA_ORCAMENTO) {
      const encontrado = texto.match(padrao);
      if (encontrado) return encontrado[0].trim();
    }
  }
  return null;
}

export interface ConstruirResumoExecutivoInput {
  /** `Conversation.participante.nome` — já não é mascarado por desenho (ver `ConversationParticipant`). */
  nomeCliente: string;
  /** Mensagens do cliente, mais recente primeiro ou último — ordem não importa para os extratores. Sempre texto já mascarado. */
  mensagensClienteRecentes: string[];
}

/**
 * Monta o card de resumo executivo para o corretor humano. Campo ausente
 * fica `null` — nunca inventado (Artigo IV).
 */
export function construirResumoExecutivoHandoff(
  input: ConstruirResumoExecutivoInput
): ResumoExecutivoHandoff {
  return {
    nome: input.nomeCliente || null,
    faixaOrcamento: extrairFaixaOrcamento(input.mensagensClienteRecentes),
    imovelInteresse: extrairImovelInteresse(input.mensagensClienteRecentes),
    objecaoMapeada: extrairObjecaoMapeada(input.mensagensClienteRecentes),
  };
}
