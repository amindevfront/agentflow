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
  ResumoExecutivoB2B,
  ResumoExecutivoClinico,
  ResumoExecutivoCobranca,
  ResumoExecutivoHandoff,
  ResumoExecutivoMotoristaSpot,
} from "@/types";
import type { SolicitacaoTransbordo } from "@/lib/guardrails";
import type { ConnectHubEventType } from "@/types";
import type { Idioma } from "@/lib/jurisdiction";
import { estimarRiscoPrevenido } from "@/lib/governance/marginGuard";
import { registrarRiscoPrevenidoAdmin } from "@/lib/governance/marginGuardAdmin";
import { despacharEventoConnectHubAdmin, montarPayloadConnectHub } from "./connectors";
import { firestoreAdmin } from "./firebaseAdmin";
import { gerarSugestaoGhostCoachAdmin } from "./ghostCoach";

const COLECAO = "hitlTickets";

/**
 * Motivos de ticket que representam um agendamento/reunião confirmado pelo
 * próprio lead/paciente (Módulos Verticais 1-3) — ver `ConnectHubEventType`
 * e, no Painel de ROI (`@/lib/server/roiDashboard`), `agendamentosConfirmados`.
 * Qualquer outro motivo de ticket é um handoff genérico bem-sucedido.
 * Exportado para que os dois consumidores nunca divirjam sobre "o que conta
 * como agendamento confirmado".
 */
export const MOTIVOS_AGENDAMENTO_VALIDADO = new Set<HandoffReason>([
  "agendamento-visita-presencial",
  "confirmacao-agendamento-clinico",
  "confirmacao-reuniao-diagnostico-b2b",
]);

/**
 * AgentFlow Connect Hub: todo ticket HITL criado com sucesso é, por
 * definição, um handoff que funcionou — a IA identificou corretamente que
 * o caso precisava de um humano e a escalação foi persistida. Notificar o
 * webhook de saída do workspace aqui, no ÚNICO ponto que cria um ticket
 * (tanto `abrirTransbordoAdmin` quanto, indiretamente,
 * `criarHandlerDeTransbordoAdmin`), cobre os dois eventos do Connect Hub
 * sem duplicar a decisão em cada chamador: motivos de confirmação de
 * agendamento/reunião (Módulos Verticais 1-3) viram `"agendamento.validado"`;
 * qualquer outro motivo vira `"handoff.sucesso"`.
 *
 * Best-effort e nunca bloqueante: a ausência de Connect Hub configurado, uma
 * falha de rede no webhook do cliente ou qualquer outro erro aqui NUNCA
 * podem impedir a criação do ticket em si — o dado já está seguro em
 * `hitlTickets`, o Connect Hub é um reforço de integração, não um
 * pré-requisito do handoff.
 */
async function notificarConnectHub(ticket: HandoffTicket): Promise<void> {
  try {
    const evento: ConnectHubEventType = MOTIVOS_AGENDAMENTO_VALIDADO.has(ticket.motivo)
      ? "agendamento.validado"
      : "handoff.sucesso";

    const payload = montarPayloadConnectHub({
      evento,
      workspaceId: ticket.workspaceId,
      traceId: ticket.traceId,
      dados: {
        ticketId: ticket.id,
        flowId: ticket.flowId,
        flowNome: ticket.flowNome,
        conversationId: ticket.conversationId ?? null,
        motivo: ticket.motivo,
        prioridade: ticket.prioridade,
        severidade: ticket.severidade,
        payloadMascarado: ticket.payloadMascarado,
        saidaMascarada: ticket.saidaMascarada ?? null,
        resumoExecutivo: ticket.resumoExecutivo ?? null,
        resumoExecutivoClinico: ticket.resumoExecutivoClinico ?? null,
        resumoExecutivoB2B: ticket.resumoExecutivoB2B ?? null,
        resumoExecutivoCobranca: ticket.resumoExecutivoCobranca ?? null,
        criadoEm: ticket.criadoEm,
        slaExpiraEm: ticket.slaExpiraEm,
      },
    });

    await despacharEventoConnectHubAdmin({ workspaceId: ticket.workspaceId, payload });
  } catch (erro) {
    console.error(`[connect-hub] falha ao notificar o webhook de saída para o ticket ${ticket.id}:`, erro);
  }
}

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
  if (regras.has("preco-comercial-nao-autorizado")) return "preco-nao-autorizado";
  if (regras.has("diagnostico-ou-resultado-nao-autorizado")) return "diagnostico-nao-autorizado";
  if (regras.has("garantia-exito-nao-autorizada")) return "exito-nao-autorizado";
  if (regras.has("informalidade-fiscal-nao-autorizada") || regras.has("desconto-acima-limite-sem-aprovacao")) {
    return "risco-fiscal-margem-nao-autorizado";
  }
  if (regras.has("orcamento-tokens")) return "orcamento-excedido";
  if (regras.has("erro-interno-guardrail")) return "erro-execucao";
  return veredito === "bloqueado" ? "guardrail-bloqueio" : "guardrail-revisao";
}

/** Espelha `slaRestanteMs` de `@/lib/humanInTheLoop`. Milissegundos restantes de SLA — negativo quando já violado. */
export function slaRestanteMsAdmin(ticket: HandoffTicket, referencia = new Date()): number {
  return new Date(ticket.slaExpiraEm).getTime() - referencia.getTime();
}

/** Espelha `slaViolado` de `@/lib/humanInTheLoop`. `true` quando o SLA venceu com o ticket ainda em aberto. */
export function slaVioladoAdmin(ticket: HandoffTicket, referencia = new Date()): boolean {
  if (ticket.status === "resolvido" || ticket.status === "cancelado") return false;
  return slaRestanteMsAdmin(ticket, referencia) < 0;
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
  /** Handoff com Resumo Executivo Mastigado — espelha `ConstruirTicketInput` do lado cliente. */
  resumoExecutivo?: ResumoExecutivoHandoff;
  /** Handoff com Resumo Executivo Clínico — espelha `ConstruirTicketInput` do lado cliente. */
  resumoExecutivoClinico?: ResumoExecutivoClinico;
  /** Handoff com Resumo Executivo B2B — espelha `ConstruirTicketInput` do lado cliente. */
  resumoExecutivoB2B?: ResumoExecutivoB2B;
  /** Handoff com Resumo Executivo de Cobrança (AR Recovery Engine) — ver `@/lib/server/arRecoveryEngine`. */
  resumoExecutivoCobranca?: ResumoExecutivoCobranca;
  /** Dossiê de Risco e Prontidão do Motorista SPOT (Fleet & SPOT Driver Onboarding) — ver `@/lib/spotDriverOnboarding`. */
  resumoExecutivoMotoristaSpot?: ResumoExecutivoMotoristaSpot;
  /**
   * Identidade do cliente já correlacionada entre canais (ver "No Invention"
   * em `@/lib/server/episodicMemory`) — usada SOMENTE para o Ghost Coach
   * buscar o histórico episódico do lead (`./ghostCoach`). Não é um campo do
   * ticket em si (não aparece em `HandoffTicket`), só um insumo desta chamada.
   */
  clienteId?: string | null;
  /**
   * Expansão Global (EUA/Portugal): idioma provável do cliente final, para
   * o Ghost Coach escrever o rascunho de resposta nesse idioma (ver
   * `./ghostCoach`). Mesmo caráter de `clienteId`: insumo desta chamada, não
   * um campo do ticket. Quem tem um telefone em claro no momento da
   * ingestão pode inferir isto via `@/lib/jurisdiction` — hoje, nenhum canal
   * real ligado a esta função ainda carrega essa inferência adiante (ver
   * `@/lib/inbox/channelAdapters`, que já a calcula no adaptador Twilio).
   */
  idiomaCliente?: Idioma | null;
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
    ...(entrada.resumoExecutivo ? { resumoExecutivo: entrada.resumoExecutivo } : {}),
    ...(entrada.resumoExecutivoClinico ? { resumoExecutivoClinico: entrada.resumoExecutivoClinico } : {}),
    ...(entrada.resumoExecutivoB2B ? { resumoExecutivoB2B: entrada.resumoExecutivoB2B } : {}),
    ...(entrada.resumoExecutivoCobranca ? { resumoExecutivoCobranca: entrada.resumoExecutivoCobranca } : {}),
    ...(entrada.resumoExecutivoMotoristaSpot ? { resumoExecutivoMotoristaSpot: entrada.resumoExecutivoMotoristaSpot } : {}),
    atribuidoPara: null,
    atribuidoEm: null,
  };
}

/** Persiste o ticket via Admin SDK — bypassa as regras do Firestore por desenho. */
export async function abrirTransbordoAdmin(entrada: ConstruirTicketAdminInput): Promise<HandoffTicket> {
  const ticket = construirTicketAdmin(entrada);
  const refTicket = firestoreAdmin().collection(COLECAO).doc(ticket.id);
  await refTicket.set(ticket);
  await notificarConnectHub(ticket);

  // Motor de Pre-Deal Compliance & Margin Guard: se alguma violação vier do
  // guardrail fiscal/margem, anexa a estimativa de prejuízo evitado ao
  // ticket (badge "Risco Evitado" da Neural Inbox) e sela o evento na
  // trilha de auditoria. Best-effort e nunca bloqueante: o ticket já está
  // seguro em `hitlTickets` — mesmo racional de `notificarConnectHub`.
  const riscoPrevenido = estimarRiscoPrevenido(ticket.violacoes);
  if (riscoPrevenido) {
    try {
      await refTicket.update({ riscoPrevenido });
      ticket.riscoPrevenido = riscoPrevenido;
      await registrarRiscoPrevenidoAdmin({
        workspaceId: ticket.workspaceId,
        ticketId: ticket.id,
        traceId: ticket.traceId,
        risco: riscoPrevenido,
      });
    } catch (erro) {
      console.error(`[margin-guard] falha ao registrar risco prevenido do ticket ${ticket.id}:`, erro);
    }
  }

  // Ghost Coach / Shadow AI: só faz sentido para tickets conversacionais
  // (Neural Inbox, `conversationId` definido) — um ticket de guardrail de
  // fluxo não tem um "lead" do outro lado para sugerir resposta/objeção.
  // Best-effort e nunca bloqueante para o CHAMADOR original: o ticket já foi
  // devolvido ao chamador só depois desta chamada terminar (ver limitação
  // documentada no cabeçalho de `./ghostCoach`), mas uma falha aqui nunca
  // impede o handoff — só o deixa sem o rascunho extra desta vez.
  if (ticket.conversationId) {
    try {
      const sugestao = await gerarSugestaoGhostCoachAdmin({
        workspaceId: ticket.workspaceId,
        payloadMascarado: ticket.payloadMascarado,
        saidaMascarada: ticket.saidaMascarada,
        motivo: ticket.motivo,
        severidade: ticket.severidade,
        clienteId: entrada.clienteId,
        idiomaResposta: entrada.idiomaCliente ?? undefined,
      });
      if (sugestao) {
        await refTicket.update({ ghostCoach: sugestao });
        ticket.ghostCoach = sugestao;
      }
    } catch (erro) {
      console.error(`[ghost-coach] falha ao gerar sugestão para o ticket ${ticket.id}:`, erro);
    }
  }

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
