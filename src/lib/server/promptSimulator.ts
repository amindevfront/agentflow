// Simulador de A/B Testing de Prompts e Comportamento.
//
// SERVER-ONLY.
//
// Problema real que resolve: hoje uma mudança de prompt (novo texto de
// `contextoNicho` em `@/lib/nichePrompts`, novo `contextoConversao`) só é
// validada depois de ir para produção — não existe nenhuma forma de medir,
// ANTES do deploy, se uma variante de prompt tende a convergir mais ou menos
// para conversão do que a atual.
//
// Este módulo roda um "replay": reaplica cada variante de prompt contra o
// histórico REAL de conversas do workspace — mensagens já mascaradas pelo
// Shield-Layer antes de chegar ao Firestore (ver `ConversationMessage.texto`
// em `@/types`) e já com o desfecho comercial real conhecido
// (`Conversation.desfechoConversao`) — e mede quantas respostas simuladas de
// cada variante convergem para uma ação de conversão.
//
// Zero duplicação deliberada: a montagem do prompt e a chamada real ao
// modelo reaproveitam `montarPrompt`/`criarExecutorAnthropic`
// (`./orchestrator` / `./orchestratorAdmin`) — a simulação passa pelo MESMO
// caminho de código que a produção, nunca um atalho que poderia divergir do
// comportamento real.
//
// Honestidade do número (mesma regra de `@/lib/inbox/conversionFeedback` e
// `@/lib/roi`): nenhum "vencedor" é apontado sem amostra mínima nem em caso
// de empate — `compararVariantes` devolve `null` em vez de fabricar um
// veredito que os números não sustentam. Pelo mesmo motivo, este módulo não
// embute um "juiz de IA" para decidir se uma resposta "converte" — o
// classificador é sempre explícito, fornecido por quem chama (ver nota em
// `criarClassificadorPorPalavrasChave`), nunca uma heurística escondida.

import type { ExecutorLlm } from "@/lib/guardrails";
import type { Canal, Conversation, ConversationMessage, ConversionOutcome, Flow } from "@/types";
import { novoAcumuladorUso } from "./orchestrator";
import { criarExecutorAnthropic } from "./orchestratorAdmin";
import { firestoreAdmin } from "./firebaseAdmin";

// ---------------------------------------------------------------------------
// Núcleo puro — testável sem Firestore nem Anthropic (executor injetado)
// ---------------------------------------------------------------------------

/** Amostra mínima de episódios antes de declarar uma variante vencedora — mesmo princípio de `MINIMO_AMOSTRAS_PARA_RECOMENDACAO` em `@/lib/inbox/conversionFeedback`. */
const MINIMO_EPISODIOS_PARA_VEREDITO = 5;

export interface EpisodioReplay {
  conversationId: string;
  canal: Canal;
  /** Última mensagem do cliente nesta conversa — já mascarada pelo Shield-Layer antes de persistir (ver `ConversationMessage.texto`). Nunca um texto sintético gerado por este módulo. */
  payloadMascarado: string;
  /** Desfecho comercial real já registrado para esta conversa (`Conversation.desfechoConversao`), se houver. */
  desfechoReal: ConversionOutcome | null;
}

export interface VarianteDePrompt {
  id: string;
  rotulo: string;
  /** Engine Auto-Moldável por Nicho (`@/lib/nichePrompts`) — a variação testada mais comum. */
  contextoNicho?: string | null;
  /** Auto-Feedback de Conversão (`@/lib/inbox/conversionFeedback`) — variação alternativa, menos comum. */
  contextoConversao?: string | null;
}

export interface ResultadoEpisodioSimulado {
  conversationId: string;
  varianteId: string;
  respostaSimulada: string;
  convergiuParaConversao: boolean;
  desfechoReal: ConversionOutcome | null;
}

export interface ResultadoVariante {
  varianteId: string;
  rotulo: string;
  totalEpisodios: number;
  totalConvergiuParaConversao: number;
  /** Fração de episódios em que a resposta simulada indicou intenção de conversão (0..1). */
  taxaConversaoSimulada: number;
  /**
   * Dentre os episódios cujo desfecho real já era "fechado-venda", a fração
   * em que a resposta simulada também indicou conversão — mede concordância
   * com o padrão histórico de sucesso, não apenas "a variante foi otimista".
   * `null` sem nenhum episódio de desfecho fechado na amostra (nada a
   * comparar, não zero por definição).
   */
  concordanciaComDesfechoReal: number | null;
}

export interface VereditoComparacao {
  varianteGanhadora: ResultadoVariante;
  margemPontosPercentuais: number;
}

export interface ResultadoSimulacaoAB {
  porVariante: ResultadoVariante[];
  porEpisodio: ResultadoEpisodioSimulado[];
  veredito: VereditoComparacao | null;
}

/**
 * Agrega os resultados por episódio de UMA variante em `ResultadoVariante`.
 *
 * Função pura — mesma garantia de `calcularInsightsConversao`
 * (`@/lib/inbox/conversionFeedback`): dado o mesmo input, o resultado é
 * sempre idêntico e auditável.
 */
export function agregarResultadoVariante(
  variante: Pick<VarianteDePrompt, "id" | "rotulo">,
  porEpisodio: ResultadoEpisodioSimulado[]
): ResultadoVariante {
  const totalEpisodios = porEpisodio.length;
  const totalConvergiuParaConversao = porEpisodio.filter((r) => r.convergiuParaConversao).length;

  const comDesfechoFechado = porEpisodio.filter((r) => r.desfechoReal === "fechado-venda");
  const concordanciaComDesfechoReal =
    comDesfechoFechado.length > 0
      ? comDesfechoFechado.filter((r) => r.convergiuParaConversao).length / comDesfechoFechado.length
      : null;

  return {
    varianteId: variante.id,
    rotulo: variante.rotulo,
    totalEpisodios,
    totalConvergiuParaConversao,
    taxaConversaoSimulada: totalEpisodios > 0 ? totalConvergiuParaConversao / totalEpisodios : 0,
    concordanciaComDesfechoReal,
  };
}

/**
 * Compara os resultados agregados de duas ou mais variantes e aponta a
 * vencedora — só quando a amostra é suficiente em TODAS as variantes E a
 * diferença é inequívoca (a melhor é estritamente maior que a segunda
 * melhor). Amostra insuficiente ou empate devolvem `null`: nunca um
 * "vencedor" fabricado para desempatar uma decisão que os números não
 * sustentam.
 */
export function compararVariantes(resultados: ResultadoVariante[]): VereditoComparacao | null {
  if (resultados.length < 2) return null;

  const amostraSuficiente = resultados.every((r) => r.totalEpisodios >= MINIMO_EPISODIOS_PARA_VEREDITO);
  if (!amostraSuficiente) return null;

  const ordenado = [...resultados].sort((a, b) => b.taxaConversaoSimulada - a.taxaConversaoSimulada);
  const [primeiro, segundo] = ordenado;

  if (primeiro.taxaConversaoSimulada === segundo.taxaConversaoSimulada) return null;

  return {
    varianteGanhadora: primeiro,
    margemPontosPercentuais:
      Math.round((primeiro.taxaConversaoSimulada - segundo.taxaConversaoSimulada) * 1000) / 10,
  };
}

/**
 * Classificador determinístico por palavras-chave: `true` quando a resposta
 * simulada contém, sem diferenciar maiúsculas/minúsculas, pelo menos uma das
 * palavras-chave de conversão informadas pelo chamador (ex.: a
 * `acaoPrincipal` do perfil de nicho em `@/lib/nichePrompts`). Deliberadamente
 * simples e sem NLP: o objetivo é dar um classificador honesto e auditável
 * para quem não quiser escrever o próprio — nunca um "juiz de IA" que inventa
 * veredito sem explicabilidade.
 */
export function criarClassificadorPorPalavrasChave(
  palavrasChave: string[]
): (respostaSimulada: string) => boolean {
  const normalizadas = palavrasChave.map((p) => p.toLowerCase().trim()).filter(Boolean);
  return (respostaSimulada: string) => {
    const texto = respostaSimulada.toLowerCase();
    return normalizadas.some((palavra) => texto.includes(palavra));
  };
}

/**
 * Roda UMA variante contra o dataset de replay, chamando o executor
 * (injetado — produção usa `criarExecutorAnthropicPorVariante`, teste injeta
 * um executor determinístico) uma vez por episódio.
 */
export async function simularVariante(
  episodios: EpisodioReplay[],
  variante: VarianteDePrompt,
  executor: ExecutorLlm,
  classificar: (respostaSimulada: string, episodio: EpisodioReplay) => boolean
): Promise<{ resultado: ResultadoVariante; porEpisodio: ResultadoEpisodioSimulado[] }> {
  const porEpisodio: ResultadoEpisodioSimulado[] = [];

  for (const episodio of episodios) {
    const respostaSimulada = await executor(episodio.payloadMascarado, 1);
    porEpisodio.push({
      conversationId: episodio.conversationId,
      varianteId: variante.id,
      respostaSimulada,
      convergiuParaConversao: classificar(respostaSimulada, episodio),
      desfechoReal: episodio.desfechoReal,
    });
  }

  return { resultado: agregarResultadoVariante(variante, porEpisodio), porEpisodio };
}

/**
 * Roda o teste A/B completo: todas as variantes contra o mesmo dataset de
 * replay, e compara os resultados ao final.
 *
 * `criarExecutor` é injetado (não hardcoded) para que o núcleo permaneça
 * 100% testável sem Anthropic — produção passa `criarExecutorAnthropicPorVariante`.
 */
export async function executarSimulacaoAB(
  episodios: EpisodioReplay[],
  variantes: VarianteDePrompt[],
  criarExecutor: (variante: VarianteDePrompt) => ExecutorLlm,
  classificar: (respostaSimulada: string, episodio: EpisodioReplay) => boolean
): Promise<ResultadoSimulacaoAB> {
  const porVariante: ResultadoVariante[] = [];
  const porEpisodio: ResultadoEpisodioSimulado[] = [];

  for (const variante of variantes) {
    const saida = await simularVariante(episodios, variante, criarExecutor(variante), classificar);
    porVariante.push(saida.resultado);
    porEpisodio.push(...saida.porEpisodio);
  }

  return { porVariante, porEpisodio, veredito: compararVariantes(porVariante) };
}

// ---------------------------------------------------------------------------
// Fiação real (Admin SDK + Anthropic)
// ---------------------------------------------------------------------------

const COLECAO_CONVERSAS = "conversations";
const SUBCOLECAO_MENSAGENS = "mensagens";

/** Desfechos elegíveis para o dataset de replay — mesmas três categorias de `ConversionOutcome` (`@/types`), nunca uma quarta inventada. */
const DESFECHOS_COM_RESULTADO_CONHECIDO: ConversionOutcome[] = [
  "fechado-venda",
  "perdido-preco",
  "perdido-sem-agenda",
];

/** Teto de conversas replayed numa única rodada — uma bateria de simulação não precisa (nem deveria) varrer todo o histórico do workspace a cada execução; uma amostra recente já é suficiente para o veredito estatístico. */
const MAX_CONVERSAS_REPLAY = 50;

/**
 * Monta o dataset de replay a partir de conversas reais já concluídas (com
 * desfecho comercial registrado) — nunca uma conversa sintética. Cada
 * episódio carrega só a ÚLTIMA mensagem do cliente, a mesma peça que o motor
 * de orquestração real recebe como payload (ver `criarExecutorAnthropic` em
 * `./orchestratorAdmin`). O texto já chega mascarado: nenhuma máscara nova é
 * aplicada aqui, o Shield-Layer já rodou antes da persistência original.
 */
export async function montarDatasetReplayAdmin(workspaceId: string): Promise<EpisodioReplay[]> {
  const db = firestoreAdmin();
  const conversasSnap = await db
    .collection(COLECAO_CONVERSAS)
    .where("workspaceId", "==", workspaceId)
    .where("desfechoConversao", "in", DESFECHOS_COM_RESULTADO_CONHECIDO)
    .orderBy("ultimaMensagemEm", "desc")
    .limit(MAX_CONVERSAS_REPLAY)
    .get();

  const episodios: EpisodioReplay[] = [];
  for (const doc of conversasSnap.docs) {
    const conversa = doc.data() as Conversation;
    // Resiliente de propósito (mesma consulta composta de `registrarMensagemCliente`
    // em `@/lib/inbox/firestore.ts`, mesmo risco de índice ausente): uma conversa
    // sem esse índice não pode derrubar o dataset de replay inteiro — só perde
    // o episódio dela, igual a uma conversa sem mensagem de cliente.
    let ultimaMensagem: ConversationMessage | undefined;
    try {
      const mensagensSnap = await doc.ref
        .collection(SUBCOLECAO_MENSAGENS)
        .where("remetente", "==", "cliente")
        .orderBy("enviadaEm", "desc")
        .limit(1)
        .get();
      ultimaMensagem = mensagensSnap.docs[0]?.data() as ConversationMessage | undefined;
    } catch (erro) {
      console.error("[prompt-simulator] falha ao buscar última mensagem do cliente para replay:", erro);
    }
    if (!ultimaMensagem) continue;

    episodios.push({
      conversationId: doc.id,
      canal: conversa.canal,
      payloadMascarado: ultimaMensagem.texto,
      desfechoReal: conversa.desfechoConversao ?? null,
    });
  }
  return episodios;
}

/**
 * Fábrica do executor real por variante — reaproveita `criarExecutorAnthropic`
 * (`./orchestratorAdmin`), o MESMO caminho de produção, variando apenas o
 * contexto injetado no prompt. Garante que a simulação nunca divirja do
 * comportamento real por usar um atalho próprio de chamada ao modelo.
 */
export function criarExecutorAnthropicPorVariante(
  flow: Pick<Flow, "nome" | "gatilho" | "origem">
): (variante: VarianteDePrompt) => ExecutorLlm {
  return (variante) =>
    criarExecutorAnthropic(flow, variante.contextoConversao, variante.contextoNicho)(novoAcumuladorUso());
}

/**
 * Ponto de entrada real: busca o dataset mascarado do workspace e roda o
 * teste A/B completo contra ele, usando o modelo real da Anthropic.
 */
export async function executarSimulacaoABAdmin(
  workspaceId: string,
  flow: Pick<Flow, "nome" | "gatilho" | "origem">,
  variantes: VarianteDePrompt[],
  classificar: (respostaSimulada: string, episodio: EpisodioReplay) => boolean
): Promise<ResultadoSimulacaoAB> {
  const episodios = await montarDatasetReplayAdmin(workspaceId);
  return executarSimulacaoAB(episodios, variantes, criarExecutorAnthropicPorVariante(flow), classificar);
}
