// Radar preditivo de churn e sentimento — Frustration Index.
//
// Isomórfico e determinístico por desenho: a mesma conversa, com os mesmos
// timestamps, produz sempre o mesmo índice. Isso é o que torna o "Circuit
// Breaker" e o SLA P1 auditáveis — um supervisor que questiona por que um
// caso escalou precisa conseguir reconstruir a conta, não receber "a IA
// decidiu assim". Reaproveita `similaridade`/`tokenizar`/`normalizar` de
// `@/lib/guardrails` (consistência textual já construída e testada ali) em
// vez de duplicar um segundo analisador de texto.
//
// O brief executivo determinístico (`gerarExecutiveBrief`) é SEMPRE
// disponível, sem depender de rede nem de chave de API — é o fallback
// garantido. Um realce por IA é opcional e vive em
// `src/app/api/inbox/executive-brief/route.ts`, seguindo o mesmo padrão de
// degradação graciosa do motor de orquestração.

import type { FrustrationResult, FrustrationTrend, ExecutiveBrief } from "@/types";
import { similaridade, tokenizar } from "@/lib/guardrails";

/**
 * Índice a partir do qual o Circuit Breaker dispara um P1 de SLA.
 *
 * Calibrado para disparar exatamente no caso realista mais grave de UMA única
 * mensagem (ameaça regulatória/jurídica + risco de cancelamento + insatisfação
 * forte ≈ 70), sem disparar para reclamações isoladas de menor severidade.
 */
export const LIMIAR_FRUSTRACAO_CRITICA = 70;

/** Peso de decaimento aplicado a mensagens mais antigas no cálculo do índice atual. */
const DECAIMENTO_HISTORICO = 0.6;

// ---------------------------------------------------------------------------
// Léxico de sinais — PT-BR. Cada entrada é um fator de peso, não um booleano:
// "cancelar" pesa mais que "demora", porque sinaliza risco de churn, não só
// insatisfação momentânea.
// ---------------------------------------------------------------------------

const LEXICO_CHURN: Array<{ padrao: RegExp; peso: number; categoria: string }> = [
  { padrao: /\bcancelar?(mento)?\b/i, peso: 22, categoria: "risco de cancelamento" },
  { padrao: /\b(procon|reclame\s*aqui|processo|advogad[oa]|juiz[ao]do|justi[çc]a)\b/i, peso: 28, categoria: "ameaça regulatória/jurídica" },
  { padrao: /\bnunca\s+mais\b/i, peso: 18, categoria: "risco de churn" },
  { padrao: /\b(p[ée]ssimo|horr[íi]vel|absurdo|rid[íi]culo|inaceit[áa]vel|vergonha)\b/i, peso: 16, categoria: "insatisfação forte" },
  { padrao: /\bp[ée]ssim[oa]\s+atendimento\b/i, peso: 16, categoria: "insatisfação forte" },
  { padrao: /\bn[ãa]o\s+(funciona|resolve|resolveu|atende)\b/i, peso: 12, categoria: "problema não resolvido" },
  { padrao: /\b(demora|demorando|esperando\s+h[áa]|esperando\s+desde)\b/i, peso: 10, categoria: "demora percebida" },
  { padrao: /\b(j[áa]\s+pedi|j[áa]\s+falei|repetindo|de\s+novo|novamente)\b/i, peso: 10, categoria: "repetição de pedido" },
  { padrao: /\bquero\s+(meu\s+)?dinheiro\s+de\s+volta|reembolso\b/i, peso: 14, categoria: "pedido de reembolso" },
  { padrao: /\bningu[ée]m\s+(me\s+)?(responde|ajuda|resolve)\b/i, peso: 14, categoria: "sensação de abandono" },
];

function contarMaiusculas(texto: string): { letras: number; maiusculas: number } {
  let letras = 0;
  let maiusculas = 0;
  for (const caractere of texto) {
    if (/[a-zà-ú]/i.test(caractere)) {
      letras += 1;
      if (caractere === caractere.toUpperCase() && caractere !== caractere.toLowerCase()) {
        maiusculas += 1;
      }
    }
  }
  return { letras, maiusculas };
}

export interface AnaliseMensagemSentimento {
  /** Contribuição de frustração desta mensagem isolada (0..100). */
  score: number;
  sinais: string[];
}

/**
 * Analisa uma única mensagem do cliente. Texto de entrada é o já mascarado
 * pelo Shield-Layer — marcadores de PII (`[[PII:TIPO:N]]`) não carregam
 * carga emocional e não distorcem o score.
 */
export function analisarSentimentoMensagem(texto: string): AnaliseMensagemSentimento {
  const sinais: string[] = [];
  let score = 0;

  if (!texto || texto.trim().length === 0) {
    return { score: 0, sinais: [] };
  }

  // 1. Léxico de churn/insatisfação — a maior fonte de sinal.
  for (const { padrao, peso, categoria } of LEXICO_CHURN) {
    if (padrao.test(texto)) {
      score += peso;
      sinais.push(categoria);
    }
  }

  // 2. Caixa alta — "gritar" por escrito. Só conta em trechos com letras
  // suficientes para não disparar em siglas curtas ("CPF", "OK").
  const { letras, maiusculas } = contarMaiusculas(texto);
  if (letras >= 8) {
    const razaoMaiuscula = maiusculas / letras;
    if (razaoMaiuscula > 0.6) {
      score += 14;
      sinais.push("texto em caixa alta");
    }
  }

  // 3. Densidade de exclamação/interrogação repetida.
  const exclamacoesRepetidas = texto.match(/[!?]{2,}/g) ?? [];
  if (exclamacoesRepetidas.length > 0) {
    score += Math.min(12, exclamacoesRepetidas.length * 4);
    sinais.push("pontuação de ênfase repetida");
  }

  return { score: Math.min(100, score), sinais: [...new Set(sinais)] };
}

export interface HistoricoFrustracao {
  /** Mensagens do cliente, em ordem cronológica — a mais recente por último. */
  mensagensCliente: string[];
  /**
   * Segundos entre a última mensagem do cliente e a resposta (se já
   * respondida) ou entre a última mensagem e agora (se ainda em espera).
   */
  latenciaRespostaSegundos?: number;
  /** SLA de resposta esperado para este canal/prioridade, em segundos. */
  slaRespostaSegundos: number;
}

/** Penalidade de latência: cresce com o quanto o SLA foi excedido, até um teto. */
function penalidadeLatencia(latenciaSegundos: number | undefined, slaSegundos: number): {
  penalidade: number;
  sinal: string | null;
} {
  if (typeof latenciaSegundos !== "number" || !Number.isFinite(latenciaSegundos) || latenciaSegundos <= 0) {
    return { penalidade: 0, sinal: null };
  }
  if (slaSegundos <= 0 || latenciaSegundos <= slaSegundos) {
    return { penalidade: 0, sinal: null };
  }

  const excedenteRazao = latenciaSegundos / slaSegundos - 1;
  const penalidade = Math.min(30, excedenteRazao * 18);
  return { penalidade, sinal: "tempo de resposta acima do SLA" };
}

/**
 * Remove pontuação de final de palavra/frase antes da comparação.
 *
 * `normalizar()` (em `@/lib/guardrails`) preserva `.`/`,` deliberadamente —
 * aquele módulo foi construído para checagem de fundamentação numérica, onde
 * pontuação separa milhar/decimal. Para "o cliente repetiu a reclamação?",
 * essa pontuação só gruda em palavras ("chegou," vs "chegou") e reduz a
 * sobreposição de tokens por motivo errado.
 */
function limparPontuacaoFinal(texto: string): string {
  return texto.replace(/[.,!?;:]+(?=\s|$)/g, "");
}

/** Compara as duas últimas mensagens do cliente: repetir a mesma reclamação é escalada, não ruído. */
function penalidadeRepeticao(mensagens: string[]): { penalidade: number; sinal: string | null } {
  if (mensagens.length < 2) return { penalidade: 0, sinal: null };

  const atual = limparPontuacaoFinal(mensagens[mensagens.length - 1]);
  const anterior = limparPontuacaoFinal(mensagens[mensagens.length - 2]);
  if (tokenizar(atual).length < 3 || tokenizar(anterior).length < 3) {
    return { penalidade: 0, sinal: null };
  }

  // Limiar deliberadamente moderado: reclamações reais repetidas raramente são
  // idênticas palavra por palavra — o cliente parafraseia. Um limiar alto
  // demais deixaria passar exatamente o padrão que esta checagem existe para
  // capturar.
  const sim = similaridade(atual, anterior);
  if (sim >= 0.4) {
    return { penalidade: Math.min(20, sim * 24), sinal: "reclamação repetida sem solução" };
  }
  return { penalidade: 0, sinal: null };
}

/**
 * Calcula o índice de frustração corrente de uma conversa (0..100).
 *
 * O índice pondera mensagens recentes mais que antigas (decaimento
 * exponencial): o estado emocional ATUAL do cliente importa mais que a média
 * histórica da conversa inteira — alguém que começou irritado e se calmou não
 * deveria continuar marcado como crítico.
 */
export function calcularFrustration(
  historico: HistoricoFrustracao,
  limiarCritico = LIMIAR_FRUSTRACAO_CRITICA
): FrustrationResult {
  const mensagens = historico.mensagensCliente.filter((m) => typeof m === "string" && m.trim().length > 0);

  if (mensagens.length === 0) {
    return { indice: 0, tendencia: "estavel", sinais: [], circuitBreakerAtivado: false };
  }

  const analises = mensagens.map(analisarSentimentoMensagem);

  // Média ponderada por decaimento: peso 1 na mais recente, decaindo para o passado.
  let somaPesos = 0;
  let somaPonderada = 0;
  for (let i = 0; i < analises.length; i += 1) {
    const distanciaDoFim = analises.length - 1 - i;
    const peso = DECAIMENTO_HISTORICO ** distanciaDoFim;
    somaPonderada += analises[i].score * peso;
    somaPesos += peso;
  }
  const baseIndice = somaPesos > 0 ? somaPonderada / somaPesos : 0;

  const sinaisAgregados = new Set<string>(analises[analises.length - 1].sinais);
  // Sinais de mensagens anteriores também importam para o brief, mesmo com peso menor na nota.
  for (const analise of analises) {
    analise.sinais.forEach((s) => sinaisAgregados.add(s));
  }

  const { penalidade: penalidadeLat, sinal: sinalLat } = penalidadeLatencia(
    historico.latenciaRespostaSegundos,
    historico.slaRespostaSegundos
  );
  if (sinalLat) sinaisAgregados.add(sinalLat);

  const { penalidade: penalidadeRep, sinal: sinalRep } = penalidadeRepeticao(mensagens);
  if (sinalRep) sinaisAgregados.add(sinalRep);

  const indice = Math.round(Math.min(100, Math.max(0, baseIndice + penalidadeLat + penalidadeRep)));

  // Tendência: compara a última mensagem contra a média das anteriores.
  let tendencia: FrustrationTrend = "estavel";
  if (analises.length >= 2) {
    const ultima = analises[analises.length - 1].score;
    const mediaAnteriores =
      analises.slice(0, -1).reduce((acc, a) => acc + a.score, 0) / (analises.length - 1);
    const diferenca = ultima - mediaAnteriores;
    if (diferenca > 8) tendencia = "subindo";
    else if (diferenca < -8) tendencia = "descendo";
  }

  return {
    indice,
    tendencia,
    sinais: [...sinaisAgregados],
    circuitBreakerAtivado: indice >= limiarCritico,
  };
}

// ---------------------------------------------------------------------------
// Executive Brief — scripts de contorno
// ---------------------------------------------------------------------------

const SCRIPTS_POR_CATEGORIA: Record<string, string[]> = {
  "risco de cancelamento": [
    "Entendo completamente a sua frustração, e lamento muito pela experiência até aqui.",
    "Antes de falarmos em cancelamento, me deixa entender exatamente o que não funcionou — quero resolver isso agora, com você.",
  ],
  "ameaça regulatória/jurídica": [
    "Seu caso está sendo tratado com prioridade máxima a partir deste momento.",
    "Vou registrar tudo o que você relatou e acompanhar pessoalmente até a resolução — pode me confirmar o problema principal?",
  ],
  "insatisfação forte": [
    "Peço desculpas pelo transtorno — isso não é o padrão que buscamos oferecer.",
    "Pode me contar com detalhes o que aconteceu? Quero corrigir isso da forma certa.",
  ],
  "problema não resolvido": [
    "Vejo que isso já deveria ter sido resolvido antes — vou acompanhar pessoalmente até funcionar.",
  ],
  "demora percebida": [
    "Peço desculpas pela demora — vou priorizar seu atendimento agora.",
  ],
  "repetição de pedido": [
    "Vi que você já trouxe esse ponto antes e ainda não foi resolvido — isso não deveria ter acontecido. Vamos resolver agora.",
  ],
  "pedido de reembolso": [
    "Posso te ajudar com o reembolso. Me confirma o número do pedido para eu adiantar o processo?",
  ],
  "sensação de abandono": [
    "Estou aqui agora e vou acompanhar seu caso pessoalmente até o fim.",
  ],
  "tempo de resposta acima do SLA": [
    "Peço desculpas pelo tempo de espera — isso não deveria ter acontecido. Vou priorizar sua solicitação agora.",
  ],
  "reclamação repetida sem solução": [
    "Percebo que esse problema persiste — vou tratar como prioridade e não vou fechar o caso até confirmar que está resolvido.",
  ],
};

const SCRIPT_PADRAO = [
  "Agradeço por compartilhar isso comigo — vou acompanhar pessoalmente o seu caso até a resolução.",
];

function motivoProvavel(sinais: string[]): string {
  const prioridade = [
    "ameaça regulatória/jurídica",
    "risco de cancelamento",
    "pedido de reembolso",
    "reclamação repetida sem solução",
    "sensação de abandono",
    "problema não resolvido",
    "tempo de resposta acima do SLA",
    "insatisfação forte",
    "demora percebida",
    "repetição de pedido",
  ];
  for (const categoria of prioridade) {
    if (sinais.includes(categoria)) return categoria;
  }
  return sinais[0] ?? "insatisfação geral";
}

/**
 * Gera o brief executivo determinístico — SEMPRE disponível, sem rede.
 * É o que aparece na tela do atendente no instante em que o Circuit Breaker
 * dispara, então precisa existir mesmo se todo provedor de IA estiver fora.
 */
export function gerarExecutiveBrief(resultado: FrustrationResult, agora = new Date()): ExecutiveBrief {
  const motivo = motivoProvavel(resultado.sinais);
  const scripts = SCRIPTS_POR_CATEGORIA[motivo] ?? SCRIPT_PADRAO;

  return {
    resumo: `Índice de frustração em ${resultado.indice}/100 (tendência: ${resultado.tendencia}). ${resultado.sinais.length} sinal(is) detectado(s).`,
    motivoProvavel: motivo,
    sinaisDetectados: resultado.sinais,
    scriptsSugeridos: scripts,
    geradoEm: agora.toISOString(),
    origemIA: false,
  };
}
