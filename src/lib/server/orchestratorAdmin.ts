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
import type { Flow, FlowRun, HandoffTicket } from "@/types";
import type { ExecutorLlm } from "@/lib/guardrails";
import { PRECOS_REFERENCIA, estimarCustoModeloUsd } from "@/lib/pricing";
import { chaveAnthropic, modeloOrquestrador } from "./env";
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

let clienteCache: Anthropic | null = null;

function clienteAnthropic(): Anthropic {
  if (clienteCache) return clienteCache;
  clienteCache = new Anthropic({ apiKey: chaveAnthropic() });
  return clienteCache;
}

/**
 * Fábrica do executor real: cada chamada ao modelo atualiza o acumulador com
 * o uso relatado pela própria API — a fonte de verdade de custo, preferida
 * sobre qualquer estimativa (ver `RunCostMetrics.custoModeloUsd` em
 * `@/types/roi` e o comentário equivalente em `@/lib/roi`).
 */
export function criarExecutorAnthropic(flow: Pick<Flow, "nome" | "gatilho" | "origem">): (
  acumulador: AcumuladorUso
) => ExecutorLlm {
  const modelo = modeloOrquestrador();
  const preco = PRECOS_REFERENCIA[modelo];

  return (acumulador) => {
    acumulador.modelo = modelo;

    return async (payloadSanitizado: string): Promise<string> => {
      const resposta = await clienteAnthropic().messages.create({
        model: modelo,
        max_tokens: MAX_TOKENS_SAIDA,
        messages: [{ role: "user", content: montarPrompt(flow, payloadSanitizado) }],
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

/** Portas concretas sobre o Firestore via Admin SDK. */
export const portasAdmin: PortasExecucao = {
  async lerFlow(flowId) {
    const snap = await firestoreAdmin().collection("flows").doc(flowId).get();
    return snap.exists ? ({ ...(snap.data() as Flow), id: snap.id }) : null;
  },

  async lerWorkspaceIdDoUsuario(uid) {
    const snap = await firestoreAdmin().collection("users").doc(uid).get();
    const workspaceId = snap.exists ? (snap.data() as { workspaceId?: unknown }).workspaceId : null;
    return typeof workspaceId === "string" ? workspaceId : null;
  },

  async escreverFlowRun(run: FlowRun) {
    await firestoreAdmin().collection("flowRuns").doc(run.id).set(run);
  },

  async abrirTransbordo(entrada): Promise<HandoffTicket> {
    return abrirTransbordoAdmin(entrada);
  },
};

/**
 * Executa um fluxo real: fiação completa (Anthropic + Admin SDK) sobre o
 * núcleo puro `executarFluxo`. Ponto de entrada usado por
 * `/api/flows/execute`.
 */
export async function executarFluxoReal(
  flowId: string,
  payload: string,
  usuario: { uid: string }
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

  return executarFluxo({
    flowId,
    payload,
    usuario,
    criarExecutor: criarExecutorAnthropic(flow),
    portas: portasAdmin,
  });
}
