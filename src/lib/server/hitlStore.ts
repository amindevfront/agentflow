// Transbordo humano (HITL) — persistência server-side via Admin SDK.
//
// SERVER-ONLY.
//
// Contraparte de `@/lib/humanInTheLoop` para o caminho de execução real do
// motor de orquestração. Deliberadamente NÃO importa `@/lib/humanInTheLoop`:
// aquele módulo depende do SDK de cliente do Firebase (`firebase/firestore`,
// `./firebase`) para escrever sob a identidade do operador logado no browser.
// Um processo de servidor não tem esse contexto de sessão, e misturar os dois
// SDKs no mesmo módulo borraria a fronteira cliente/servidor que o resto do
// projeto mantém deliberadamente limpa (ver `assertServidor()` em `env.ts`).
//
// A lógica de prioridade/SLA/motivo é replicada aqui de forma mínima e pura —
// mantida em paridade com `derivarPrioridade`/`derivarMotivo`/`SLA_MINUTOS` do
// módulo cliente; os dois lados têm cobertura de teste equivalente
// (`tests/governance.test.ts` e `tests/orchestrator.test.ts`) para que uma
// divergência futura entre eles seja pega por CI, não em produção.

import type {
  GuardrailSeverity,
  GuardrailVerdict,
  GuardrailViolation,
  HandoffPriority,
  HandoffReason,
  HandoffTicket,
} from "@/types";
import type { SolicitacaoTransbordo } from "@/lib/guardrails";
import { firestoreAdmin } from "./firebaseAdmin";

const COLECAO = "hitlTickets";

/** Espelha `SLA_MINUTOS` de `@/lib/humanInTheLoop` — mesmos prazos, por prioridade. */
export const SLA_MINUTOS: Record<HandoffPriority, number> = { p1: 15, p2: 60, p3: 240, p4: 1440 };

/** Espelha `derivarPrioridade` de `@/lib/humanInTheLoop`. */
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

/** Espelha `derivarMotivo` de `@/lib/humanInTheLoop`. */
export function derivarMotivo(violacoes: GuardrailViolation[], veredito: GuardrailVerdict): HandoffReason {
  const regras = new Set(violacoes.map((v) => v.regra));
  if (regras.has("loop-ciclo-no") || regras.has("loop-repeticao")) return "loop-detectado";
  if (regras.has("inconsistencia-estocastica")) return "baixa-consistencia";
  if (regras.has("alucinacao-sem-fundamento") || regras.has("numero-nao-fundamentado")) return "sem-fundamentacao";
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

export interface ConstruirTicketAdminInput {
  solicitacao: SolicitacaoTransbordo;
  flowId: string;
  flowNome: string;
  runId?: string;
  noCritico?: boolean;
  workspaceId: string;
  criadoPor: string;
  /** Presente quando o ticket se origina da Neural Inbox (inclusive do Web Widget), não de um fluxo — espelha `ConstruirTicketInput` do lado cliente. */
  conversationId?: string;
  /** Sobrepõe o motivo derivado das violações — espelha `ConstruirTicketInput` do lado cliente. */
  motivoForcado?: HandoffReason;
  agora?: Date;
  gerarId?: () => string;
}

/** Função pura — testável sem Firestore, sem Admin SDK, sem rede. */
export function construirTicketAdmin(entrada: ConstruirTicketAdminInput): HandoffTicket {
  const { solicitacao } = entrada;
  const agora = entrada.agora ?? new Date();
  const noCritico = entrada.noCritico ?? solicitacao.politicaId === "no-critico";
  const prioridade = derivarPrioridade(solicitacao.severidade, noCritico);
  const slaExpiraEm = new Date(agora.getTime() + SLA_MINUTOS[prioridade] * 60_000);

  return {
    id: (entrada.gerarId ?? novoIdTicket)(),
    workspaceId: entrada.workspaceId,
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
    criadoPor: entrada.criadoPor,
    slaExpiraEm: slaExpiraEm.toISOString(),
    atribuidoPara: null,
    atribuidoEm: null,
  };
}

/** Persiste o ticket via Admin SDK — bypassa as regras do Firestore por desenho. */
export async function abrirTransbordoAdmin(entrada: ConstruirTicketAdminInput): Promise<HandoffTicket> {
  const ticket = construirTicketAdmin(entrada);
  await firestoreAdmin().collection(COLECAO).doc(ticket.id).set(ticket);
  return ticket;
}

/**
 * Produz o callback `aoTransbordar` esperado por `guardarChamadaLlm`, no
 * mesmo formato que `criarHandlerDeTransbordo` oferece ao cliente — a
 * assinatura é a costura entre o motor de guardrails (que não sabe nada de
 * Firestore) e a persistência do ticket.
 */
export function criarHandlerDeTransbordoAdmin(contexto: {
  flowId: string;
  flowNome: string;
  runId?: string;
  noCritico?: boolean;
  workspaceId: string;
  criadoPor: string;
  aoAbrir?: (ticket: HandoffTicket) => void;
}): (solicitacao: SolicitacaoTransbordo) => Promise<void> {
  return async function handler(solicitacao: SolicitacaoTransbordo): Promise<void> {
    const ticket = await abrirTransbordoAdmin({ solicitacao, ...contexto });
    contexto.aoAbrir?.(ticket);
  };
}
