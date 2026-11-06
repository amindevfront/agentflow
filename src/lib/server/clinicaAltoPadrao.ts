// Módulo Vertical 2 — Clínicas de Saúde, Estética Avançada & Especialistas
// de Alto Padrão.
//
// SERVER-ONLY (mas sem Firestore nem Admin SDK: puro e testável, como
// `./imobiliarioAltoPadrao` e `./episodicMemory`).
//
// Resolve o item "Handoff com Resumo Executivo Clínico": ao confirmar o
// agendamento da avaliação/consulta, monta um card estruturado (Nome,
// queixa principal, histórico resumido, objeção mapeada) para a equipe
// assumir a conversa sem repetir perguntas já respondidas.
//
// Mesmo princípio de privacidade de `./imobiliarioAltoPadrao`: tudo aqui
// opera sobre texto JÁ MASCARADO pelo Shield-Layer
// (`@/lib/guardrails/piiVault`) — nenhuma função deste módulo recebe nem
// precisa do valor original. "Queixa principal" e "histórico resumido" são
// dado clínico (LGPD art. 5º, II — dado sensível de saúde), não PII de
// identificação — o protocolo de qualificação do nicho
// (`@/lib/nichePrompts`) instrui o agente a nunca pedir número de
// documento/exame por escrito no chat; o que sobrevive ao mascaramento é
// exatamente a descrição clínica em linguagem natural que a equipe precisa.
//
// Mesma filosofia de todo detector determinístico deste código: léxico de
// palavras-chave, sem IA generativa — auditável e reproduzível (Artigo IV —
// No Invention: um campo ausente fica `null`, nunca inventado).

import type { ResumoExecutivoClinico } from "@/types";

/**
 * Frases que indicam confirmação de agendamento de consulta/avaliação — o
 * gatilho do Handoff com Resumo Executivo Clínico.
 */
const PADROES_CONFIRMACAO_AGENDAMENTO: RegExp[] = [
  /\bpode\s+(?:agendar|marcar)\b/i,
  /\bquero\s+agendar\b/i,
  /\bconfirm[oa]\s+(?:o\s+)?agendamento\b/i,
  /\bconfirm[oa]\s+a\s+consulta\b/i,
  /\bvamos\s+agendar\b/i,
  /\bbora\s+agendar\b/i,
  /\bagendar\s+(?:uma\s+)?(?:consulta|avalia[çc][ãa]o)\b/i,
  /\bmarcar\s+(?:a\s+)?(?:consulta|avalia[çc][ãa]o)\b/i,
];

/** `true` quando o texto indica confirmação de agendamento de consulta/avaliação. */
export function detectarGatilhoConfirmacaoAgendamento(texto: string): boolean {
  if (!texto) return false;
  return PADROES_CONFIRMACAO_AGENDAMENTO.some((padrao) => padrao.test(texto));
}

/**
 * Léxico de objeção → rótulo mapeado — riscos próprios do contexto
 * clínico/estético (medo, tempo de recuperação), distintos do léxico
 * comercial de `./imobiliarioAltoPadrao`. A primeira que casar vence.
 */
const LEXICO_OBJECAO_CLINICA: Array<{ padrao: RegExp; rotulo: string }> = [
  {
    padrao: /\btenho\s+medo\b|\bestou\s+com\s+medo\b|\bfico\s+ansios[oa]\b|\bme\s+d[áa]\s+medo\b/i,
    rotulo: "Medo/ansiedade em relação ao procedimento",
  },
  {
    padrao: /\brecupera[çc][ãa]o\s+(?:muito\s+)?longa\b|\bn[ãa]o\s+tenho\s+tempo\s+(?:para|de)\s+(?:ficar\s+de\s+)?repouso\b/i,
    rotulo: "Preocupação com tempo de recuperação",
  },
  {
    padrao: /\b(?:muito\s+)?car[oa]\b|\bfora\s+do\s+(?:meu\s+)?or[çc]amento\b/i,
    rotulo: "Preço acima do orçamento esperado",
  },
  {
    padrao: /\bvou\s+pensar\b|\bpreciso\s+(?:decidir\s+com\s+calma|conversar)\b|\bainda\s+n[ãa]o\s+decidi\b/i,
    rotulo: "Indecisão / ainda não decidiu",
  },
  {
    padrao: /\bvi\s+outr[oa]\s+(?:cl[íi]nica|m[ée]dic[oa]|especialista)\b|\bcomparando\s+(?:com\s+)?(?:outra\s+)?op[çc][õo]es\b/i,
    rotulo: "Comparando com outra clínica/especialista",
  },
];

/** Objeção mapeada a partir das mensagens recentes do paciente, ou `null` quando nenhuma foi identificada. */
export function extrairObjecaoMapeada(mensagensClienteRecentes: string[]): string | null {
  for (const texto of mensagensClienteRecentes) {
    for (const { padrao, rotulo } of LEXICO_OBJECAO_CLINICA) {
      if (padrao.test(texto)) return rotulo;
    }
  }
  return null;
}

/**
 * Procedimentos/queixas estéticas e médicas comuns reconhecidos — cobre o
 * vocabulário mais frequente de leads de alto ticket neste nicho (estética
 * avançada, odontologia, harmonização). Lista fechada e auditável, não um
 * dicionário médico completo (fora de escopo e fora do que é seguro inferir
 * sem avaliação presencial — ver o próprio Guardrail Clínico/Ético).
 */
const LEXICO_PROCEDIMENTO_OU_QUEIXA: RegExp[] = [
  /\bbot[oó]x\b/i,
  /\bpreenchimento\b/i,
  /\bharmoniza[çc][ãa]o\s+facial\b/i,
  /\blipoaspira[çc][ãa]o\b|\blipo\b/i,
  /\brinoplastia\b/i,
  /\bmamoplastia\b/i,
  /\bimplante\s+dent[áa]rio\b/i,
  /\bclareamento\s+dental\b/i,
  /\bflacidez\b/i,
  /\bmanchas?\s+(?:na\s+pele|no\s+rosto)\b/i,
  /\bgordura\s+localizada\b/i,
  /\brugas?\b/i,
  /\bacne\b/i,
  /\bcelulite\b/i,
];

/** Primeira menção a procedimento/queixa encontrada no texto, verbatim (sem reformular), ou `null`. */
export function extrairQueixaPrincipal(mensagensClienteRecentes: string[]): string | null {
  for (const texto of mensagensClienteRecentes) {
    for (const padrao of LEXICO_PROCEDIMENTO_OU_QUEIXA) {
      const encontrado = texto.match(padrao);
      if (encontrado) return encontrado[0];
    }
  }
  return null;
}

/**
 * Sinais de histórico relevante (procedimento anterior, alergia, condição
 * preexistente) — verbatim, nunca inferido além do que o paciente já disse.
 */
const PADROES_HISTORICO: RegExp[] = [
  /\bj[áa]\s+fiz\s+[^.!?\n]{1,80}/i,
  /\bj[áa]\s+tratei\s+[^.!?\n]{1,80}/i,
  /\btenho\s+hist[óo]rico\s+de\s+[^.!?\n]{1,80}/i,
  /\bsou\s+al[ée]rgic[oa]\s+a\s+[^.!?\n]{1,80}/i,
  /\btomo\s+[^.!?\n]{1,80}/i,
];

/** Trecho de histórico relevante mencionado pelo paciente, verbatim, ou `null` quando ausente. */
export function extrairHistoricoResumido(mensagensClienteRecentes: string[]): string | null {
  for (const texto of mensagensClienteRecentes) {
    for (const padrao of PADROES_HISTORICO) {
      const encontrado = texto.match(padrao);
      if (encontrado) return encontrado[0].trim();
    }
  }
  return null;
}

export interface ConstruirResumoExecutivoClinicoInput {
  /** `Conversation.participante.nome` — já não é mascarado por desenho (ver `ConversationParticipant`). */
  nomePaciente: string;
  /** Mensagens do paciente, ordem não importa para os extratores. Sempre texto já mascarado. */
  mensagensClienteRecentes: string[];
}

/**
 * Monta o card de resumo executivo clínico para a equipe. Campo ausente
 * fica `null` — nunca inventado (Artigo IV).
 */
export function construirResumoExecutivoClinico(
  input: ConstruirResumoExecutivoClinicoInput
): ResumoExecutivoClinico {
  return {
    nome: input.nomePaciente || null,
    queixaPrincipal: extrairQueixaPrincipal(input.mensagensClienteRecentes),
    historicoResumido: extrairHistoricoResumido(input.mensagensClienteRecentes),
    objecaoMapeada: extrairObjecaoMapeada(input.mensagensClienteRecentes),
  };
}
