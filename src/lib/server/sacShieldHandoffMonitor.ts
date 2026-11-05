// SAC Shield — cronometragem de handoff e fallback regulatório.
//
// SERVER-ONLY.
//
// Cobre o requisito central do SAC Shield: um transbordo humano vinculado a
// uma conversa real (`HandoffTicket.conversationId` presente — ou seja, um
// cliente de verdade esperando, não uma revisão interna de fluxo) NUNCA pode
// estourar a janela legal de atendimento em silêncio. A janela em si já
// existe — é `HandoffTicket.slaExpiraEm`, calculada por prioridade em
// `construirTicketAdmin` (`./hitlStore`), a mesma referência que o Decreto do
// SAC e regulações equivalentes de atendimento ao consumidor cobram: P1 (15
// min) é o teto mais apertado, usado quando a frustração do cliente ou um
// guardrail crítico já indicou urgência.
//
// O que este módulo adiciona não é um SEGUNDO relógio — é a REAÇÃO automática
// que faltava quando o primeiro vence:
//
//   1. fallback seguro: o ticket é marcado "expirado" e a conversa tem o bot
//      congelado (`atribuidoTipo: "nenhum"`) — ninguém, nem IA nem o operador
//      que nunca assumiu, continua "responsável" por um caso que já violou o
//      prazo legal. Isso evita que o caso seja contado como "em atendimento"
//      em uma auditoria quando na verdade está abandonado.
//   2. alerta crítico: a entrada de auditoria nasce com `severidade: "critica"`
//      e um log `console.error` com prefixo dedicado — o mesmo padrão de
//      alerta que `DisjuntorChamadaExterna` usa ao abrir (`./externalApiBreaker`).
//   3. rastreabilidade forense: o fallback e o selo da trilha de auditoria
//      acontecem na MESMA transação do Admin SDK que `./auditChainStore` já
//      expõe para isso (`executarTransacaoDeSelo` aceita `tx`/`db` externos
//      exatamente para ser composto assim) — o estado da conversa, o status
//      do ticket e a entrada de auditoria avançam juntos ou nenhum avança.
//
// Tickets SEM `conversationId` (revisão de fluxo, nenhum cliente esperando)
// continuam cobertos apenas pela expiração passiva existente
// (`expirarTicketsVencidos` em `@/lib/humanInTheLoop`) — duplicar o mecanismo
// para esse caso não teria efeito prático e confundiria dois conceitos
// diferentes de "vencido".

import type { Transaction } from "firebase-admin/firestore";
import type { AlertaSacShield, AuditEventBody, Conversation, HandoffTicket, ResultadoTickSacShieldSla } from "@/types";
import { executarTransacaoDeSelo } from "./auditChainStore";
import { chaveAuditoria } from "./env";
import { firestoreAdmin } from "./firebaseAdmin";
import { slaRestanteMsAdmin, slaVioladoAdmin } from "./hitlStore";

const COLECAO_TICKETS = "hitlTickets";
const COLECAO_CONVERSAS = "conversations";

/**
 * Decide quais tickets precisam do fallback regulatório — função pura, sem
 * Firestore, diretamente testável. Critérios: vinculado a uma conversa real,
 * ainda aberto para decisão, e com a janela legal já vencida.
 */
export function detectarTicketsEmViolacaoRegulatoria(
  tickets: HandoffTicket[],
  referencia = new Date()
): HandoffTicket[] {
  return tickets.filter(
    (ticket) =>
      Boolean(ticket.conversationId) &&
      (ticket.status === "aberto" || ticket.status === "em-analise") &&
      slaVioladoAdmin(ticket, referencia)
  );
}

export interface EntradaTransacaoFallbackSacShield {
  ticketId: string;
  workspaceId: string;
  chaveHmac: Uint8Array;
  referencia: Date;
}

/**
 * Corpo da transação do fallback — recebe `tx`/`db` como o subconjunto que
 * usa (mesmo desenho de `executarTransacaoDeSelo` e
 * `executarTransacaoDeBalde`), testável com um dublê de Firestore sem rede
 * nem emulador.
 *
 * Revalida tudo DENTRO da transação (não confia só na varredura que decidiu
 * chamar esta função): se o ticket já não existe, já foi resolvido, ou o SLA
 * deixou de estar violado entre a leitura em lote e agora, não aplica nada e
 * devolve `null` — idempotente e seguro sob concorrência (duas chamadas
 * simultâneas para o mesmo ticket nunca produzem dois fallbacks nem duas
 * entradas de auditoria).
 */
export async function executarTransacaoFallbackSacShield(
  tx: Pick<Transaction, "get" | "set">,
  db: Pick<ReturnType<typeof firestoreAdmin>, "collection">,
  entrada: EntradaTransacaoFallbackSacShield
): Promise<AlertaSacShield | null> {
  const refTicket = db.collection(COLECAO_TICKETS).doc(entrada.ticketId);
  const snapTicket = await tx.get(refTicket);
  if (!snapTicket.exists) return null;

  const ticket = snapTicket.data() as HandoffTicket;
  if (!ticket.conversationId) return null;
  if (ticket.status !== "aberto" && ticket.status !== "em-analise") return null;
  if (!slaVioladoAdmin(ticket, entrada.referencia)) return null;

  const agoraIso = entrada.referencia.toISOString();
  const atrasoMinutos = Math.round(-slaRestanteMsAdmin(ticket, entrada.referencia) / 60_000);
  const motivo =
    `Fallback seguro do SAC Shield: transbordo humano (${ticket.prioridade}) sem decisão ` +
    `${atrasoMinutos} min além da janela legal de atendimento.`;

  tx.set(refTicket, { ...ticket, status: "expirado" });

  const refConversa = db.collection(COLECAO_CONVERSAS).doc(ticket.conversationId);
  const snapConversa = await tx.get(refConversa);
  if (snapConversa.exists) {
    const conversa = snapConversa.data() as Conversation;
    tx.set(refConversa, {
      ...conversa,
      circuitBreakerAtivo: true,
      sacShieldFallbackAtivo: true,
      sacShieldFallbackMotivo: motivo,
      sacShieldFallbackEm: agoraIso,
      atribuidoTipo: "nenhum",
      atribuidoId: null,
      atribuidoNome: null,
    } satisfies Conversation);
  }

  const corpo: AuditEventBody = {
    tipo: "sacshield.handoff.fallback-acionado",
    resultado: "falha",
    workspaceId: entrada.workspaceId,
    ator: "sistema",
    recurso: `${COLECAO_TICKETS}/${ticket.id}`,
    traceId: ticket.traceId,
    severidade: "critica",
    detalhes: {
      conversationId: ticket.conversationId,
      prioridade: ticket.prioridade,
      atrasoMinutos,
      slaExpiraEm: ticket.slaExpiraEm,
    },
    ocorridoEm: agoraIso,
  };

  const entradaAuditoria = await executarTransacaoDeSelo(tx, db, entrada.workspaceId, corpo, entrada.chaveHmac);

  console.error(
    `[sac-shield:CRITICO] ticket ${ticket.id} (conversa ${ticket.conversationId}) estourou a janela legal ` +
      `de atendimento por ${atrasoMinutos} min — fallback seguro aplicado, auditoria ${entradaAuditoria.id}.`
  );

  return {
    ticketId: ticket.id,
    conversationId: ticket.conversationId,
    workspaceId: entrada.workspaceId,
    prioridade: ticket.prioridade,
    severidade: "critica",
    atrasoMinutos,
    auditEntryId: entradaAuditoria.id,
    ocorridoEm: agoraIso,
  };
}

export interface OpcoesTickSacShieldSla {
  referencia?: Date;
  /** Injetável em teste; em produção é sempre `chaveAuditoria()`. */
  chaveHmac?: Uint8Array;
}

/**
 * Varre os tickets abertos/em-análise do workspace e aplica o fallback a
 * todos os que já violaram a janela legal — chamada repetidamente por um
 * scheduler externo (`/api/sac-shield/tick`), mesmo padrão de
 * `processarTickCampanhas`. Cada ticket vencido roda em sua própria
 * transação: uma falha isolada (ex.: colisão de escrita) não impede os
 * demais de receber o fallback.
 */
export async function processarTickSacShieldSla(
  workspaceId: string,
  opcoes: OpcoesTickSacShieldSla = {}
): Promise<ResultadoTickSacShieldSla> {
  const db = firestoreAdmin();
  const referencia = opcoes.referencia ?? new Date();
  const chaveHmac = opcoes.chaveHmac ?? (await chaveAuditoria());

  const ticketsSnap = await db
    .collection(COLECAO_TICKETS)
    .where("workspaceId", "==", workspaceId)
    .where("status", "in", ["aberto", "em-analise"])
    .get();

  const tickets = ticketsSnap.docs.map((documento) => documento.data() as HandoffTicket);
  const vencidos = detectarTicketsEmViolacaoRegulatoria(tickets, referencia);

  const alertas: AlertaSacShield[] = [];
  for (const ticket of vencidos) {
    try {
      const alerta = await db.runTransaction((tx) =>
        executarTransacaoFallbackSacShield(tx, db, {
          ticketId: ticket.id,
          workspaceId,
          chaveHmac,
          referencia,
        })
      );
      if (alerta) alertas.push(alerta);
    } catch (erro) {
      // Um ticket que não pôde ser atualizado não deve impedir os demais —
      // mesmo racional de `aplicarCircuitBreakerPorSlaVencido`.
      console.error(`[sac-shield] falha ao aplicar fallback no ticket ${ticket.id}:`, erro);
    }
  }

  return { ticketsVerificados: tickets.length, fallbacksAplicados: alertas.length, alertas };
}
