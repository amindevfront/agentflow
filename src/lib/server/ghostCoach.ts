// Ghost Coach / Shadow AI — sugestão silenciosa para o operador humano no
// momento do handoff (HITL). SERVER-ONLY.
//
// A IA roda "em modo silencioso": nunca responde ao cliente, nunca decide
// nada — só prepara um rascunho de resposta e um argumento de objeção para
// o operador que vai assumir a conversa, baseado no histórico episódico do
// lead (`@/lib/server/episodicMemory`) quando disponível. Mesma garantia de
// privacidade de todo o resto do sistema: o rascunho sai do processo JÁ
// MASCARADO (Shield-Layer, `@/lib/guardrails`), nunca em claro.
//
// Mesma fiação real de `@/lib/server/orchestratorAdmin` (Anthropic +
// disjuntor + retry com timeout) — nenhum mecanismo de resiliência novo,
// só mais um consumidor do mesmo padrão. Diferente daquele motor, aqui a
// chamada é best-effort por desenho: nunca lança, nunca bloqueia a criação
// do ticket — a ausência de sugestão é um estado normal, não um erro (ver
// `SugestaoGhostCoach` em `@/types`).
//
// Limitação conhecida (documentada, não escondida): a chamada ao modelo
// acontece de forma síncrona dentro de `abrirTransbordoAdmin`
// (`./hitlStore`), sob um timeout curto — o ticket só retorna depois que a
// sugestão termina (ou falha/expira). Isso NÃO é verdadeiramente
// "background" (ex.: via `waitUntil` do runtime de Functions) — uma
// evolução futura razoável, fora do escopo desta versão. Na prática, como
// o operador só abre o ticket depois de ele aparecer na fila, a sugestão
// já está pronta a tempo na grande maioria dos casos.

import Anthropic from "@anthropic-ai/sdk";
import type { SugestaoGhostCoach } from "@/types";
import type { Idioma } from "@/lib/jurisdiction";
import { PiiVault, maskText } from "@/lib/guardrails";
import { retryWithTimeout } from "@/lib/promiseUtils";
import { chaveAnthropic, diagnosticoOrquestrador, modeloOrquestrador } from "./env";
import { obterResumoUnificadoCliente } from "./episodicMemory";
import { DisjuntorChamadaExterna } from "./externalApiBreaker";

/** Sugestão é um rascunho curto — nunca um relatório. */
const MAX_TOKENS_SAIDA = 400;

/** Timeout por tentativa — mais curto que o motor de orquestração principal: isto é um bônus do handoff, não o próprio handoff. */
const TIMEOUT_CHAMADA_MS = 12_000;

/**
 * Disjuntor dedicado (nunca o mesmo de `orchestratorAdmin.ts`): uma
 * instabilidade do Ghost Coach nunca deve abrir o disjuntor que protege a
 * execução real de fluxos, e vice-versa — mesmo racional de
 * `disjuntorDoCanal`/`disjuntorDoWebhook` serem namespaces próprios.
 */
const disjuntorGhostCoach = new DisjuntorChamadaExterna("ghost-coach", {
  limiarFalhas: 3,
  resfriamentoMs: 30_000,
});

let clienteCache: Anthropic | null = null;
function clienteAnthropic(): Anthropic {
  if (clienteCache) return clienteCache;
  clienteCache = new Anthropic({ apiKey: chaveAnthropic() });
  return clienteCache;
}

/** Delimitadores do formato de resposta esperado — simples e determinístico de parsear, sem exigir JSON estruturado do modelo. */
const MARCADOR_RESPOSTA = "RESPOSTA:";
const MARCADOR_OBJECAO = "OBJEÇÃO:";

/** Nome do idioma por extenso, para a instrução do prompt — nunca abreviação ambígua para o modelo. */
const NOME_IDIOMA: Record<Idioma, string> = {
  pt: "português",
  en: "inglês",
  es: "espanhol",
};

export interface ConstruirPromptGhostCoachInput {
  payloadMascarado: string;
  saidaMascarada?: string | null;
  motivo: string;
  severidade: string;
  /** Resumo unificado cross-channel do lead (`obterResumoUnificadoCliente`) — `null`/ausente quando não há histórico. */
  contextoEpisodico?: string | null;
  /**
   * Expansão Global (EUA/Portugal): idioma em que o RASCUNHO de resposta ao
   * cliente final deve ser escrito — inferido do DDI do telefone (ver
   * `@/lib/jurisdiction`), nunca do idioma do operador. Os marcadores
   * RESPOSTA:/OBJEÇÃO: continuam literalmente em português — são só o
   * protocolo de parsing deste módulo (`interpretarRespostaGhostCoach`),
   * nunca texto exposto ao cliente. Ausente/`"pt"` preserva o comportamento
   * original, sem instrução extra no prompt.
   */
  idiomaResposta?: Idioma;
}

/**
 * Monta o prompt do Ghost Coach. Pura: mesma entrada produz sempre o mesmo
 * texto, diretamente testável sem rede.
 */
export function construirPromptGhostCoach(input: ConstruirPromptGhostCoachInput): string {
  const linhas = [
    "Você é um Ghost Coach: prepara um RASCUNHO para um atendente humano que vai assumir uma conversa",
    "escalada para revisão. Você NUNCA responde ao cliente diretamente — o atendente decide o que usar.",
    "",
    `Motivo da escalação: ${input.motivo} (severidade: ${input.severidade}).`,
    `Mensagem do cliente (já mascarada — marcadores como [[PII:TIPO:N]] substituem dados pessoais e`,
    "devem ser preservados onde aparecerem, nunca reescritos):",
    input.payloadMascarado,
  ];

  if (input.saidaMascarada) {
    linhas.push("", "Última resposta automática que gerou a escalação:", input.saidaMascarada);
  }

  if (input.contextoEpisodico) {
    linhas.push("", "Histórico cross-channel deste cliente (outros canais/conversas anteriores):", input.contextoEpisodico);
  }

  if (input.idiomaResposta && input.idiomaResposta !== "pt") {
    linhas.push(
      "",
      `Escreva o CONTEÚDO do rascunho de resposta e da objeção em ${NOME_IDIOMA[input.idiomaResposta]} — é o` +
        " idioma provável do cliente final, inferido do telefone dele. Os marcadores RESPOSTA: e OBJEÇÃO:" +
        " abaixo continuam literalmente em português — são só o formato de leitura deste sistema, nunca texto" +
        " que o cliente vê."
    );
  }

  linhas.push(
    "",
    "Produza EXATAMENTE duas linhas, nesse formato, sem introdução nem comentário adicional:",
    `${MARCADOR_RESPOSTA} <rascunho curto e educado de resposta ao cliente, pronto para o atendente editar>`,
    `${MARCADOR_OBJECAO} <a objeção mais provável do cliente neste ponto, e um argumento objetivo para endereçá-la>`
  );

  return linhas.join("\n");
}

export interface RespostaGhostCoachInterpretada {
  respostaSugerida: string;
  argumentoObjecao: string;
}

/**
 * Interpreta a resposta do modelo no formato de duas linhas pedido pelo
 * prompt. Pura e tolerante: se o modelo não seguir o formato à risca, o
 * texto inteiro vira `respostaSugerida` e `argumentoObjecao` fica vazio —
 * degradação graciosa em vez de descartar a sugestão por completo.
 */
export function interpretarRespostaGhostCoach(textoBruto: string): RespostaGhostCoachInterpretada {
  const texto = textoBruto.trim();
  const indiceResposta = texto.indexOf(MARCADOR_RESPOSTA);
  const indiceObjecao = texto.indexOf(MARCADOR_OBJECAO);

  if (indiceResposta === -1 || indiceObjecao === -1 || indiceObjecao < indiceResposta) {
    return { respostaSugerida: texto, argumentoObjecao: "" };
  }

  const respostaSugerida = texto.slice(indiceResposta + MARCADOR_RESPOSTA.length, indiceObjecao).trim();
  const argumentoObjecao = texto.slice(indiceObjecao + MARCADOR_OBJECAO.length).trim();
  return { respostaSugerida, argumentoObjecao };
}

/** Executor real — chama o Claude de verdade, sob o disjuntor dedicado + retry com timeout. */
async function chamarGhostCoachComResiliencia(prompt: string): Promise<string> {
  return disjuntorGhostCoach.executar(async () => {
    const resultado = await retryWithTimeout(
      () =>
        clienteAnthropic().messages.create({
          model: modeloOrquestrador(),
          max_tokens: MAX_TOKENS_SAIDA,
          messages: [{ role: "user", content: prompt }],
        }),
      { maxAttempts: 2, timeoutMs: TIMEOUT_CHAMADA_MS, baseDelayMs: 300 }
    );
    if (!resultado.ok) throw resultado.error;

    const bloco = resultado.value.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    return bloco?.text ?? "";
  });
}

/** Mascara a sugestão antes de devolvê-la — mesma garantia de `visionAdmin.ts`/`audioTranscriptionAdmin.ts`: nunca confiar que o modelo não repetiu PII do prompt na saída. */
function mascararSugestao(texto: string): string {
  const vaultDescartavel = new PiiVault();
  try {
    return maskText(texto, vaultDescartavel).texto;
  } finally {
    vaultDescartavel.clear();
  }
}

export interface GerarSugestaoGhostCoachInput {
  workspaceId: string;
  payloadMascarado: string;
  saidaMascarada?: string | null;
  motivo: string;
  severidade: string;
  /** Presente quando o ticket tem uma identidade de cliente correlacionável — ver `episodicMemory`. */
  clienteId?: string | null;
  /** Expansão Global: idioma do rascunho — ver `ConstruirPromptGhostCoachInput.idiomaResposta`. */
  idiomaResposta?: Idioma;
  agora?: Date;
}

/**
 * Gera a sugestão do Ghost Coach. Best-effort por desenho: `null` quando o
 * Anthropic não está configurado, o disjuntor está aberto, a chamada expira
 * ou qualquer outra falha ocorre — nunca lança. Quem chama (`abrirTransbordoAdmin`)
 * trata `null` como "sem sugestão esta vez", nunca como motivo para falhar
 * a criação do ticket.
 */
export async function gerarSugestaoGhostCoachAdmin(
  input: GerarSugestaoGhostCoachInput
): Promise<SugestaoGhostCoach | null> {
  const diagnostico = diagnosticoOrquestrador();
  if (!diagnostico.pronto) return null;

  let contextoEpisodico: string | null = null;
  if (input.clienteId) {
    try {
      contextoEpisodico = await obterResumoUnificadoCliente(input.workspaceId, input.clienteId);
    } catch (erro) {
      console.error(`[ghost-coach] falha ao ler memória episódica do cliente ${input.clienteId}:`, erro);
    }
  }

  const prompt = construirPromptGhostCoach({
    payloadMascarado: input.payloadMascarado,
    saidaMascarada: input.saidaMascarada,
    motivo: input.motivo,
    severidade: input.severidade,
    contextoEpisodico,
    idiomaResposta: input.idiomaResposta,
  });

  let bruto: string;
  try {
    bruto = await chamarGhostCoachComResiliencia(prompt);
  } catch (erro) {
    console.error(`[ghost-coach] falha ao gerar sugestão para o workspace ${input.workspaceId}:`, erro);
    return null;
  }

  if (!bruto.trim()) return null;

  const interpretada = interpretarRespostaGhostCoach(bruto);
  const agora = input.agora ?? new Date();

  return {
    respostaSugerida: mascararSugestao(interpretada.respostaSugerida),
    argumentoObjecao: mascararSugestao(interpretada.argumentoObjecao),
    baseadoEmHistoricoEpisodico: contextoEpisodico !== null,
    geradoEm: agora.toISOString(),
  };
}
