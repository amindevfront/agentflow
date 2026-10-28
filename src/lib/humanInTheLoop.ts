// Transbordo inteligente (Human-in-the-Loop).
//
// Acionado quando o Motor de Guardrails emite veredito `transbordo` ou
// `bloqueado`: a execução é suspensa e um ticket com SLA entra na fila de
// revisão humana.
//
// Dois princípios de privacidade governam este módulo:
//
//  1. **Minimização.** O ticket carrega apenas o payload e a saída MASCARADOS.
//     O operador decide sobre a *decisão* do agente, não precisa ver o dado
//     pessoal para isso. O cofre de PII já foi destruído quando o ticket nasce.
//  2. **Rastreabilidade.** Toda transição de estado gera entrada na trilha de
//     auditoria, com o `traceId` que liga ticket, inspeção e execução.
//
// A ligação com o motor é feita por callback (`criarHandlerDeTransbordo`), não
// por import direto: o motor de guardrails não conhece Firestore, o que o
// mantém testável e executável no servidor sem credenciais de banco.

import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import type {
  GuardrailSeverity,
  GuardrailVerdict,
  GuardrailViolation,
  HandoffDecision,
  HandoffPriority,
  HandoffQueueStats,
  HandoffReason,
  HandoffStatus,
  HandoffTicket,
} from "@/types";
import type { SolicitacaoTransbordo } from "@/lib/guardrails";
import { auth, db } from "./firebase";
import { DEFAULT_WORKSPACE_ID, requireDb } from "./firestore";
import { registrarEventoAuditoriaSilencioso } from "./auditLog";
import { assinarComFallbackDeIndice } from "./firestoreResilience";

const COLECAO = "hitlTickets";

/**
 * SLA por prioridade, em minutos.
 *
 * P1 cobre o caso em que a execução de um nó crítico está travada esperando
 * decisão humana — cada minuto é indisponibilidade de produto. P4 é revisão
 * informativa, que pode esperar um turno de trabalho.
 */
export const SLA_MINUTOS: Record<HandoffPriority, number> = {
  p1: 15,
  p2: 60,
  p3: 240,
  p4: 1440,
};

export const ROTULO_PRIORIDADE: Record<HandoffPriority, string> = {
  p1: "P1 · crítico",
  p2: "P2 · alto",
  p3: "P3 · médio",
  p4: "P4 · baixo",
};

export const ROTULO_MOTIVO: Record<HandoffReason, string> = {
  "guardrail-bloqueio": "Bloqueio de guardrail",
  "guardrail-revisao": "Revisão solicitada pelo guardrail",
  "pii-sensivel": "Dado pessoal sensível",
  "baixa-consistencia": "Respostas inconsistentes",
  "sem-fundamentacao": "Resposta sem fundamentação",
  "loop-detectado": "Loop detectado",
  "orcamento-excedido": "Orçamento de tokens excedido",
  "erro-execucao": "Erro de execução",
  "solicitacao-manual": "Solicitação manual",
  "frustracao-critica": "Frustração crítica do cliente",
  "compliance-preventivo": "Compliance preventivo (trabalhista/LGPD)",
};

export const ROTULO_STATUS: Record<HandoffStatus, string> = {
  aberto: "aberto",
  "em-analise": "em análise",
  resolvido: "resolvido",
  expirado: "expirado",
  cancelado: "cancelado",
};

export const ROTULO_DECISAO: Record<HandoffDecision, string> = {
  aprovado: "aprovado",
  rejeitado: "rejeitado",
  editado: "editado",
  escalado: "escalado",
};

/**
 * Deriva a prioridade a partir da severidade e da criticidade do nó.
 *
 * A criticidade do nó eleva um nível: a mesma violação em um nó de triagem e em
 * um nó de pagamento não merece o mesmo SLA.
 */
export function derivarPrioridade(severidade: GuardrailSeverity, noCritico: boolean): HandoffPriority {
  const base: Record<GuardrailSeverity, HandoffPriority> = {
    critica: "p1",
    alta: "p2",
    media: "p3",
    baixa: "p4",
    info: "p4",
  };

  const escala: HandoffPriority[] = ["p1", "p2", "p3", "p4"];
  const indice = escala.indexOf(base[severidade]);
  return noCritico ? escala[Math.max(0, indice - 1)] : escala[indice];
}

/**
 * Traduz as violações no motivo mais específico disponível.
 *
 * A ordem é por especificidade decrescente: dizer "respostas inconsistentes"
 * orienta a revisão muito melhor do que "revisão solicitada pelo guardrail".
 */
export function derivarMotivo(
  violacoes: GuardrailViolation[],
  veredito: GuardrailVerdict
): HandoffReason {
  const regras = new Set(violacoes.map((v) => v.regra));

  if (regras.has("loop-ciclo-no") || regras.has("loop-repeticao")) return "loop-detectado";
  if (regras.has("inconsistencia-estocastica")) return "baixa-consistencia";
  if (regras.has("alucinacao-sem-fundamento") || regras.has("numero-nao-fundamentado")) {
    return "sem-fundamentacao";
  }
  if (regras.has("segredo-em-payload") || regras.has("pii-vazamento-saida")) return "pii-sensivel";
  if (regras.has("orcamento-tokens")) return "orcamento-excedido";
  if (regras.has("erro-interno-guardrail")) return "erro-execucao";

  return veredito === "bloqueado" ? "guardrail-bloqueio" : "guardrail-revisao";
}

function novoIdTicket(): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `hitl_${aleatorio}`;
}

export interface ConstruirTicketInput {
  solicitacao: SolicitacaoTransbordo;
  flowId: string;
  flowNome: string;
  runId?: string;
  noCritico?: boolean;
  workspaceId?: string;
  criadoPor?: string;
  /** Sobrepõe o motivo derivado das violações (ex.: solicitação manual). */
  motivoForcado?: HandoffReason;
  /** Presente quando o ticket se origina da Neural Inbox, não de um fluxo. */
  conversationId?: string;
  /** Injetável para teste determinístico. */
  agora?: Date;
  /** Injetável para teste determinístico. */
  gerarId?: () => string;
}

/**
 * Monta o ticket. Função pura: não toca em rede nem em banco, o que a torna
 * diretamente testável — a lógica de SLA e prioridade é a parte que mais
 * importa acertar.
 */
export function construirTicket(entrada: ConstruirTicketInput): HandoffTicket {
  const { solicitacao } = entrada;
  const agora = entrada.agora ?? new Date();
  const noCritico = entrada.noCritico ?? solicitacao.politicaId === "no-critico";

  const prioridade = derivarPrioridade(solicitacao.severidade, noCritico);
  const slaExpiraEm = new Date(agora.getTime() + SLA_MINUTOS[prioridade] * 60_000);

  return {
    id: (entrada.gerarId ?? novoIdTicket)(),
    workspaceId: entrada.workspaceId ?? DEFAULT_WORKSPACE_ID,
    flowId: entrada.flowId,
    flowNome: entrada.flowNome,
    runId: entrada.runId,
    conversationId: entrada.conversationId,
    nodeId: solicitacao.nodeId,
    traceId: solicitacao.traceId,
    motivo: entrada.motivoForcado ?? derivarMotivo(solicitacao.violacoes, solicitacao.veredito),
    status: "aberto",
    prioridade,
    severidade: solicitacao.severidade,
    violacoes: solicitacao.violacoes,
    payloadMascarado: solicitacao.payloadMascarado,
    saidaMascarada: solicitacao.saidaMascarada,
    criadoEm: agora.toISOString(),
    criadoPor: entrada.criadoPor ?? "sistema",
    slaExpiraEm: slaExpiraEm.toISOString(),
    atribuidoPara: null,
    atribuidoEm: null,
  };
}

/** Milissegundos restantes de SLA. Negativo quando já violado. */
export function slaRestanteMs(ticket: HandoffTicket, referencia = new Date()): number {
  return new Date(ticket.slaExpiraEm).getTime() - referencia.getTime();
}

/** `true` quando o SLA venceu com o ticket ainda em aberto. */
export function slaViolado(ticket: HandoffTicket, referencia = new Date()): boolean {
  if (ticket.status === "resolvido" || ticket.status === "cancelado") return false;
  return slaRestanteMs(ticket, referencia) < 0;
}

/** Formata o SLA restante em texto curto para a UI. */
export function formatarSla(ticket: HandoffTicket, referencia = new Date()): string {
  const restante = slaRestanteMs(ticket, referencia);
  if (ticket.status === "resolvido") return "concluído";
  if (restante < 0) {
    const atrasoMin = Math.round(-restante / 60_000);
    return atrasoMin >= 60 ? `atrasado ${Math.round(atrasoMin / 60)}h` : `atrasado ${atrasoMin} min`;
  }
  const minutos = Math.round(restante / 60_000);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.round(minutos / 60);
  return horas < 24 ? `${horas}h` : `${Math.round(horas / 24)}d`;
}

/**
 * Persiste um ticket de transbordo e registra o evento na auditoria.
 *
 * A auditoria é registrada em modo silencioso: o ticket já está gravado e a
 * execução já está suspensa. Falhar a abertura do transbordo por causa de uma
 * indisponibilidade no log deixaria o fluxo num limbo pior do que um log
 * atrasado — que, ainda assim, é reenviado pela fila local.
 */
export async function abrirTransbordo(entrada: ConstruirTicketInput): Promise<HandoffTicket> {
  const database = requireDb();
  const ticket = construirTicket({
    ...entrada,
    criadoPor: entrada.criadoPor ?? auth?.currentUser?.uid ?? "sistema",
  });

  await setDoc(doc(database, COLECAO, ticket.id), ticket);

  await registrarEventoAuditoriaSilencioso({
    tipo: "hitl.ticket.aberto",
    recurso: `${COLECAO}/${ticket.id}`,
    workspaceId: ticket.workspaceId,
    traceId: ticket.traceId,
    severidade: ticket.severidade,
    detalhes: {
      motivo: ticket.motivo,
      prioridade: ticket.prioridade,
      flowId: ticket.flowId,
      violacoes: ticket.violacoes.length,
      slaExpiraEm: ticket.slaExpiraEm,
    },
    // Violações vão cifradas: a mensagem de uma violação pode conter trechos de
    // evidência e não precisa ficar legível na listagem de auditoria.
    detalhesSensiveis: { violacoes: ticket.violacoes },
  });

  return ticket;
}

/**
 * Produz o callback `aoTransbordar` esperado por `guardarChamadaLlm`.
 *
 * Esta é a costura entre os dois módulos: o motor emite a solicitação sem saber
 * o que acontece depois, e este handler a transforma em ticket persistido.
 */
export function criarHandlerDeTransbordo(contexto: {
  flowId: string;
  flowNome: string;
  runId?: string;
  noCritico?: boolean;
  workspaceId?: string;
  aoAbrir?: (ticket: HandoffTicket) => void;
}): (solicitacao: SolicitacaoTransbordo) => Promise<void> {
  return async function handler(solicitacao: SolicitacaoTransbordo): Promise<void> {
    const ticket = await abrirTransbordo({ solicitacao, ...contexto });
    contexto.aoAbrir?.(ticket);
  };
}

/**
 * Assume um ticket para análise.
 *
 * `atribuidoPara` é condição na regra do Firestore para a resolução: só quem
 * assumiu pode decidir, o que evita duas pessoas resolvendo o mesmo caso em
 * direções opostas.
 */
export async function assumirTicket(ticketId: string, workspaceId = DEFAULT_WORKSPACE_ID): Promise<void> {
  const database = requireDb();
  const uid = auth?.currentUser?.uid;
  if (!uid) throw new Error("É necessário estar autenticado para assumir um transbordo.");

  const agora = new Date().toISOString();
  await updateDoc(doc(database, COLECAO, ticketId), {
    status: "em-analise" satisfies HandoffStatus,
    atribuidoPara: uid,
    atribuidoEm: agora,
  });

  await registrarEventoAuditoriaSilencioso({
    tipo: "hitl.ticket.assumido",
    recurso: `${COLECAO}/${ticketId}`,
    workspaceId,
    detalhes: { atribuidoPara: uid },
  });
}

export interface ResolucaoInput {
  ticketId: string;
  decisao: HandoffDecision;
  justificativa: string;
  /** Obrigatório quando a decisão é `editado`. */
  saidaCorrigida?: string;
  workspaceId?: string;
}

/**
 * Resolve um ticket de transbordo.
 *
 * A justificativa é obrigatória por exigência de conformidade: uma decisão
 * humana que sobrepõe um guardrail precisa de motivo registrado, senão a
 * trilha mostra que alguém aprovou algo sem dizer por quê.
 */
export async function resolverTicket(entrada: ResolucaoInput): Promise<void> {
  const database = requireDb();
  const uid = auth?.currentUser?.uid;
  if (!uid) throw new Error("É necessário estar autenticado para resolver um transbordo.");

  const justificativa = entrada.justificativa.trim();
  if (justificativa.length < 10) {
    throw new Error("Descreva a justificativa da decisão com pelo menos 10 caracteres.");
  }
  if (entrada.decisao === "editado" && !entrada.saidaCorrigida?.trim()) {
    throw new Error("A decisão \"editado\" exige a saída corrigida.");
  }

  const workspaceId = entrada.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const agora = new Date().toISOString();
  const escalado = entrada.decisao === "escalado";

  await updateDoc(doc(database, COLECAO, entrada.ticketId), {
    // Escalonamento mantém o ticket aberto, apenas liberando a atribuição para
    // que outra pessoa (ou outro nível de suporte) possa assumir.
    status: (escalado ? "aberto" : "resolvido") satisfies HandoffStatus,
    decisao: entrada.decisao,
    decididoPor: uid,
    decididoEm: agora,
    justificativa,
    saidaCorrigida: entrada.saidaCorrigida?.trim() ?? null,
    atribuidoPara: escalado ? null : uid,
  });

  await registrarEventoAuditoriaSilencioso({
    tipo: "hitl.ticket.resolvido",
    recurso: `${COLECAO}/${entrada.ticketId}`,
    workspaceId,
    resultado: entrada.decisao === "rejeitado" ? "negado" : "sucesso",
    detalhes: { decisao: entrada.decisao, decididoPor: uid },
    detalhesSensiveis: { justificativa, saidaCorrigida: entrada.saidaCorrigida ?? null },
  });
}

export async function cancelarTicket(
  ticketId: string,
  motivo: string,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<void> {
  const database = requireDb();
  await updateDoc(doc(database, COLECAO, ticketId), {
    status: "cancelado" satisfies HandoffStatus,
    justificativa: motivo.trim(),
    decididoPor: auth?.currentUser?.uid ?? "sistema",
    decididoEm: new Date().toISOString(),
  });

  await registrarEventoAuditoriaSilencioso({
    tipo: "hitl.ticket.resolvido",
    recurso: `${COLECAO}/${ticketId}`,
    workspaceId,
    resultado: "negado",
    detalhes: { decisao: "cancelado" },
  });
}

/**
 * Marca como expirados os tickets cujo SLA venceu.
 *
 * Implementado como varredura sob demanda (ao abrir o painel) em vez de job
 * agendado, porque o AgentFlow não tem worker server-side nesta versão. A
 * consequência é que a expiração é observada quando alguém olha a fila; o
 * campo `slaExpiraEm` continua sendo a fonte de verdade para qualquer relatório.
 */
export async function expirarTicketsVencidos(workspaceId = DEFAULT_WORKSPACE_ID): Promise<number> {
  const database = requireDb();
  const agora = new Date();

  const consulta = query(
    collection(database, COLECAO),
    where("workspaceId", "==", workspaceId),
    where("status", "in", ["aberto", "em-analise"] satisfies HandoffStatus[]),
    limit(200)
  );

  const resultado = await getDocs(consulta);
  let expirados = 0;

  for (const documento of resultado.docs) {
    const ticket = documento.data() as HandoffTicket;
    if (!slaViolado(ticket, agora)) continue;

    try {
      await updateDoc(documento.ref, { status: "expirado" satisfies HandoffStatus });
      expirados += 1;
      await registrarEventoAuditoriaSilencioso({
        tipo: "hitl.ticket.expirado",
        recurso: `${COLECAO}/${ticket.id}`,
        workspaceId,
        resultado: "falha",
        severidade: "alta",
        detalhes: { prioridade: ticket.prioridade, slaExpiraEm: ticket.slaExpiraEm },
      });
    } catch (erro) {
      // Um ticket que não pôde ser atualizado não deve impedir os demais.
      console.error(`[transbordo] falha ao expirar ${ticket.id}:`, erro);
    }
  }

  return expirados;
}

/** Assina a fila de transbordo em tempo real. */
export function subscribeFilaTransbordo(
  onChange: (tickets: HandoffTicket[]) => void,
  // `onError` nunca recebe o erro — quem consome mostra um texto amigável
  // fixo; índice ausente é absorvido de forma transparente (ver
  // `assinarComFallbackDeIndice`) e nem chega a chamar isto.
  opcoes: { workspaceId?: string; limite?: number; onError?: () => void } = {}
): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }

  const workspaceId = opcoes.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const limite = opcoes.limite ?? 100;
  const mapearTicket = (d: QueryDocumentSnapshot) => ({ ...(d.data() as HandoffTicket), id: d.id });

  return assinarComFallbackDeIndice({
    consultaPrincipal: query(
      collection(db, COLECAO),
      where("workspaceId", "==", workspaceId),
      orderBy("criadoEm", "desc"),
      limit(limite)
    ),
    consultaFallback: query(collection(db, COLECAO), where("workspaceId", "==", workspaceId)),
    mapearDoc: mapearTicket,
    ordenarFallback: (lista) => [...lista].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)).slice(0, limite),
    onChange,
    aoFalharDeFormaIrrecuperavel: opcoes.onError,
    contexto: "transbordo",
  });
}

/**
 * Ordena a fila pela urgência real de atendimento.
 *
 * Critérios, em ordem: SLA violado primeiro (já é incidente), depois prioridade,
 * depois o mais antigo — para que nenhum ticket de baixa prioridade fique
 * eternamente no fim da fila.
 */
export function ordenarFila(tickets: HandoffTicket[], referencia = new Date()): HandoffTicket[] {
  const pesoStatus: Record<HandoffStatus, number> = {
    aberto: 0,
    "em-analise": 1,
    expirado: 2,
    resolvido: 3,
    cancelado: 4,
  };

  return [...tickets].sort((a, b) => {
    if (pesoStatus[a.status] !== pesoStatus[b.status]) return pesoStatus[a.status] - pesoStatus[b.status];

    const violadoA = slaViolado(a, referencia) ? 0 : 1;
    const violadoB = slaViolado(b, referencia) ? 0 : 1;
    if (violadoA !== violadoB) return violadoA - violadoB;

    if (a.prioridade !== b.prioridade) return a.prioridade.localeCompare(b.prioridade);
    return a.criadoEm.localeCompare(b.criadoEm);
  });
}

/**
 * Estatísticas da fila. Função pura — consumida pelo painel de governança e
 * pelo widget de ROI, que usa `resolvidos` e o tempo médio para calcular o
 * custo da revisão humana.
 */
export function estatisticasFila(tickets: HandoffTicket[], referencia = new Date()): HandoffQueueStats {
  const porPrioridade: Record<HandoffPriority, number> = { p1: 0, p2: 0, p3: 0, p4: 0 };
  let abertos = 0;
  let emAnalise = 0;
  let resolvidos = 0;
  let expirados = 0;
  let emViolacaoDeSla = 0;
  let somaResolucaoMin = 0;
  let contagemResolucao = 0;

  for (const ticket of tickets) {
    porPrioridade[ticket.prioridade] += 1;

    switch (ticket.status) {
      case "aberto":
        abertos += 1;
        break;
      case "em-analise":
        emAnalise += 1;
        break;
      case "resolvido":
        resolvidos += 1;
        break;
      case "expirado":
        expirados += 1;
        break;
      default:
        break;
    }

    if (slaViolado(ticket, referencia)) emViolacaoDeSla += 1;

    if (ticket.status === "resolvido" && ticket.decididoEm) {
      const inicio = new Date(ticket.criadoEm).getTime();
      const fim = new Date(ticket.decididoEm).getTime();
      if (Number.isFinite(inicio) && Number.isFinite(fim) && fim >= inicio) {
        somaResolucaoMin += (fim - inicio) / 60_000;
        contagemResolucao += 1;
      }
    }
  }

  return {
    total: tickets.length,
    abertos,
    emAnalise,
    resolvidos,
    expirados,
    emViolacaoDeSla,
    porPrioridade,
    tempoMedioResolucaoMin:
      contagemResolucao > 0 ? Number((somaResolucaoMin / contagemResolucao).toFixed(1)) : null,
  };
}

/** Abre um transbordo por decisão humana, fora do caminho do guardrail. */
export async function solicitarRevisaoManual(entrada: {
  flowId: string;
  flowNome: string;
  runId?: string;
  motivoTexto: string;
  payloadMascarado: string;
  workspaceId?: string;
}): Promise<HandoffTicket> {
  return abrirTransbordo({
    solicitacao: {
      traceId: `manual_${Date.now().toString(36)}`,
      politicaId: "padrao",
      severidade: "media",
      veredito: "transbordo",
      violacoes: [
        {
          regra: "erro-interno-guardrail",
          severidade: "media",
          mensagem: entrada.motivoTexto.trim().slice(0, 500),
        },
      ],
      payloadMascarado: entrada.payloadMascarado,
    },
    flowId: entrada.flowId,
    flowNome: entrada.flowNome,
    runId: entrada.runId,
    workspaceId: entrada.workspaceId,
    motivoForcado: "solicitacao-manual",
  });
}
