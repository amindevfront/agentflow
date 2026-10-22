// Motor de orquestração — núcleo puro e testável.
//
// SERVER-ONLY (mas sem dependência de Firestore nem do SDK da Anthropic:
// ambos entram por injeção, nunca por import direto). Esta é a peça que faltava
// entre dois sistemas já existentes:
//
//   @/lib/guardrails           (guardarChamadaLlm)   → protege a chamada ao LLM
//   @/types + @/lib/roi        (FlowRun.metrica)      → alimenta o painel de ROI
//
// Antes deste módulo, nada chamava `guardarChamadaLlm` fora de teste, e nenhum
// `FlowRun` real carregava `metrica` — o painel de ROI (`BusinessROIWidget`)
// estava corretamente plugado em `onSnapshot`, mas não existia produtor de
// dados reais do outro lado. Este arquivo é esse produtor.
//
// Toda dependência externa (ler o fluxo, confirmar o workspace do usuário,
// chamar o provedor de LLM, abrir um ticket de transbordo, persistir o
// FlowRun) entra como parâmetro — ver `PortasExecucao` e `criarExecutor`.
// Isso é o que permite testar a integração completa (guardrails → contagem de
// tokens → custo → formato de FlowRun → `calcularRoi`) sem Firestore, sem
// Admin SDK e sem rede: `tests/orchestrator.test.ts` injeta portas e um
// executor falsos e verifica o resultado byte a byte. A fiação real (Admin
// SDK + Anthropic) vive em `orchestratorAdmin.ts`, que importa este módulo.

import type { Flow, FlowRun, FlowRunStep, HandoffTicket, RunCostMetrics } from "@/types";
import type { ExecutorLlm, SolicitacaoTransbordo } from "@/lib/guardrails";
import { guardarChamadaLlm, novoTraceId } from "@/lib/guardrails";
import { ErroApi } from "./http";

/** Acumula o uso real de tokens e custo através de todas as chamadas ao
 * provedor feitas por uma única execução — inclusive as amostras extras de
 * nós críticos (`amostrasConsistencia > 1`), que o contrato de retorno de
 * `guardarChamadaLlm` não expõe por não ser sobre isso. */
export interface AcumuladorUso {
  tokensEntrada: number;
  tokensSaida: number;
  /** Custo real relatado pelo provedor, em USD. Ausente quando indisponível. */
  custoUsd: number;
  chamadas: number;
  modelo?: string;
}

export function novoAcumuladorUso(): AcumuladorUso {
  return { tokensEntrada: 0, tokensSaida: 0, custoUsd: 0, chamadas: 0 };
}

export interface PortasExecucao {
  /** Lê o fluxo pelo id. `null` se não existir. */
  lerFlow(flowId: string): Promise<Flow | null>;
  /** Lê o workspaceId do usuário autenticado, a partir de `users/{uid}`. */
  lerWorkspaceIdDoUsuario(uid: string): Promise<string | null>;
  /** Persiste o FlowRun. Único ponto de escrita desta execução. */
  escreverFlowRun(run: FlowRun): Promise<void>;
  /** Abre um ticket de transbordo e devolve o documento persistido. */
  abrirTransbordo(entrada: {
    solicitacao: SolicitacaoTransbordo;
    flowId: string;
    flowNome: string;
    runId: string;
    workspaceId: string;
    criadoPor: string;
  }): Promise<HandoffTicket>;
}

export interface ExecutarFluxoInput {
  flowId: string;
  payload: string;
  usuario: { uid: string };
  /** Fábrica do executor real: recebe o acumulador e devolve a função que
   * `guardarChamadaLlm` efetivamente chama. Produção injeta o executor da
   * Anthropic (`orchestratorAdmin.ts`); teste injeta um executor determinístico. */
  criarExecutor: (acumulador: AcumuladorUso) => ExecutorLlm;
  portas: PortasExecucao;
  agora?: Date;
  gerarRunId?: () => string;
}

export interface ExecutarFluxoResultado {
  run: FlowRun;
  bloqueado: boolean;
  transbordo: boolean;
  ticketsAbertos: HandoffTicket[];
}

function novoRunId(): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `run_${aleatorio}`;
}

/**
 * Monta o prompt enviado ao modelo a partir do contexto do fluxo.
 *
 * O payload recebido aqui já está sanitizado por `inspecionarEntrada` —
 * PII substituída por marcadores — então o texto que de fato atravessa a
 * fronteira para o provedor externo nunca contém dado pessoal em claro.
 */
export function montarPrompt(flow: Pick<Flow, "nome" | "gatilho" | "origem">, payloadSanitizado: string): string {
  return [
    `Você está operando o fluxo de automação "${flow.nome}" do AgentFlow.`,
    `Gatilho: ${flow.gatilho}${flow.origem ? ` · Origem: ${flow.origem}` : ""}.`,
    "",
    "Dado o payload abaixo (já sanitizado — marcadores como [[PII:TIPO:N]] substituem dados pessoais",
    "e NÃO devem ser tratados como texto a reescrever, apenas preservados onde aparecerem), produza uma",
    "resposta curta e objetiva descrevendo a ação concluída ou o próximo passo recomendado.",
    "",
    "Payload:",
    payloadSanitizado,
  ].join("\n");
}

/** Deriva os passos do FlowRun a partir da definição do fluxo e do desfecho. */
function construirSteps(flow: Flow, desfecho: "concluido" | "falhou" | "em-andamento", agoraIso: string): FlowRunStep[] {
  // O motor ainda executa o fluxo como um único nó lógico (sem DAG multi-etapa
  // — ver limitação documentada no cabeçalho de `orchestratorAdmin.ts`), então
  // o primeiro passo reflete o desfecho real e os demais ficam ociosos.
  return flow.steps.map((def, indice) => {
    if (indice > 0) {
      return { id: def.id, titulo: def.titulo, status: "ociosa" as const };
    }
    const status = desfecho === "concluido" ? "concluido" : desfecho === "falhou" ? "falhou" : "em-execucao";
    return { id: def.id, titulo: def.titulo, status, timestamp: agoraIso };
  });
}

/**
 * Executa um fluxo sob guardrails, de ponta a ponta, e persiste o resultado.
 *
 * Verificação de posse: o workspace do usuário autenticado precisa coincidir
 * com o workspace do fluxo. Diferente das escritas feitas pelo cliente (onde
 * as regras do Firestore são o único portão), esta escrita roda via Admin SDK
 * e portanto IGNORA as regras — a checagem precisa acontecer aqui, em código,
 * ou qualquer usuário autenticado de qualquer workspace poderia disparar (e
 * ler o resultado de) o fluxo de outro workspace.
 */
export async function executarFluxo(input: ExecutarFluxoInput): Promise<ExecutarFluxoResultado> {
  const flow = await input.portas.lerFlow(input.flowId);
  if (!flow) {
    throw new ErroApi(404, "Fluxo não encontrado.", "fluxo_nao_encontrado");
  }

  const workspaceIdUsuario = await input.portas.lerWorkspaceIdDoUsuario(input.usuario.uid);
  if (!workspaceIdUsuario || workspaceIdUsuario !== flow.workspaceId) {
    throw new ErroApi(403, "Usuário não pertence ao workspace deste fluxo.", "workspace_incompativel");
  }

  const agora = input.agora ?? new Date();
  const agoraIso = agora.toISOString();
  const runId = (input.gerarRunId ?? novoRunId)();
  const traceId = novoTraceId();
  const nodeId = flow.steps[0]?.id;

  const acumulador = novoAcumuladorUso();
  const executor = input.criarExecutor(acumulador);
  const ticketsAbertos: HandoffTicket[] = [];

  const resultado = await guardarChamadaLlm({
    payload: input.payload,
    executor,
    politica: "padrao",
    traceId,
    nodeId,
    trace: nodeId ? [nodeId] : [],
    // `guardarChamadaLlm` só aceita `tokensUsados` fixado antes da chamada, não
    // o valor real medido depois — a política "padrao" não define
    // `orcamentoTokens`, então esta checagem não se aplica aqui. Um orçamento
    // por execução exigiria estender aquele contrato para aceitar o uso
    // medido após o fato; fora do escopo desta integração.
    tokensUsados: 0,
    aoTransbordar: async (solicitacao) => {
      const ticket = await input.portas.abrirTransbordo({
        solicitacao,
        flowId: flow.id,
        flowNome: flow.nome,
        runId,
        workspaceId: flow.workspaceId,
        criadoPor: input.usuario.uid,
      });
      ticketsAbertos.push(ticket);
    },
  });

  const concluido = !resultado.bloqueado && !resultado.transbordo;
  const desfecho = resultado.bloqueado ? "falhou" : concluido ? "concluido" : "em-andamento";

  const metrica: RunCostMetrics = {
    tokensEntrada: acumulador.tokensEntrada,
    tokensSaida: acumulador.tokensSaida,
    custoModeloUsd: acumulador.chamadas > 0 ? acumulador.custoUsd : undefined,
    intervencaoHumana: ticketsAbertos.length > 0,
    modelo: acumulador.modelo,
    concluidoEm: concluido ? agoraIso : undefined,
  };

  const run: FlowRun = {
    id: runId,
    workspaceId: flow.workspaceId,
    flowId: flow.id,
    flowNome: flow.nome,
    // Bloqueio é falha real; transbordo mantém a execução em andamento até a
    // decisão humana — o modelo de dados atual não distingue "pendente de
    // revisão" de "em execução" (ver RunStatus em @/types).
    status: resultado.bloqueado ? "falhou" : concluido ? "concluido" : "em-execucao",
    iniciadoEm: agoraIso,
    steps: construirSteps(flow, desfecho, agoraIso),
    metrica,
  };

  await input.portas.escreverFlowRun(run);

  return { run, bloqueado: resultado.bloqueado, transbordo: resultado.transbordo, ticketsAbertos };
}
