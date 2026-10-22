// Tipos da Neural Inbox: atendimento omnichannel, roteamento cognitivo em
// enxame, radar de frustração/churn e motor de campanhas anti-ban.
//
// Reaproveita deliberadamente o vocabulário de severidade/prioridade já
// estabelecido em `./governance` (HandoffPriority) e o contrato de custo já
// estabelecido em `./roi` (RunCostMetrics) — a Neural Inbox não inventa uma
// segunda linguagem de SLA nem um segundo modelo de telemetria financeira;
// ela se conecta ao que já existe.

import type { HandoffPriority } from "./governance";
import type { RunCostMetrics } from "./roi";

// ---------------------------------------------------------------------------
// Canais e conversas
// ---------------------------------------------------------------------------

export type Canal = "whatsapp" | "webchat" | "instagram" | "facebook" | "email";

export type ConversationStatus =
  | "aberta"
  | "em-atendimento"
  | "aguardando-cliente"
  | "resolvida"
  | "escalada"
  | "arquivada";

export type AssigneeType = "humano" | "agente" | "nenhum";

export type FrustrationTrend = "subindo" | "estavel" | "descendo";

export interface ConversationParticipant {
  nome: string;
  /** Identificador de contato (telefone/handle/e-mail) — SEMPRE mascarado antes de chegar aqui. */
  identificadorMascarado: string;
  avatarUrl?: string | null;
}

/**
 * Resultado de uma decisão de roteamento — persistido junto da conversa para
 * que a explicabilidade ("por que este caso foi para este operador/agente?")
 * sobreviva ao momento da decisão e possa ser auditada depois.
 */
export interface RoutingCandidate {
  tipo: "humano" | "agente";
  id: string;
  nome: string;
  /** Score final (0..1) — maior é melhor. */
  score: number;
  /** Trilha de explicabilidade: cada fator que compôs o score, em português claro. */
  motivos: string[];
}

export interface IntentAnalysis {
  categoria: EspecialidadeAtendimento;
  /** Confiança da classificação (0..1). */
  confianca: number;
  /** Sinais textuais que levaram à classificação — explicabilidade. */
  sinais: string[];
}

export interface RoutingDecision {
  intencao: IntentAnalysis;
  /** Complexidade estimada do caso (0..1). */
  complexidade: number;
  candidatos: RoutingCandidate[];
  escolhido: RoutingCandidate | null;
  decididoEm: string;
}

export interface Conversation {
  id: string;
  workspaceId: string;
  canal: Canal;
  participante: ConversationParticipant;
  assunto: string;
  status: ConversationStatus;
  prioridade: HandoffPriority;

  atribuidoTipo: AssigneeType;
  atribuidoId?: string | null;
  atribuidoNome?: string | null;
  roteamento?: RoutingDecision | null;

  /** Índice de frustração corrente (0..100). Recalculado a cada mensagem do cliente. */
  frustrationIndex: number;
  frustrationTendencia: FrustrationTrend;
  /** `true` quando o índice cruzou o limiar crítico nesta conversa. */
  circuitBreakerAtivo: boolean;
  /** Ticket de transbordo (HandoffTicket) aberto quando o circuit breaker disparou. */
  slaTicketId?: string | null;

  ultimaMensagemPreview: string;
  ultimaMensagemEm: string;
  /** Remetente da última mensagem — usado para medir latência de resposta ao cliente. */
  ultimaMensagemRemetente?: MessageSender;
  criadaEm: string;
  resolvidaEm?: string | null;

  totalMensagens: number;
  totalMensagensCliente: number;
  tempoMedioRespostaSegundos?: number;

  /** Telemetria de custo real de IA usada nesta conversa (triagem, rascunho, sub-agente). */
  metricaIA?: RunCostMetrics;
}

export type MessageSender = "cliente" | "operador" | "agente" | "sistema";

export interface ConversationMessage {
  id: string;
  conversationId: string;
  workspaceId: string;
  canal: Canal;
  remetente: MessageSender;
  remetenteId?: string;
  /**
   * Texto SEMPRE mascarado — nenhuma mensagem com PII em claro chega a esta
   * estrutura depois de passar pelo Shield-Layer (`@/lib/guardrails/piiVault`).
   */
  texto: string;
  piiDetectada: string[];
  /** Score de frustração desta mensagem específica (0..100), quando o remetente é o cliente. */
  frustrationScore?: number;
  enviadaEm: string;
  /** `true` quando existe um envelope selado com o texto original, para fins de auditoria/compliance. */
  temVersaoOriginalSelada: boolean;
}

// ---------------------------------------------------------------------------
// Roteamento cognitivo em enxame (Swarm Routing)
// ---------------------------------------------------------------------------

export type EspecialidadeAtendimento =
  | "financeiro"
  | "tecnico"
  | "comercial"
  | "juridico"
  | "retencao"
  | "geral";

export interface OperatorProfile {
  uid: string;
  workspaceId: string;
  nome: string;
  especialidades: EspecialidadeAtendimento[];
  /** Taxa histórica de resolução sem reabertura (0..1). */
  taxaResolucao: number;
  tempoMedioResolucaoMin: number;
  /** Conversas abertas atribuídas a este operador agora. */
  cargaAtual: number;
  capacidadeMaxima: number;
  disponivel: boolean;
}

export interface AgentProfile {
  id: string;
  workspaceId: string;
  nome: string;
  especialidades: EspecialidadeAtendimento[];
  capacidadeMaxConcorrente: number;
  cargaAtual: number;
  /** Taxa histórica de resolução totalmente automática, sem escalar (0..1). */
  taxaResolucaoAutomatica: number;
  disponivel: boolean;
}

// ---------------------------------------------------------------------------
// Radar preditivo de churn e sentimento
// ---------------------------------------------------------------------------

export interface FrustrationResult {
  indice: number;
  tendencia: FrustrationTrend;
  sinais: string[];
  circuitBreakerAtivado: boolean;
}

export interface ExecutiveBrief {
  resumo: string;
  motivoProvavel: string;
  sinaisDetectados: string[];
  scriptsSugeridos: string[];
  geradoEm: string;
  /** `true` quando gerado por um modelo real; `false` no fallback determinístico. */
  origemIA: boolean;
}

// ---------------------------------------------------------------------------
// Motor de campanhas com anti-ban estocástico
// ---------------------------------------------------------------------------

export type CampaignStatus = "rascunho" | "agendada" | "em-execucao" | "pausada" | "concluida" | "cancelada";

export type RecipientStatus = "pendente" | "enviado" | "falhou" | "bloqueado-optout" | "bloqueado-conformidade";

export interface CampaignRecipient {
  id: string;
  /** Mascarado para exibição — o destino em claro só existe no envio real (fora do Firestore). */
  destinoMascarado: string;
  /** Hash determinístico do destino em claro — usado para checar opt-out sem guardar o valor. */
  destinoHash: string;
  status: RecipientStatus;
  agendadoPara?: string;
  enviadoEm?: string;
  jitterMsAplicado?: number;
  loteIndice?: number;
  motivoBloqueio?: string;
}

export interface JitterConfig {
  /** Atraso mínimo entre envios individuais, em ms. */
  minMs: number;
  /** Atraso máximo entre envios individuais, em ms. */
  maxMs: number;
  /** Tamanho de cada lote antes de uma pausa maior. */
  loteSize: number;
  /** Pausa entre lotes, em ms. */
  pausaEntreLotesMs: number;
  /** Teto de envios por minuto, independente do jitter — defesa redundante. */
  taxaMaximaPorMinuto: number;
}

export const JITTER_CONFIG_PADRAO: JitterConfig = {
  minMs: 2_000,
  maxMs: 9_000,
  loteSize: 20,
  pausaEntreLotesMs: 45_000,
  taxaMaximaPorMinuto: 20,
};

export interface Campaign {
  id: string;
  workspaceId: string;
  nome: string;
  canal: Canal;
  mensagemTemplate: string;
  status: CampaignStatus;
  jitterConfig: JitterConfig;
  totalDestinatarios: number;
  totalEnviados: number;
  totalBloqueados: number;
  totalFalhas: number;
  criadaEm: string;
  criadaPor: string;
  agendadaPara?: string;
  concluidaEm?: string | null;
  /** Telemetria de custo real (ex.: personalização por IA), reaproveitando o contrato de ROI. */
  metrica?: RunCostMetrics;
}

export interface OptOutEntry {
  id: string;
  workspaceId: string;
  /** Hash determinístico do destino — nunca o valor em claro. */
  destinoHash: string;
  canal: Canal;
  registradoEm: string;
  origem: "cliente" | "admin" | "regulatorio";
}

export interface ComplianceCheckResult {
  permitido: boolean;
  motivo?: string;
  destinoHash: string;
}
