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

/** `sms` cobre o adaptador Twilio (Canais Globais — EUA/UK/Europa, ver `@/lib/inbox/channelAdapters`). */
export type Canal = "whatsapp" | "webchat" | "instagram" | "facebook" | "email" | "sms";

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

// ---------------------------------------------------------------------------
// Auto-Feedback de Conversão
// ---------------------------------------------------------------------------

/** Desfecho comercial de um atendimento, registrado manualmente pelo operador ao concluí-lo. */
export type ConversionOutcome = "fechado-venda" | "perdido-preco" | "perdido-sem-agenda";

export const ROTULO_DESFECHO_CONVERSAO: Record<ConversionOutcome, string> = {
  "fechado-venda": "Fechado / Venda Concretizada",
  "perdido-preco": "Perdido / Preço",
  "perdido-sem-agenda": "Perdido / Sem Agenda",
};

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
  /** `true` quando o índice cruzou o limiar crítico OU um ticket P1 vinculado estourou o SLA (ver `@/lib/inbox/firestore`). */
  circuitBreakerAtivo: boolean;
  /** Ticket de transbordo (HandoffTicket) aberto quando o circuit breaker disparou. */
  slaTicketId?: string | null;

  /**
   * Identificador de sessão do visitante anônimo do Web Widget Corporativo
   * (gerado e persistido no navegador pelo próprio `widget.js`) — usado para
   * reencontrar a mesma conversa entre mensagens. Deliberadamente NÃO
   * mascarado: é um token aleatório sem significado pessoal por si só (ver
   * `@/lib/server/inboxWidgetAdmin`), diferente de telefone/e-mail.
   */
  widgetVisitorId?: string | null;

  /**
   * Auto-Feedback de Conversão: desfecho comercial registrado pelo operador
   * ao concluir o atendimento. Alimenta `calcularInsightsConversao`
   * (`@/lib/inbox/conversionFeedback`), que por sua vez atualiza
   * `Workspace.insightsConversaoTexto` — o parâmetro contextual consumido por
   * `montarPrompt` nos próximos ciclos do mesmo nicho.
   */
  desfechoConversao?: ConversionOutcome | null;
  desfechoConversaoRegistradoEm?: string | null;

  /**
   * Lead Qualificado de Alto Padrão (nicho Imobiliário/Construtoras):
   * `true` quando sinais de capacidade de investimento E de urgência de
   * compra foram detectados nas mensagens do cliente — ver
   * `@/lib/inbox/highEndLead`. Recalculado junto do índice de frustração.
   */
  leadAltoPadrao?: boolean;
  leadSinaisCapacidade?: string[];
  leadSinaisUrgencia?: string[];

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

/**
 * Origem do conteúdo de uma mensagem — Módulo Multimodal de Elite.
 * `"texto"` (implícito quando o campo está ausente, para compatibilidade com
 * mensagens já persistidas) cobre o caminho de sempre; os outros dois marcam
 * mensagens cujo `texto` é o RESULTADO de um motor real (transcrição de
 * áudio via `@/lib/server/audioTranscriptionAdmin`, ou análise de imagem via
 * `@/lib/server/visionAdmin`) — nunca o dado bruto (áudio/imagem não são
 * persistidos nesta estrutura).
 */
export type TipoConteudoMensagem = "texto" | "audio-transcrito" | "imagem-analisada";

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
   * Quando `tipoConteudo` é `"audio-transcrito"` ou `"imagem-analisada"`,
   * este é o texto já extraído do áudio/imagem pelo motor correspondente —
   * também mascarado antes de chegar aqui, como qualquer outro texto.
   */
  texto: string;
  piiDetectada: string[];
  /** Score de frustração desta mensagem específica (0..100), quando o remetente é o cliente. */
  frustrationScore?: number;
  enviadaEm: string;
  /** `true` quando existe um envelope selado com o texto original, para fins de auditoria/compliance. */
  temVersaoOriginalSelada: boolean;
  /** Ausente = `"texto"`. Ver `TipoConteudoMensagem`. */
  tipoConteudo?: TipoConteudoMensagem;
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

// ---------------------------------------------------------------------------
// Anexos rápidos por nicho (Imobiliário/Construtoras) — memorial descritivo,
// plantas e tabela de disponibilidade. Guardados como LINKS (não upload de
// arquivo): o projeto tem Firebase Storage inicializado, mas sem
// `storage.rules` nem bucket configurado em `firebase.json` — adicionar
// upload real exigiria endurecer essa superfície antes de usá-la. Um
// catálogo de links já resolve "anexo rápido" sem essa dívida de segurança.
// ---------------------------------------------------------------------------

export type NicheAttachmentTipo = "memorial-descritivo" | "planta" | "tabela-disponibilidade" | "outro";

export interface NicheAttachment {
  id: string;
  workspaceId: string;
  nome: string;
  tipo: NicheAttachmentTipo;
  url: string;
  criadoEm: string;
  criadoPor: string;
}

// ---------------------------------------------------------------------------
// Agendamentos — anti-no-show e preparo pré-procedimento (Clínicas)
// ---------------------------------------------------------------------------

export type AppointmentStatus = "agendado" | "confirmado" | "realizado" | "no-show" | "cancelado";

export interface Appointment {
  id: string;
  workspaceId: string;
  /** Conversa da Neural Inbox pela qual a confirmação/preparo são enviados, quando houver. */
  conversationId?: string | null;
  pacienteNome: string;
  procedimento: string;
  /** Data/hora do procedimento, ISO. */
  dataHora: string;
  status: AppointmentStatus;
  /** Instruções de preparo pré-procedimento, enviadas na janela de 24h. */
  diretrizesPreparo?: string;
  confirmacao24hEnviadaEm?: string | null;
  confirmacao2hEnviadaEm?: string | null;
  /**
   * Checagem proativa enviada ~48h depois do procedimento (status
   * "realizado"), perguntando como o paciente está. Captura insatisfação
   * num canal privado ANTES de ela amadurecer numa reclamação pública — ver
   * `calcularCheckInsPosAtendimentoPendentes` em `@/lib/appointments`.
   */
  posAtendimentoEnviadoEm?: string | null;
  /**
   * Instante em que o consentimento informado foi registrado E selado na
   * trilha de auditoria (Blindagem Jurídica de Procedimento). Diferente dos
   * demais campos `*EnviadoEm` deste tipo: isto não é um lembrete enviado, é
   * uma prova jurídica datada — ver `registrarConsentimentoProcedimento` em
   * `@/lib/appointments`.
   */
  termoConsentimentoRegistradoEm?: string | null;
  /** Id da entrada de auditoria correspondente ao registro do consentimento — referência cruzada para o painel de governança. */
  termoConsentimentoAuditEntryId?: string | null;
  criadoEm: string;
  criadoPor: string;
}

// ---------------------------------------------------------------------------
// Rastreio de carga e desvio de SLA (Logística)
// ---------------------------------------------------------------------------

export type ShipmentStatus = "coletado" | "em-transito" | "aduana" | "atrasado" | "entregue";

export interface ShipmentEvent {
  status: ShipmentStatus;
  local?: string;
  ocorridoEm: string;
}

export interface Shipment {
  id: string;
  workspaceId: string;
  /** Código de rastreio informado pelo cliente — chave de busca na triagem da Neural Inbox. */
  codigoRastreio: string;
  origem: string;
  destino: string;
  status: ShipmentStatus;
  /** Prazo de entrega combinado (SLA) — base do cálculo de desvio. */
  previsaoEntrega: string;
  /**
   * Free time contratado com o armador/terminal, em dias, a partir da
   * chegada na aduana. Sem este valor, `calcularRiscoDemurrage`
   * (`@/lib/demurrage`) não estima nada — cada contrato tem um free time
   * diferente, e inventar um padrão universal seria o tipo de número que
   * engana o operador, não ajuda.
   */
  freeTimeDias?: number;
  /** Custo diário de sobre-estadia (demurrage) contratado, em BRL, cobrado por dia excedente ao free time. */
  custoDiarioDemurrageBrl?: number;
  atualizadoEm: string;
  criadoEm: string;
  historico: ShipmentEvent[];
}
