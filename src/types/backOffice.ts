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

// --- Fleet & SPOT Driver Onboarding ---
//
// Gaveta de Back-office para Logística/Transportadoras (Fadel, Comex,
// distribuidoras pesadas): triagem autônoma de motoristas terceirizados
// (SPOT) via WhatsApp/Telegram, com validação determinística da
// documentação obrigatória — mesmo padrão isomórfico/puro de
// `DecisaoArRecovery`/`decidirProximaAcaoCobranca` (`./arRecoveryEngine`
// equivalente para esta gaveta vive em `@/lib/spotDriverOnboarding`).

/** Documentação obrigatória de um motorista SPOT para liberação de frota — ver `DOCUMENTOS_OBRIGATORIOS_SPOT`. */
export type TipoDocumentoMotoristaSpot = "cnh" | "crlv" | "antt" | "comprovante-residencia";

export type StatusDocumentoMotoristaSpot = "pendente" | "recebido" | "valido" | "invalido";

/**
 * Um documento do dossiê — `validadeEm` só é relevante para CNH/ANTT
 * (documentos com data de validade); CRLV/Comprovante de Residência são
 * validados por presença, não por vencimento. `motivoInvalido` nunca é
 * inventado: só é preenchido quando `validarDocumentoMotorista` encontra um
 * motivo concreto (ex.: "CNH vencida há N dias").
 */
export interface DocumentoMotoristaSpot {
  tipo: TipoDocumentoMotoristaSpot;
  status: StatusDocumentoMotoristaSpot;
  validadeEm?: string | null;
  motivoInvalido?: string | null;
  recebidoEm?: string | null;
}

/**
 * Semáforo de prontidão do dossiê — vocabulário do próprio produto
 * ("status verde/vermelho" no Dossiê de Risco e Prontidão da Neural Inbox):
 *  - `vermelho`: ao menos um documento `invalido` (ex.: CNH vencida) —
 *    bloqueio de compliance, nunca libera frota.
 *  - `amarelo`: nenhum documento inválido, mas a triagem ainda não reuniu
 *    toda a documentação obrigatória — em andamento.
 *  - `verde`: toda a documentação obrigatória presente e válida — pronto
 *    para a aprovação humana de 1 clique (`aprovadoEm`/`aprovadoPor`).
 */
export type StatusDossieMotoristaSpot = "verde" | "amarelo" | "vermelho";

/**
 * Dossiê de Risco e Prontidão do motorista SPOT — o que a Neural Inbox
 * exibe para o auxiliar humano revisar em segundos, em vez de conduzir a
 * triagem documento por documento. Persistido em `motoristasSpot/{id}`.
 */
export interface DossieMotoristaSpot {
  id: string;
  workspaceId: string;
  nomeMotorista: string;
  placaVeiculo?: string | null;
  documentos: DocumentoMotoristaSpot[];
  status: StatusDossieMotoristaSpot;
  /** Rótulos legíveis das pendências atuais (documento ausente/inválido) — nunca inventadas, uma por documento problemático. */
  pendencias: string[];
  /** Presente quando a triagem se originou de uma conversa da Neural Inbox (WhatsApp/Telegram). */
  conversationId?: string | null;
  /** Marca que o tick já abriu o ticket HITL para a transição atual de `status` — evita reabrir ticket a cada tick (ver `processarTickSpotDriverOnboardingAdmin`). */
  ticketAbertoEm?: string | null;
  criadoEm: string;
  atualizadoEm: string;
  aprovadoEm?: string | null;
  aprovadoPor?: string | null;
}

/** Decisão do motor autônomo de triagem para um dossiê — ver `decidirProximaAcaoOnboardingSpot`. */
export interface DecisaoOnboardingSpot {
  acao: "aguardar-documentos" | "dossie-pronto-aprovacao" | "escalar-documentacao-irregular";
  motivo: string;
}
