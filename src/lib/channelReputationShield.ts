// SAC Shield — Blindagem de Reputação de Canal (anti-banimento).
//
// Avaliação PURA de risco de disparo a um canal de mensageria (hoje:
// WhatsApp Business Cloud API, o canal mais suscetível a banimento por
// denúncia de spam). Sem rede, sem Firestore, sem `node:crypto` — mesma
// restrição documentada em `@/lib/inbox/channelAdapters`, porque este módulo
// também precisa ser avaliável antes de qualquer tentativa de envio, em
// qualquer ambiente (inclusive o componente de cliente que compõe a prévia
// de risco de uma campanha antes de agendá-la).
//
// A isolação de conexão instável (disjuntor) e a fila de reenvio inteligente
// são responsabilidade do lado server-only, `@/lib/server/channelReputationShieldAdmin`
// — aquele módulo CHAMA este para decidir, este módulo nunca sabe de
// Firestore nem do disjuntor.
//
// Três sinais, combinados:
//
//   1. conteúdo — léxico de termos-gatilho de denúncia de spam (ver
//      `LEXICO_RISCO_SPAM`), mesma filosofia determinística e auditável do
//      léxico de Compliance Preventivo em `@/lib/guardrails/compliancePreventivo`;
//   2. volume — picos anômalos, decididos fora deste módulo (o chamador
//      consulta o limitador de taxa distribuído e informa o resultado);
//   3. estabilidade da conexão — o disjuntor do canal, decidido fora deste
//      módulo pela mesma razão.
//
// Por desenho, qualquer um dos três sinais críticos basta para recomendar
// NÃO enviar agora — a assimetria de custo é real: perder alguns segundos de
// um disparo custa muito menos do que o número do cliente ser banido pelo
// WhatsApp, o que tipicamente encerra o canal de atendimento inteiro.

import type { AvaliacaoRiscoDisparoCanal } from "@/types";

interface SinalLexicoSpam {
  padrao: RegExp;
  peso: number;
  categoria: string;
}

/**
 * Termos e padrões que, em agregação de mercado (WhatsApp Business Cloud
 * API, Meta), concentram denúncias de spam — a causa-raiz de banimento de
 * número comercial. Léxico determinístico: mesma filosofia de
 * `LEXICO_PROMESSA_INDEVIDA`/`LEXICO_CONDUTA_INADEQUADA` em
 * `@/lib/guardrails/compliancePreventivo`, auditável e reproduzível, sem IA
 * generativa no caminho de decisão.
 */
const LEXICO_RISCO_SPAM: SinalLexicoSpam[] = [
  { padrao: /\b(promo[çc][ãa]o\s+imperd[íi]vel|oferta\s+imperd[íi]vel|[úu]ltima\s+chance|corre\s+que\s+(?:[ée]|acaba))\b/i, peso: 14, categoria: "urgência comercial agressiva" },
  { padrao: /\b(gr[áa]tis|de\s+gra[çc]a|sem\s+custo\s+nenhum)\b/i, peso: 10, categoria: "oferta gratuita" },
  { padrao: /\b(ganhe?\s+(?:dinheiro|r\$|premi[oa]s?)|renda\s+extra\s+garantida)\b/i, peso: 18, categoria: "promessa financeira típica de spam" },
  { padrao: /\b(clique\s+(?:aqui|no\s+link)|acesse\s+agora|confira\s+agora)\b/i, peso: 12, categoria: "chamada para ação de spam" },
  { padrao: /(https?:\/\/)?(bit\.ly|tinyurl\.com|t\.co|is\.gd|cutt\.ly)\/\S+/i, peso: 20, categoria: "link de encurtador" },
  { padrao: /!{3,}|\?{3,}/, peso: 8, categoria: "pontuação repetida excessiva" },
  { padrao: /[A-ZÀ-Ú]{10,}/, peso: 8, categoria: "trecho em caixa alta excessiva" },
  { padrao: /(.)\1{4,}/, peso: 6, categoria: "caractere repetido excessivamente" },
];

/**
 * Soma o peso de cada sinal presente no texto — múltiplos sinais acumulam,
 * porque a combinação ("GRÁTIS!!! clique aqui bit.ly/xyz") é o padrão real
 * de mensagem que gera denúncia em massa, não um único termo isolado.
 */
export function avaliarRiscoConteudoDisparo(texto: string): { peso: number; motivos: string[] } {
  if (!texto || texto.trim().length === 0) return { peso: 0, motivos: [] };

  let peso = 0;
  const motivos: string[] = [];
  for (const sinal of LEXICO_RISCO_SPAM) {
    if (sinal.padrao.test(texto)) {
      peso += sinal.peso;
      motivos.push(sinal.categoria);
    }
  }
  return { peso, motivos };
}

/** Peso de conteúdo a partir do qual o disparo é bloqueado, não apenas atrasado. */
const LIMIAR_CONTEUDO_CRITICO = 26;
/** Peso de conteúdo a partir do qual o disparo é permitido, mas com atraso extra recomendado. */
const LIMIAR_CONTEUDO_ELEVADO = 12;

/** Atraso recomendado quando o risco é apenas "elevado" — soma-se ao jitter já existente da campanha, nunca substitui. */
const ATRASO_RISCO_ELEVADO_MS = 5_000;

export interface AvaliarRiscoDisparoCanalInput {
  texto: string;
  /** `true` quando o limitador de taxa distribuído já negou um token para esta chave (canal+workspace) — decidido pelo chamador. */
  limiteDeVolumeExcedido: boolean;
  /** `true` quando o disjuntor deste canal está aberto (conexão externa instável) — decidido pelo chamador. */
  disjuntorAberto: boolean;
}

/**
 * Combina os três sinais em um veredito único. Qualquer sinal crítico
 * (volume ou disjuntor) basta para bloquear incondicionalmente, antes mesmo
 * de olhar o conteúdo — um canal instável ou um pico de volume são, por si
 * só, risco de banimento, independente do que a mensagem diz.
 */
export function avaliarRiscoDisparoCanal(input: AvaliarRiscoDisparoCanalInput): AvaliacaoRiscoDisparoCanal {
  const motivos: string[] = [];

  if (input.disjuntorAberto) {
    motivos.push("canal externo instável — disjuntor aberto");
  }
  if (input.limiteDeVolumeExcedido) {
    motivos.push("pico de volume anômalo — limite de disparos por minuto excedido");
  }

  const conteudo = avaliarRiscoConteudoDisparo(input.texto);
  if (conteudo.peso >= LIMIAR_CONTEUDO_CRITICO) {
    motivos.push(...conteudo.motivos.map((m) => `conteúdo de alto risco: ${m}`));
  } else if (conteudo.peso >= LIMIAR_CONTEUDO_ELEVADO) {
    motivos.push(...conteudo.motivos.map((m) => `conteúdo de risco moderado: ${m}`));
  }

  const criticoPorInfraestrutura = input.disjuntorAberto || input.limiteDeVolumeExcedido;
  const criticoPorConteudo = conteudo.peso >= LIMIAR_CONTEUDO_CRITICO;

  if (criticoPorInfraestrutura || criticoPorConteudo) {
    return { nivel: "critico", permitido: false, motivos, atrasoMsRecomendado: 0 };
  }

  if (conteudo.peso >= LIMIAR_CONTEUDO_ELEVADO) {
    return { nivel: "elevado", permitido: true, motivos, atrasoMsRecomendado: ATRASO_RISCO_ELEVADO_MS };
  }

  return { nivel: "normal", permitido: true, motivos: [], atrasoMsRecomendado: 0 };
}
