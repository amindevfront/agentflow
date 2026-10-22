// Neural Swarm Inbox — Roteamento Cognitivo (Swarm Routing).
//
// Determinístico e explicável por desenho: cada decisão de roteamento carrega
// a trilha completa de motivos (`RoutingCandidate.motivos`) e os candidatos
// descartados (`RoutingDecision.candidatos`), não só o escolhido. Em um
// contact center enterprise, "por que este caso foi para esta pessoa?" é uma
// pergunta que um supervisor faz todos os dias — uma caixa preta não serve.
//
// Dois tipos de destinatário competem pelo mesmo caso, com a mesma régua:
//   - `OperatorProfile` — um humano, com especialidade, carga e histórico;
//   - `AgentProfile`    — um sub-agente automatizado, igualmente especializado,
//                         mas deliberadamente penalizado em casos complexos
//                         (ver `PENALIDADE_COMPLEXIDADE_AGENTE`) — autonomia é
//                         para o caso simples e bem definido, não para tudo.

import type {
  AgentProfile,
  EspecialidadeAtendimento,
  IntentAnalysis,
  OperatorProfile,
  RoutingCandidate,
  RoutingDecision,
} from "@/types";
import { tokenizar } from "@/lib/guardrails";

// ---------------------------------------------------------------------------
// Análise de intenção
// ---------------------------------------------------------------------------

const LEXICO_INTENCAO: Record<EspecialidadeAtendimento, RegExp[]> = {
  financeiro: [
    /\b(fatura|cobran[çc]a|pagamento|boleto|cart[ãa]o|reembolso|estorno|parcelamento|d[ée]bito)\b/i,
    /\bvalor\s+(cobrado|errado|da\s+fatura)\b/i,
  ],
  tecnico: [
    /\b(erro|bug|travou|travando|n[ãa]o\s+funciona|falha|instalar|configurar|atualiza[çc][ãa]o|login|conex[ãa]o|aplicativo|app|sistema\s+fora)\b/i,
  ],
  comercial: [
    /\b(comprar|or[çc]amento|proposta|desconto|promo[çc][ãa]o|upgrade|contratar|demonstra[çc][ãa]o|plano\s+novo)\b/i,
  ],
  juridico: [
    /\b(contrato|termos\s+de\s+uso|lgpd|dados\s+pessoais|processo|advogad[oa]|procon|justi[çc]a)\b/i,
  ],
  retencao: [
    /\b(cancelar|cancelamento|insatisfeit[oa]|trocar\s+de\s+fornecedor|concorrente|desistir)\b/i,
  ],
  geral: [],
};

/** Ordem de prioridade quando mais de uma categoria casa — a mais específica vence. */
const ORDEM_PRIORIDADE: EspecialidadeAtendimento[] = [
  "juridico",
  "retencao",
  "financeiro",
  "tecnico",
  "comercial",
  "geral",
];

/**
 * Classifica a intenção do cliente por análise semântica determinística
 * (léxico categorizado). Cada categoria carrega os trechos que a sustentam —
 * a explicabilidade do roteamento começa aqui.
 */
export function analisarIntencao(texto: string): IntentAnalysis {
  if (!texto || texto.trim().length === 0) {
    return { categoria: "geral", confianca: 0, sinais: [] };
  }

  const acertosPorCategoria = new Map<EspecialidadeAtendimento, string[]>();

  for (const categoria of ORDEM_PRIORIDADE) {
    if (categoria === "geral") continue;
    const padroes = LEXICO_INTENCAO[categoria];
    const sinais: string[] = [];
    for (const padrao of padroes) {
      const encontrado = texto.match(padrao);
      if (encontrado) sinais.push(encontrado[0].toLowerCase());
    }
    if (sinais.length > 0) acertosPorCategoria.set(categoria, sinais);
  }

  if (acertosPorCategoria.size === 0) {
    return { categoria: "geral", confianca: 0.3, sinais: [] };
  }

  // A categoria mais específica (na ordem de prioridade) com mais acertos vence.
  let melhorCategoria: EspecialidadeAtendimento = "geral";
  let melhorContagem = 0;
  for (const categoria of ORDEM_PRIORIDADE) {
    const sinais = acertosPorCategoria.get(categoria);
    if (sinais && sinais.length > melhorContagem) {
      melhorCategoria = categoria;
      melhorContagem = sinais.length;
    }
  }

  const sinais = acertosPorCategoria.get(melhorCategoria) ?? [];
  // Confiança sobe com o número de sinais, mas satura — dois sinais já é uma
  // classificação forte; dez sinais não é cinco vezes mais confiável que dois.
  const confianca = Math.min(0.95, 0.5 + sinais.length * 0.15);

  return { categoria: melhorCategoria, confianca: Number(confianca.toFixed(2)), sinais: [...new Set(sinais)] };
}

// ---------------------------------------------------------------------------
// Complexidade
// ---------------------------------------------------------------------------

const PALAVRAS_TECNICAS_COMPLEXAS =
  /\b(integra[çc][ãa]o|api|webhook|migra[çc][ãa]o|exporta[çc][ãa]o|lgpd|contrato|rescis[ãa]o|auditoria|compliance|multa|judicial)\b/i;

/**
 * Estima a complexidade do caso (0..1), a partir de sinais objetivos do texto
 * e do histórico da conversa — nunca de uma "sensação" do modelo.
 */
export function calcularComplexidade(texto: string, totalMensagensAnteriores = 0): number {
  if (!texto || texto.trim().length === 0) return 0;

  let pontos = 0;

  // 1. Comprimento: mensagens muito longas tendem a carregar mais contexto/nuance.
  const tokens = tokenizar(texto, false);
  pontos += Math.min(0.25, tokens.length / 120);

  // 2. Múltiplas perguntas na mesma mensagem — vários problemas de uma vez.
  const perguntas = (texto.match(/\?/g) ?? []).length;
  pontos += Math.min(0.2, perguntas * 0.08);

  // 3. Vocabulário técnico/jurídico/de alto risco.
  const ocorrenciasComplexas = texto.match(new RegExp(PALAVRAS_TECNICAS_COMPLEXAS, "gi")) ?? [];
  pontos += Math.min(0.3, ocorrenciasComplexas.length * 0.15);

  // 4. Conversa que já se arrasta — se ainda não foi resolvida em várias
  // trocas, provavelmente não é um caso trivial.
  pontos += Math.min(0.25, Math.max(0, totalMensagensAnteriores - 2) * 0.05);

  return Number(Math.min(1, pontos).toFixed(3));
}

// ---------------------------------------------------------------------------
// Pontuação de candidatos
// ---------------------------------------------------------------------------

/** Acima deste ponto, um sub-agente automático deixa de ser um candidato seguro. */
const COMPLEXIDADE_MAXIMA_PARA_AGENTE = 0.7;

function normalizarTempo(minutos: number, tetoMinutos = 60): number {
  return Math.max(0, 1 - Math.min(minutos, tetoMinutos) / tetoMinutos);
}

/**
 * Pontua um operador humano para um caso (0..1) — explicável: cada fator
 * contribui com um motivo em português, não só um número.
 */
export function pontuarOperador(
  operador: OperatorProfile,
  intencao: IntentAnalysis,
  complexidade: number
): RoutingCandidate {
  const motivos: string[] = [];

  if (!operador.disponivel || operador.cargaAtual >= operador.capacidadeMaxima) {
    return { tipo: "humano", id: operador.uid, nome: operador.nome, score: 0, motivos: ["indisponível ou na capacidade máxima"] };
  }

  const temEspecialidade = operador.especialidades.includes(intencao.categoria);
  const especialidadeScore = temEspecialidade ? intencao.confianca : 0.15;
  if (temEspecialidade) {
    motivos.push(`especialista em ${intencao.categoria} (confiança da intenção: ${intencao.confianca})`);
  } else {
    motivos.push(`sem especialidade declarada em ${intencao.categoria} — pontuação de base`);
  }

  const cargaLivre = 1 - operador.cargaAtual / operador.capacidadeMaxima;
  motivos.push(`carga atual ${operador.cargaAtual}/${operador.capacidadeMaxima} (${Math.round(cargaLivre * 100)}% livre)`);

  motivos.push(`taxa histórica de resolução ${Math.round(operador.taxaResolucao * 100)}%`);
  motivos.push(`tempo médio de resolução ${operador.tempoMedioResolucaoMin} min`);

  // Em casos complexos, histórico de resolução e velocidade pesam mais —
  // é exatamente onde a experiência do operador faz diferença.
  const pesoHistorico = 0.2 + complexidade * 0.15;
  const pesoTempo = 0.15 + complexidade * 0.1;

  const score =
    especialidadeScore * 0.4 +
    cargaLivre * 0.25 +
    operador.taxaResolucao * pesoHistorico +
    normalizarTempo(operador.tempoMedioResolucaoMin) * pesoTempo;

  return { tipo: "humano", id: operador.uid, nome: operador.nome, score: Number(Math.min(1, score).toFixed(4)), motivos };
}

/**
 * Pontua um sub-agente automatizado. Penaliza complexidade crescente de forma
 * acentuada: um agente é a escolha certa para o caso simples e repetitivo, não
 * para o caso ambíguo — delegar complexidade a um agente autônomo é
 * exatamente o tipo de "automação irresponsável" que esta função existe para
 * evitar.
 */
export function pontuarAgente(
  agente: AgentProfile,
  intencao: IntentAnalysis,
  complexidade: number
): RoutingCandidate {
  const motivos: string[] = [];

  if (!agente.disponivel || agente.cargaAtual >= agente.capacidadeMaxConcorrente) {
    return { tipo: "agente", id: agente.id, nome: agente.nome, score: 0, motivos: ["indisponível ou na capacidade máxima"] };
  }

  if (complexidade > COMPLEXIDADE_MAXIMA_PARA_AGENTE) {
    motivos.push(
      `complexidade ${complexidade.toFixed(2)} acima do limite seguro para automação (${COMPLEXIDADE_MAXIMA_PARA_AGENTE})`
    );
    return { tipo: "agente", id: agente.id, nome: agente.nome, score: 0, motivos };
  }

  const temEspecialidade = agente.especialidades.includes(intencao.categoria);
  const especialidadeScore = temEspecialidade ? intencao.confianca : 0.1;
  motivos.push(
    temEspecialidade
      ? `especializado em ${intencao.categoria} (confiança da intenção: ${intencao.confianca})`
      : `sem especialidade declarada em ${intencao.categoria} — pontuação de base`
  );

  const cargaLivre = 1 - agente.cargaAtual / agente.capacidadeMaxConcorrente;
  motivos.push(`carga atual ${agente.cargaAtual}/${agente.capacidadeMaxConcorrente}`);
  motivos.push(`taxa histórica de resolução automática ${Math.round(agente.taxaResolucaoAutomatica * 100)}%`);

  // Penalidade suave e contínua de complexidade, some de verdade perto do teto.
  const fatorComplexidade = 1 - complexidade / COMPLEXIDADE_MAXIMA_PARA_AGENTE;
  motivos.push(`fator de simplicidade aplicado: ${fatorComplexidade.toFixed(2)}`);

  const score = (especialidadeScore * 0.45 + cargaLivre * 0.2 + agente.taxaResolucaoAutomatica * 0.35) * fatorComplexidade;

  return { tipo: "agente", id: agente.id, nome: agente.nome, score: Number(Math.min(1, Math.max(0, score)).toFixed(4)), motivos };
}

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

export interface RotearInput {
  texto: string;
  totalMensagensAnteriores?: number;
  operadores: OperatorProfile[];
  agentes: AgentProfile[];
  agora?: Date;
}

/**
 * Decide quem recebe o caso — humano ou agente — entre todos os candidatos
 * disponíveis, com a trilha completa de motivos preservada para auditoria.
 *
 * Nunca lança: fila de candidatos vazia resulta em `escolhido: null`, não em
 * exceção — um contact center sem operadores livres precisa continuar de pé,
 * só precisa mostrar "sem atribuição" na UI, não derrubar o roteador.
 */
export function rotear(input: RotearInput): RoutingDecision {
  const intencao = analisarIntencao(input.texto);
  const complexidade = calcularComplexidade(input.texto, input.totalMensagensAnteriores ?? 0);

  const candidatosHumanos = input.operadores.map((op) => pontuarOperador(op, intencao, complexidade));
  const candidatosAgentes = input.agentes.map((ag) => pontuarAgente(ag, intencao, complexidade));

  const candidatos = [...candidatosHumanos, ...candidatosAgentes]
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    intencao,
    complexidade,
    candidatos,
    escolhido: candidatos[0] ?? null,
    decididoEm: (input.agora ?? new Date()).toISOString(),
  };
}
