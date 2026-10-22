// Tipos de governança: transbordo humano (HITL), cofre Zero-Trust de
// credenciais e trilha de auditoria imutável.

import type { GuardrailSeverity, GuardrailViolation } from "./guardrails";

// ---------------------------------------------------------------------------
// Transbordo inteligente (Human-in-the-Loop)
// ---------------------------------------------------------------------------

export type HandoffReason =
  | "guardrail-bloqueio"
  | "guardrail-revisao"
  | "pii-sensivel"
  | "baixa-consistencia"
  | "sem-fundamentacao"
  | "loop-detectado"
  | "orcamento-excedido"
  | "erro-execucao"
  | "solicitacao-manual"
  /** Radar de sentimento da Neural Inbox: índice de frustração cruzou o limiar crítico. */
  | "frustracao-critica";

export type HandoffStatus = "aberto" | "em-analise" | "resolvido" | "expirado" | "cancelado";

export type HandoffDecision = "aprovado" | "rejeitado" | "editado" | "escalado";

/** P1 = incidente crítico (SLA mais curto), P4 = revisão informativa. */
export type HandoffPriority = "p1" | "p2" | "p3" | "p4";

export interface HandoffTicket {
  id: string;
  workspaceId: string;
  /**
   * "O que está sendo escalado". Para tickets originados de um fluxo, é o
   * `Flow.id`. Para tickets originados da Neural Inbox (radar de frustração),
   * é o `Conversation.id` — ver `conversationId` abaixo para o campo
   * explicitamente tipado, mantido em paralelo por clareza de leitura na UI.
   */
  flowId: string;
  flowNome: string;
  runId?: string;
  nodeId?: string;
  /** Presente apenas em tickets originados da Neural Inbox. */
  conversationId?: string;
  /** Correlaciona ticket ↔ inspeção de guardrail ↔ entrada de auditoria. */
  traceId: string;

  motivo: HandoffReason;
  status: HandoffStatus;
  prioridade: HandoffPriority;
  severidade: GuardrailSeverity;
  violacoes: GuardrailViolation[];

  /**
   * Snapshot do payload e da saída — SEMPRE mascarados.
   * O operador revisa a decisão, não o dado pessoal (minimização, LGPD art. 6º V).
   */
  payloadMascarado: string;
  saidaMascarada?: string;

  criadoEm: string;
  criadoPor: string;
  slaExpiraEm: string;

  atribuidoPara?: string | null;
  atribuidoEm?: string | null;

  decisao?: HandoffDecision;
  decididoPor?: string;
  decididoEm?: string;
  justificativa?: string;
  /** Saída corrigida pelo operador quando a decisão é `editado`. */
  saidaCorrigida?: string;
}

export interface HandoffQueueStats {
  total: number;
  abertos: number;
  emAnalise: number;
  resolvidos: number;
  expirados: number;
  emViolacaoDeSla: number;
  porPrioridade: Record<HandoffPriority, number>;
  /** Tempo médio de resolução em minutos (apenas tickets resolvidos). */
  tempoMedioResolucaoMin: number | null;
}

// ---------------------------------------------------------------------------
// Cofre Zero-Trust de credenciais
// ---------------------------------------------------------------------------

export type CredentialStatus = "ativa" | "revogada" | "expirada";

export type CredentialKind =
  | "api-key"
  | "bearer-token"
  | "oauth-refresh-token"
  | "webhook-secret"
  | "basic-auth"
  | "chave-privada";

/**
 * Segredo selado por envelope encryption (AES-256-GCM).
 * Persistido em `credentialSecrets/{id}` — coleção que NENHUM cliente pode ler
 * (ver `firestore.rules`). Sem a KEK, que vive apenas no servidor, é inerte.
 */
export interface SealedSecret {
  algoritmo: "AES-256-GCM";
  /** Versão da KEK usada — permite rotação de chave-mestra sem perder histórico. */
  versaoChave: string;
  /** IV do ciphertext, em base64url. */
  iv: string;
  /** Segredo cifrado pela DEK, em base64url. */
  ciphertext: string;
  /** DEK cifrada pela KEK (envelope), em base64url. */
  dekEnvelopada: string;
  /** IV usado para envelopar a DEK, em base64url. */
  ivDek: string;
  /** Dados autenticados adicionais em claro — vinculam o envelope ao seu dono. */
  aad: string;
  /** SHA-256 do plaintext, truncado. Detecta reuso/rotação sem revelar o valor. */
  fingerprint: string;
  seladoEm: string;
}

/** Metadados legíveis pelo workspace. Nunca contém o segredo. */
export interface CredentialMetadata {
  id: string;
  workspaceId: string;
  nome: string;
  tipo: CredentialKind;
  conectorId?: string | null;
  status: CredentialStatus;
  /** Versão corrente; cada rotação incrementa e cria um novo doc de segredo. */
  versao: number;
  /** Últimos caracteres do segredo, para conferência visual. */
  sufixo: string;
  fingerprint: string;
  criadoEm: string;
  criadoPor: string;
  atualizadoEm: string;
  expiraEm?: string | null;
  revogadoEm?: string | null;
  revogadoPor?: string | null;
  ultimoUsoEm?: string | null;
}

// ---------------------------------------------------------------------------
// Trilha de auditoria imutável
// ---------------------------------------------------------------------------

export type AuditEventType =
  | "guardrail.entrada.mascarada"
  | "guardrail.entrada.bloqueada"
  | "guardrail.saida.bloqueada"
  | "guardrail.transbordo.acionado"
  | "hitl.ticket.aberto"
  | "hitl.ticket.assumido"
  | "hitl.ticket.resolvido"
  | "hitl.ticket.expirado"
  | "credencial.criada"
  | "credencial.rotacionada"
  | "credencial.revogada"
  | "credencial.acessada"
  | "config.alterada"
  | "auth.sessao.iniciada"
  | "auth.sessao.encerrada";

export type AuditOutcome = "sucesso" | "falha" | "negado";

/** Conteúdo semântico da entrada — o que é hasheado e assinado. */
export interface AuditEventBody {
  tipo: AuditEventType;
  resultado: AuditOutcome;
  workspaceId: string;
  /** UID do ator. `sistema` para ações automáticas do motor. */
  ator: string;
  atorEmail?: string;
  /** Recurso afetado, no formato `colecao/id`. */
  recurso: string;
  traceId?: string;
  severidade?: GuardrailSeverity;
  /** Detalhes não sensíveis (contadores, vereditos, ids). Validado antes de selar. */
  detalhes: Record<string, string | number | boolean | null>;
  /**
   * Detalhes sensíveis cifrados em repouso (AES-256-GCM, mesma KEK do cofre).
   * Só é decifrável server-side, sob investigação autorizada.
   */
  detalhesCifrados?: SealedSecret | null;
  ocorridoEm: string;
}

/**
 * Entrada de auditoria selada e encadeada.
 *
 * Imutabilidade é garantida em três camadas:
 *  1. `firestore.rules` nega `update` e `delete` na coleção;
 *  2. o id do documento é derivado de `seq`, então reescrever uma posição é um
 *     `update` — negado pelas rules;
 *  3. `chainHash` encadeia a entrada à anterior e `assinatura` (HMAC-SHA-256
 *     com chave que só existe no servidor) impede forja por um cliente.
 */
export interface AuditEntry {
  id: string;
  workspaceId: string;
  /** Posição na cadeia, iniciando em 1. */
  seq: number;
  corpo: AuditEventBody;
  /** SHA-256 do corpo em JSON canônico. */
  contentHash: string;
  /** `chainHash` da entrada anterior; string vazia na primeira (genesis). */
  prevHash: string;
  /** SHA-256(prevHash + contentHash) — torna qualquer alteração detectável. */
  chainHash: string;
  /** HMAC-SHA-256(chainHash) com a chave de auditoria do servidor. */
  assinatura: string;
  versaoSelo: string;
  seladoEm: string;
}

export type AuditChainProblem =
  | "hash-conteudo-divergente"
  | "encadeamento-rompido"
  | "assinatura-invalida"
  | "sequencia-fora-de-ordem"
  | "sequencia-duplicada"
  | "genesis-invalida";

export interface AuditChainIssue {
  seq: number;
  entryId: string;
  problema: AuditChainProblem;
  detalhe: string;
}

export interface AuditChainVerification {
  integra: boolean;
  entradasVerificadas: number;
  /** `true` quando o HMAC também foi conferido (só possível no servidor). */
  assinaturasVerificadas: boolean;
  problemas: AuditChainIssue[];
  verificadoEm: string;
}
