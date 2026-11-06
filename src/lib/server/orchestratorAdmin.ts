// Motor de orquestração — fiação real (Admin SDK + Anthropic).
//
// SERVER-ONLY.
//
// Conecta o núcleo puro de `orchestrator.ts` ao mundo real:
//
//   - leitura do fluxo e do workspace do usuário, e escrita do FlowRun, via
//     Firestore Admin SDK (as regras do Firestore negam a um cliente comum
//     escrever em `flowRuns` — ver `firestore.rules`; o Admin SDK é o
//     "motor de orquestração" a que aquele comentário se refere);
//   - abertura de ticket de transbordo via `hitlStore.ts` (Admin SDK também,
//     sem o SDK de cliente do Firebase — ver o cabeçalho daquele arquivo);
//   - a chamada real ao modelo, via `@anthropic-ai/sdk`.
//
// LIMITAÇÃO CONHECIDA (documentada, não escondida): o motor trata cada fluxo
// como um único nó lógico — ele não interpreta um grafo de etapas, não chama
// conectores externos e não implementa os quatro tipos de gatilho (`webhook`,
// `agendado`, `formulário`, `manual`) de forma diferenciada. O que ele faz,
// de ponta a ponta e de verdade, é: sanitizar o payload (guardrails), chamar
// um modelo real da Anthropic com o resultado, validar a saída (guardrails),
// medir tokens e custo reais, e persistir um `FlowRun` com telemetria
// verdadeira — o elo que faltava entre o motor de guardrails e o painel de
// ROI. Evoluir para um executor de grafo multi-nó é trabalho futuro
// claramente maior, fora do escopo desta correção.
//
// Graceful degradation: a ausência de `ANTHROPIC_API_KEY` ou de credenciais
// do Admin SDK nunca derruba o processo — `diagnosticoOrquestrador()` e
// `diagnosticoAdmin()` são checados antes de qualquer trabalho, e a rota
// responde 503 com uma mensagem acionável (ver `/api/flows/execute`).

import Anthropic from "@anthropic-ai/sdk";
import type { Flow, FlowRun, GuardrailPolicy, HandoffTicket, NicheKey } from "@/types";
import type { ExecutorLlm } from "@/lib/guardrails";
import { PRECOS_REFERENCIA, estimarCustoModeloUsd } from "@/lib/pricing";
import { gerarContextoNicho } from "@/lib/nichePrompts";
import { retryWithTimeout } from "@/lib/promiseUtils";
import { chaveAnthropic, modeloOrquestrador } from "./env";
import { obterResumoUnificadoCliente } from "./episodicMemory";
import { DisjuntorChamadaExterna } from "./externalApiBreaker";
import { firestoreAdmin } from "./firebaseAdmin";
import { abrirTransbordoAdmin } from "./hitlStore";
import { ErroApi } from "./http";
import {
  executarFluxo,
  montarPrompt,
  type AcumuladorUso,
  type ExecutarFluxoResultado,
  type PortasExecucao,
} from "./orchestrator";

/** Teto de tokens de saída por chamada — uma conclusão curta e estruturada. */
const MAX_TOKENS_SAIDA = 1024;

/** Timeout por tentativa individual à Anthropic. */
const TIMEOUT_CHAMADA_MS = 20_000;

/**
 * Disjuntor + retry da chamada real à Anthropic (ver `./externalApiBreaker`).
 * Abre após 3 falhas consecutivas (cada uma já esgotou 2 tentativas com
 * backoff) e passa a recusar chamadas por 30s sem tocar a rede — proteção
 * para o provedor e para a latência de quem chama durante uma indisponibilidade.
 * Falha do disjuntor (`ErroDisjuntorAberto`) e falha de rede chegam ao
 * chamador (`guardarChamadaLlm`) da mesma forma: ambas já eram tratadas como
 * falha de amostra antes desta mudança — nenhum comportamento observável novo
 * além de "falha rápido" em vez de "espera o timeout toda vez".
 */
const disjuntorAnthropic = new DisjuntorChamadaExterna("anthropic", {
  limiarFalhas: 3,
  resfriamentoMs: 30_000,
});

let clienteCache: Anthropic | null = null;

function clienteAnthropic(): Anthropic {
  if (clienteCache) return clienteCache;
  clienteCache = new Anthropic({ apiKey: chaveAnthropic() });
  return clienteCache;
}

/** Chamada real à Anthropic sob disjuntor + retry com backoff exponencial. */
async function chamarAnthropicComResiliencia(
  parametros: Anthropic.MessageCreateParamsNonStreaming
): Promise<Anthropic.Message> {
  return disjuntorAnthropic.executar(async () => {
    const resultado = await retryWithTimeout(
      () => clienteAnthropic().messages.create(parametros),
      { maxAttempts: 2, timeoutMs: TIMEOUT_CHAMADA_MS, baseDelayMs: 500 }
    );
    if (!resultado.ok) throw resultado.error;
    return resultado.value;
  });
}

/**
 * Fábrica do executor real: cada chamada ao modelo atualiza o acumulador com
 * o uso relatado pela própria API — a fonte de verdade de custo, preferida
 * sobre qualquer estimativa (ver `RunCostMetrics.custoModeloUsd` em
 * `@/types/roi` e o comentário equivalente em `@/lib/roi`).
 */
export function criarExecutorAnthropic(
  flow: Pick<Flow, "nome" | "gatilho" | "origem">,
  /** Auto-Feedback de Conversão — ver `montarPrompt` em `./orchestrator`. */
  contextoConversao?: string | null,
  /** Engine Auto-Moldável por Nicho — ver `montarPrompt` em `./orchestrator`. */
  contextoNicho?: string | null,
  /** Motor de Memória Episódica e Contexto Multi-Canal — ver `montarPrompt` em `./orchestrator`. */
  contextoMemoriaEpisodica?: string | null
): (acumulador: AcumuladorUso) => ExecutorLlm {
  const modelo = modeloOrquestrador();
  const preco = PRECOS_REFERENCIA[modelo];

  return (acumulador) => {
    acumulador.modelo = modelo;

    return async (payloadSanitizado: string): Promise<string> => {
      const resposta = await chamarAnthropicComResiliencia({
        model: modelo,
        max_tokens: MAX_TOKENS_SAIDA,
        messages: [
          {
            role: "user",
            content: montarPrompt(
              flow,
              payloadSanitizado,
              contextoConversao,
              contextoNicho,
              contextoMemoriaEpisodica
            ),
          },
        ],
      });

      acumulador.tokensEntrada += resposta.usage.input_tokens;
      acumulador.tokensSaida += resposta.usage.output_tokens;
      acumulador.chamadas += 1;
      // Sem preço de referência cadastrado para o modelo configurado, o custo
      // real fica como 0 nesta chamada — `calcularRoi` ainda soma os tokens
      // corretamente; apenas o agregado financeiro fica subestimado até que
      // `PRECOS_REFERENCIA` (ou `RoiConfig.precoModeloPadrao`) seja atualizado.
      if (preco) {
        acumulador.custoUsd += estimarCustoModeloUsd(
          resposta.usage.input_tokens,
          resposta.usage.output_tokens,
          preco
        );
      }

      const blocoDeTexto = resposta.content.find(
        (bloco): bloco is Anthropic.TextBlock => bloco.type === "text"
      );
      return blocoDeTexto?.text ?? "";
    };
  };
}

/**
 * Lê o workspaceId do usuário autenticado, a partir de `users/{uid}`.
 *
 * Extraído como função própria (em vez de ficar só dentro de `portasAdmin`)
 * para que outras rotas que precisam da MESMA verificação de posse de
 * workspace — ex.: a leitura da Memória Episódica — reaproveitem exatamente
 * esta leitura, sem duplicá-la.
 */
export async function lerWorkspaceIdDoUsuarioAdmin(uid: string): Promise<string | null> {
  const snap = await firestoreAdmin().collection("users").doc(uid).get();
  const workspaceId = snap.exists ? (snap.data() as { workspaceId?: unknown }).workspaceId : null;
  return typeof workspaceId === "string" ? workspaceId : null;
}

/** Portas concretas sobre o Firestore via Admin SDK. */
export const portasAdmin: PortasExecucao = {
  async lerFlow(flowId) {
    const snap = await firestoreAdmin().collection("flows").doc(flowId).get();
    return snap.exists ? ({ ...(snap.data() as Flow), id: snap.id }) : null;
  },

  lerWorkspaceIdDoUsuario: lerWorkspaceIdDoUsuarioAdmin,

  async escreverFlowRun(run: FlowRun) {
    await firestoreAdmin().collection("flowRuns").doc(run.id).set(run);
  },

  async abrirTransbordo(entrada): Promise<HandoffTicket> {
    return abrirTransbordoAdmin(entrada);
  },
};

/**
 * Lê um fluxo e confirma que o usuário autenticado pertence ao seu
 * workspace — mesma verificação de posse que `executarFluxo` já faz
 * internamente (ver `./orchestrator`), extraída aqui para que outras rotas
 * que precisam do fluxo ANTES de decidir se seguem (ex.: o Simulador de A/B
 * Testing, que não quer gastar chamadas reais à Anthropic num fluxo que o
 * usuário não pode nem executar) reaproveitem a mesma checagem, em vez de
 * duplicá-la.
 */
export async function lerFlowComPosseAdmin(flowId: string, uid: string): Promise<Flow> {
  const flow = await portasAdmin.lerFlow(flowId);
  if (!flow) {
    throw new ErroApi(404, "Fluxo não encontrado.", "fluxo_nao_encontrado");
  }

  const workspaceIdUsuario = await lerWorkspaceIdDoUsuarioAdmin(uid);
  if (!workspaceIdUsuario || workspaceIdUsuario !== flow.workspaceId) {
    throw new ErroApi(403, "Usuário não pertence ao workspace deste fluxo.", "workspace_incompativel");
  }

  return flow;
}

/**
 * Executa um fluxo real: fiação completa (Anthropic + Admin SDK) sobre o
 * núcleo puro `executarFluxo`. Ponto de entrada usado por
 * `/api/flows/execute`.
 */
export async function executarFluxoReal(
  flowId: string,
  payload: string,
  usuario: { uid: string },
  /**
   * Motor de Memória Episódica e Contexto Multi-Canal: identidade do cliente
   * já correlacionada entre canais por quem chama (ver nota de "No Invention"
   * no cabeçalho de `./episodicMemory`) — opcional, pois nem toda execução de
   * fluxo está atrelada a um cliente específico (ex.: automações agendadas).
   */
  clienteId?: string
): Promise<ExecutarFluxoResultado> {
  // O fluxo precisa ser lido antes de montar o executor (o prompt depende do
  // nome/gatilho/origem do fluxo) — mas `executarFluxo` também lê o fluxo
  // internamente via `portasAdmin.lerFlow`, então a leitura aqui é só para
  // parametrizar o executor. Uma segunda leitura do mesmo documento, barata e
  // consistente (ambas acontecem dentro da mesma requisição HTTP), é
  // preferível a acoplar a criação do executor ao retorno de `lerFlow`.
  const flow = await portasAdmin.lerFlow(flowId);
  if (!flow) {
    throw new ErroApi(404, "Fluxo não encontrado.", "fluxo_nao_encontrado");
  }

  // Auto-Feedback de Conversão: lê o contexto já agregado em
  // `Workspace.insightsConversaoTexto` (ver `@/lib/inbox/conversionFeedback`)
  // e injeta no prompt desta execução. Leitura best-effort — a ausência do
  // workspace ou do campo nunca impede a execução do fluxo, apenas a deixa
  // sem esse contexto adicional (degradação graciosa).
  // Mesma leitura também alimenta o Engine Auto-Moldável por Nicho
  // (`@/lib/nichePrompts`) — um único acesso a `workspaces/{id}`, dois
  // contextos extraídos dele.
  let contextoConversao: string | undefined;
  let contextoNicho: string | null | undefined;
  // Ajustes de guardrail do workspace (ver nota em `ExecutarFluxoInput.guardrailOverrides`,
  // `./orchestrator`): lidos best-effort, do mesmo documento acima — a ausência
  // ou malformação deste campo nunca impede a execução, apenas deixa o fluxo
  // sob a política "padrao" pura (sem endurecimento), o mesmo comportamento de
  // antes desta correção.
  let guardrailOverrides: Partial<GuardrailPolicy> | undefined;
  // Política base por nicho (ver `ExecutarFluxoInput.politica`): workspaces
  // dos Módulos Verticais 1 (Construtoras/Imobiliárias) e 2 (Clínicas de
  // Saúde/Estética) recebem automaticamente a política endurecida
  // correspondente, sem exigir configuração manual de `guardrailOverrides`
  // por workspace. Qualquer outro setor (ou setor ausente) mantém "padrao".
  let politicaBase: string = "padrao";
  try {
    const workspaceSnap = await firestoreAdmin().collection("workspaces").doc(flow.workspaceId).get();
    const dados = workspaceSnap.exists
      ? (workspaceSnap.data() as {
          insightsConversaoTexto?: unknown;
          setor?: unknown;
          guardrailOverrides?: unknown;
        })
      : null;
    if (typeof dados?.insightsConversaoTexto === "string") {
      contextoConversao = dados.insightsConversaoTexto;
    }
    const setor = typeof dados?.setor === "string" ? (dados.setor as NicheKey) : undefined;
    contextoNicho = gerarContextoNicho(setor);
    if (setor === "construtora-imobiliaria") {
      politicaBase = "imobiliario-alto-padrao";
    } else if (setor === "clinica-alto-padrao") {
      politicaBase = "clinica-alto-padrao";
    }
    if (
      dados?.guardrailOverrides &&
      typeof dados.guardrailOverrides === "object" &&
      !Array.isArray(dados.guardrailOverrides)
    ) {
      guardrailOverrides = dados.guardrailOverrides as Partial<GuardrailPolicy>;
    }
  } catch (erro) {
    console.error(`[orchestrator] falha ao ler contexto do workspace ${flow.workspaceId}:`, erro);
  }

  // Motor de Memória Episódica: leitura O(1) (ver `obterResumoUnificadoCliente`
  // em `./episodicMemory`) — best-effort, mesma degradação graciosa dos dois
  // contextos acima. Sem `clienteId`, nenhuma leitura é feita.
  let contextoMemoriaEpisodica: string | null = null;
  if (clienteId) {
    try {
      contextoMemoriaEpisodica = await obterResumoUnificadoCliente(flow.workspaceId, clienteId);
    } catch (erro) {
      console.error(`[orchestrator] falha ao ler memória episódica do cliente ${clienteId}:`, erro);
    }
  }

  const contextosFundamentacao = [contextoConversao, contextoNicho, contextoMemoriaEpisodica].filter(
    (contexto): contexto is string => typeof contexto === "string" && contexto.length > 0
  );

  return executarFluxo({
    flowId,
    payload,
    usuario,
    criarExecutor: criarExecutorAnthropic(flow, contextoConversao, contextoNicho, contextoMemoriaEpisodica),
    portas: portasAdmin,
    politica: politicaBase,
    guardrailOverrides,
    contextosFundamentacao,
  });
}
