// Tipos das Gavetas de Back-office — Full-Scope Enterprise Operations.
//
// Três domínios, cada um com sua própria gaveta em `@/modules` e lógica pura
// em `@/lib/documentAiVault` | `@/lib/sheetReconciliation` |
// `@/lib/server/arRecoveryEngine`:
//
//   - Document AI Vault: extração determinística de cláusulas críticas de
//     contratos, sempre sobre texto JÁ MASCARADO pelo Shield-Layer.
//   - Sheet Reconciliation: generalização do padrão já usado por
//     `@/lib/shipments` (triagem de carga por código) para qualquer "tabela
//     operacional" — registros chave→campos, reconciliados a partir da
//     Neural Inbox.
//   - AR Recovery Engine: monitor autônomo de documentos/faturas vencidas,
//     mesmo padrão de "tick" de `@/lib/server/sacShieldHandoffMonitor`.

// --- Document AI Vault ---

/** Tipos de cláusula contratual que o analisador determinístico reconhece. */
export type ClausulaCriticaTipo =
  | "rescisao-unilateral"
  | "renovacao-automatica"
  | "multa-penalidade"
  | "confidencialidade"
  | "nao-concorrencia"
  | "exclusividade"
  | "limitacao-responsabilidade"
  | "foro-jurisdicao";

export interface ClausulaCritica {
  tipo: ClausulaCriticaTipo;
  rotulo: string;
  /** Trecho que disparou a detecção — sempre o texto JÁ MASCARADO, nunca o original. */
  trechoDetectado: string;
  severidade: "baixa" | "media" | "alta";
}

export type StatusDocumentoContrato = "processando" | "analisado" | "erro";

/**
 * Documento/contrato analisado pelo Document AI Vault. `textoMascarado` é
 * SEMPRE o texto após o Shield-Layer (`@/lib/guardrails/piiVault`) — o
 * original em claro nunca é persistido aqui, mesmo princípio de
 * `ConversationMessage.texto` na Neural Inbox.
 */
export interface DocumentoContrato {
  id: string;
  workspaceId: string;
  nomeArquivo: string;
  status: StatusDocumentoContrato;
  textoMascarado: string;
  clausulasCriticas: ClausulaCritica[];
  /** `null` até a análise concluir, ou quando `status === "erro"` — nunca um resumo inventado. */
  resumoExecutivo: string | null;
  criadoEm: string;
  analisadoEm?: string | null;
  criadoPor: string;
}

// --- Sheet Reconciliation ---

/**
 * Uma linha de "tabela operacional" reconciliada via Neural Inbox —
 * generalização chave→campos do mesmo padrão de `Shipment` (`@/types/inbox`
 * re-exports) para qualquer tipo de registro (pedidos, chamados, protocolos),
 * sem precisar de um schema fixo por nicho.
 */
export interface RegistroOperacional {
  id: string;
  workspaceId: string;
  /** Nome da tabela/planilha, ex.: "pedidos", "chamados", "protocolos". */
  tabela: string;
  /** Identificador do registro dentro da tabela, ex.: "PED-1234". */
  chave: string;
  campos: Record<string, string>;
  atualizadoEm: string;
  /** Presente quando a reconciliação se originou de uma conversa da Neural Inbox. */
  origemConversationId?: string | null;
}

/** Atualização candidata extraída de uma mensagem — ainda não aplicada (ver `DiffReconciliacao`). */
export interface AtualizacaoRegistroDetectada {
  tabela: string;
  chave: string;
  camposAtualizados: Record<string, string>;
}

/** Uma diferença entre o registro salvo e a atualização detectada — o operador revisa antes de aplicar. */
export interface DiffReconciliacao {
  campo: string;
  valorAntigo: string | null;
  valorNovo: string;
}

// --- AR Recovery Engine ---

export type StatusDocumentoPendente = "pendente" | "em-cobranca" | "pago" | "cancelado" | "escalado";

/** Fatura/contrato/documento com vencimento monitorado pelo AR Recovery Engine. */
export interface DocumentoPendente {
  id: string;
  workspaceId: string;
  tipo: "fatura" | "contrato" | "documento";
  referencia: string;
  devedorNome: string;
  devedorContato?: string | null;
  valorBrl?: number | null;
  vencimentoEm: string;
  status: StatusDocumentoPendente;
  /** Quantas mensagens de cobrança automatizadas já foram enviadas para este documento. */
  tentativasCobranca: number;
  ultimaCobrancaEm?: string | null;
  criadoEm: string;
}

export type NivelUrgenciaCobranca = "no-prazo" | "atencao" | "atraso" | "critico";

/** Decisão do monitor autônomo para um documento pendente — ver `decidirProximaAcaoCobranca`. */
export interface DecisaoArRecovery {
  acao: "aguardar" | "enviar-cobranca" | "escalar-humano";
  motivo: string;
  nivel: NivelUrgenciaCobranca;
}
