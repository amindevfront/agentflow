// Módulo Vertical 3 — Advocacia, Contabilidade & Serviços B2B.
//
// SERVER-ONLY (mas sem Firestore nem Admin SDK: puro e testável, como
// `./imobiliarioAltoPadrao` e `./clinicaAltoPadrao`).
//
// Resolve o item "Handoff com Resumo Executivo B2B": ao confirmar a reunião
// de diagnóstico, monta um card estruturado (Nome, perfil do lead, porte do
// caso, objetivo mapeado) para a equipe de sócios assumir a conversa sem
// repetir perguntas já respondidas.
//
// Mesmo princípio de privacidade de `./imobiliarioAltoPadrao` e
// `./clinicaAltoPadrao`: tudo aqui opera sobre texto JÁ MASCARADO pelo
// Shield-Layer (`@/lib/guardrails/piiVault`) — nenhuma função deste módulo
// recebe nem precisa do valor original. "Porte do caso" é sempre uma
// categoria ("pequena empresa", "startup"), nunca um valor de faturamento
// exato — o protocolo de qualificação do nicho (`@/lib/nichePrompts`)
// instrui o agente a nunca pedir/repetir valor exato de faturamento ou
// causa no chat.
//
// Mesma filosofia de todo detector determinístico deste código: léxico de
// palavras-chave, sem IA generativa — auditável e reproduzível (Artigo IV —
// No Invention: um campo ausente fica `null`, nunca inventado).

import type { ResumoExecutivoB2B } from "@/types";

/**
 * Frases que indicam confirmação da reunião de diagnóstico — o gatilho do
 * Handoff com Resumo Executivo B2B.
 */
const PADROES_CONFIRMACAO_REUNIAO: RegExp[] = [
  /\bpode\s+(?:agendar|marcar)\s+(?:a\s+)?reuni[ãa]o\b/i,
  /\bquero\s+agendar\s+(?:a\s+)?reuni[ãa]o\b/i,
  /\bconfirm[oa]\s+(?:a\s+)?reuni[ãa]o\b/i,
  /\bvamos\s+marcar\s+(?:a\s+)?reuni[ãa]o\b/i,
  /\btopo\s+agendar\b/i,
  /\breuni[ãa]o\s+de\s+diagn[óo]stico\b/i,
];

/** `true` quando o texto indica confirmação da reunião de diagnóstico. */
export function detectarGatilhoConfirmacaoReuniaoDiagnostico(texto: string): boolean {
  if (!texto) return false;
  return PADROES_CONFIRMACAO_REUNIAO.some((padrao) => padrao.test(texto));
}

/** Pessoa física vs. pessoa jurídica — nunca inferido, só quando o próprio lead informou. */
const PADROES_PERFIL_LEAD: Array<{ padrao: RegExp; rotulo: string }> = [
  {
    padrao: /\bminha\s+empresa\b|\bnossa\s+empresa\b|\bpessoa\s+jur[íi]dica\b|\bcnpj\b/i,
    rotulo: "Pessoa jurídica",
  },
  {
    padrao: /\bpessoa\s+f[íi]sica\b|\bpara\s+mim\s+mesmo\b|\bsou\s+aut[ôo]nomo\b|\bmeu\s+cpf\b/i,
    rotulo: "Pessoa física",
  },
];

/** Perfil do lead (PF/PJ) mencionado, ou `null` quando ausente. */
export function extrairPerfilLead(mensagensClienteRecentes: string[]): string | null {
  for (const texto of mensagensClienteRecentes) {
    for (const { padrao, rotulo } of PADROES_PERFIL_LEAD) {
      if (padrao.test(texto)) return rotulo;
    }
  }
  return null;
}

/** Porte do caso/empresa, em categoria — nunca um valor de faturamento exato. */
const PADROES_PORTE_CASO: Array<{ padrao: RegExp; rotulo: string }> = [
  { padrao: /\bstartup\b/i, rotulo: "Startup" },
  { padrao: /\bmei\b|\bmicroempreendedor\b/i, rotulo: "MEI/microempreendedor" },
  { padrao: /\bpequena\s+empresa\b/i, rotulo: "Pequena empresa" },
  { padrao: /\bm[ée]dia\s+empresa\b/i, rotulo: "Média empresa" },
  { padrao: /\bgrande\s+empresa\b|\bmultinacional\b/i, rotulo: "Grande empresa/multinacional" },
];

/** Porte aproximado do caso mencionado, ou `null` quando ausente. */
export function extrairPorteCaso(mensagensClienteRecentes: string[]): string | null {
  for (const texto of mensagensClienteRecentes) {
    for (const { padrao, rotulo } of PADROES_PORTE_CASO) {
      if (padrao.test(texto)) return rotulo;
    }
  }
  return null;
}

/**
 * Áreas jurídicas/contábeis comuns reconhecidas — cobre o vocabulário mais
 * frequente de leads B2B de alto ticket neste nicho. Lista fechada e
 * auditável, não uma taxonomia jurídica completa (fora de escopo).
 */
const LEXICO_OBJETIVO: RegExp[] = [
  /\btrabalhista\b/i,
  /\btribut[áa]rio\b/i,
  /\bsociet[áa]rio\b/i,
  /\bcontrato\b/i,
  /\bfus[ãa]o\b|\baquisi[çc][ãa]o\b/i,
  /\brecupera[çc][ãa]o\s+judicial\b/i,
  /\bdue\s+diligence\b/i,
  /\bauditoria\b/i,
  /\bimposto\s+de\s+renda\b/i,
  /\babertura\s+de\s+empresa\b/i,
  /\bregulariza[çc][ãa]o\s+fiscal\b/i,
  /\bfolha\s+de\s+pagamento\b/i,
  /\bplanejamento\s+tribut[áa]rio\b/i,
];

/** Primeira menção a área jurídica/contábil encontrada no texto, verbatim, ou `null`. */
export function extrairObjetivoMapeado(mensagensClienteRecentes: string[]): string | null {
  for (const texto of mensagensClienteRecentes) {
    for (const padrao of LEXICO_OBJETIVO) {
      const encontrado = texto.match(padrao);
      if (encontrado) return encontrado[0];
    }
  }
  return null;
}

export interface ConstruirResumoExecutivoB2BInput {
  /** `Conversation.participante.nome` — já não é mascarado por desenho (ver `ConversationParticipant`). */
  nomeLead: string;
  /** Mensagens do lead, ordem não importa para os extratores. Sempre texto já mascarado. */
  mensagensClienteRecentes: string[];
}

/**
 * Monta o card de resumo executivo B2B para a equipe de sócios. Campo
 * ausente fica `null` — nunca inventado (Artigo IV).
 */
export function construirResumoExecutivoB2B(input: ConstruirResumoExecutivoB2BInput): ResumoExecutivoB2B {
  return {
    nome: input.nomeLead || null,
    perfilLead: extrairPerfilLead(input.mensagensClienteRecentes),
    porteCaso: extrairPorteCaso(input.mensagensClienteRecentes),
    objetivoMapeado: extrairObjetivoMapeado(input.mensagensClienteRecentes),
  };
}
