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
  | "frustracao-critica"
  /** Compliance Preventivo: mensagem de operador/IA com risco de passivo trabalhista ou propaganda enganosa. */
  | "compliance-preventivo"
  /**
   * Proteção de Caixa (Módulo Vertical: Construtoras/Imobiliárias de Alto
   * Padrão): a IA tentou abrir valor de tabela exato, desconto ou condição
   * de parcelamento sem validação prévia da diretoria — ver
   * `preco-comercial-nao-autorizado` em `GuardrailRuleId`.
   */
  | "preco-nao-autorizado"
  /**
   * Handoff com Resumo Executivo Mastigado (Módulo Vertical: Construtoras/
   * Imobiliárias de Alto Padrão): o lead pediu para agendar uma visita
   * presencial — ticket carrega `resumoExecutivo` para o corretor não
   * repetir perguntas já respondidas.
   */
  | "agendamento-visita-presencial"
  /**
   * Guardrail Clínico/Ético (Módulo Vertical: Clínicas de Saúde, Estética
   * Avançada & Especialistas de Alto Padrão): a IA afirmou um diagnóstico ou
   * prometeu/garantiu um resultado estético sem avaliação presencial — ver
   * `diagnostico-ou-resultado-nao-autorizado` em `GuardrailRuleId`.
   */
  | "diagnostico-nao-autorizado"
  /**
   * Handoff com Resumo Executivo Clínico (Módulo Vertical: Clínicas de
   * Saúde, Estética Avançada & Especialistas de Alto Padrão): o paciente
   * confirmou o agendamento da avaliação/consulta — ticket carrega
   * `resumoExecutivoClinico` para a equipe não repetir perguntas já
   * respondidas.
   */
  | "confirmacao-agendamento-clinico"
  /**
   * Guardrail Ético-Profissional (Módulo Vertical: Advocacia, Contabilidade
   * & Serviços B2B): a IA garantiu resultado de processo/causa ou prometeu
   * prazo judicial sem análise técnica prévia — ver
   * `garantia-exito-nao-autorizada` em `GuardrailRuleId`.
   */
  | "exito-nao-autorizado"
  /**
   * Handoff com Resumo Executivo B2B (Módulo Vertical: Advocacia,
   * Contabilidade & Serviços B2B): o lead confirmou a reunião de
   * diagnóstico — ticket carrega `resumoExecutivoB2B` para a equipe de
   * sócios não repetir perguntas já respondidas.
   */
  | "confirmacao-reuniao-diagnostico-b2b"
  /**
   * AR Recovery Engine (Gaveta de Back-office): o agente autônomo de
   * cobrança (`@/lib/server/arRecoveryEngine`) esgotou as tentativas
   * automáticas de follow-up humanizado sem resolução — diferente dos
   * motivos de agendamento acima (gatilho positivo), este é um
   * ESCALONAMENTO: algo precisa de decisão humana (disputa do devedor,
   * inadimplência persistente, exceção a avaliar). Ticket carrega
   * `resumoExecutivoCobranca`.
   */
  | "cobranca-documento-pendente";

export type HandoffStatus = "aberto" | "em-analise" | "resolvido" | "expirado" | "cancelado";

export type HandoffDecision = "aprovado" | "rejeitado" | "editado" | "escalado";

/** P1 = incidente crítico (SLA mais curto), P4 = revisão informativa. */
export type HandoffPriority = "p1" | "p2" | "p3" | "p4";

/**
 * Handoff com Resumo Executivo Mastigado (Módulo Vertical: Construtoras/
 * Imobiliárias de Alto Padrão) — card pronto para o corretor humano assumir
 * a conversa sem repetir perguntas já respondidas pelo lead. Todo campo é
 * opcional e `null`/ausente quando o dado não pôde ser identificado na
 * conversa: um card incompleto é preferível a um campo inventado (Artigo IV
 * — No Invention).
 *
 * `faixaOrcamento` é deliberadamente uma FAIXA em texto livre extraída de
 * menções por extenso ("até 800 mil", "entre 1 e 1,5 milhão"), nunca o valor
 * exato que o PiiVault já mascara antes de qualquer persistência — ver
 * `@/lib/server/imobiliarioAltoPadrao`.
 */
export interface ResumoExecutivoHandoff {
  nome?: string | null;
  faixaOrcamento?: string | null;
  imovelInteresse?: string | null;
  objecaoMapeada?: string | null;
}

/**
 * Handoff com Resumo Executivo Clínico (Módulo Vertical: Clínicas de Saúde,
 * Estética Avançada & Especialistas de Alto Padrão) — card pronto para a
 * equipe assumir a consulta/avaliação sem repetir perguntas já respondidas
 * pelo paciente. Mesmo princípio de `ResumoExecutivoHandoff` (campo ausente
 * fica `null`/ausente, nunca inventado — Artigo IV), com campos próprios do
 * contexto clínico em vez dos campos de orçamento/imóvel do Vertical 1 —
 * ver `@/lib/server/clinicaAltoPadrao`.
 */
export interface ResumoExecutivoClinico {
  nome?: string | null;
  queixaPrincipal?: string | null;
  historicoResumido?: string | null;
  objecaoMapeada?: string | null;
}

/**
 * Handoff com Resumo Executivo B2B (Módulo Vertical: Advocacia,
 * Contabilidade & Serviços B2B) — card pronto para a equipe de sócios
 * assumir a reunião de diagnóstico sem repetir perguntas já respondidas
 * pelo lead. Mesmo princípio dos outros `ResumoExecutivo*` (campo ausente
 * fica `null`/ausente, nunca inventado — Artigo IV), com campos próprios do
 * contexto B2B — ver `@/lib/server/advocaciaContabilidadeB2B`.
 */
export interface ResumoExecutivoB2B {
  nome?: string | null;
  /** "Pessoa física" ou "Pessoa jurídica" — nunca inferido, só quando o próprio lead informou. */
  perfilLead?: string | null;
  /** Porte aproximado do caso/empresa, em categoria (ex.: "pequena empresa", "startup") — nunca valor exato. */
  porteCaso?: string | null;
  objetivoMapeado?: string | null;
}

/**
 * Handoff com Resumo Executivo de Cobrança (Gaveta de Back-office: AR
 * Recovery Engine) — card pronto para o operador de cobrança assumir o
 * caso sem precisar reconstruir o histórico de tentativas. Mesmo princípio
 * dos outros `ResumoExecutivo*` (campo ausente fica `null`/ausente, nunca
 * inventado — Artigo IV) — ver `@/lib/server/arRecoveryEngine`.
 */
export interface ResumoExecutivoCobranca {
  devedorNome?: string | null;
  referenciaDocumento?: string | null;
  diasAtraso?: number | null;
  tentativasAnteriores?: number | null;
  /** Faixa por extenso, nunca o valor exato em claro — mesmo princípio de `ResumoExecutivoHandoff.faixaOrcamento`. */
  faixaValor?: string | null;
}

/**
 * Ghost Coach / Shadow AI — sugestão silenciosa gerada para o operador
 * humano que vai assumir o ticket, baseada no histórico episódico do lead
 * (`@/lib/server/episodicMemory`) quando disponível. Nunca enviada
 * automaticamente ao cliente — é um rascunho para o operador revisar,
 * editar ou ignorar, mesmo espírito de `payloadMascarado`/`saidaMascarada`
 * (o operador decide, a IA só instrumenta a decisão). Gerada best-effort:
 * ausência deste campo no ticket significa apenas que a sugestão não pôde
 * ser gerada (Anthropic indisponível, disjuntor aberto, etc.) — nunca um
 * erro que bloqueia o handoff em si.
 */
export interface SugestaoGhostCoach {
  /** Rascunho de resposta sugerido — sempre já mascarado (Shield-Layer). */
  respostaSugerida: string;
  /** Argumento sugerido para a objeção mais provável, a partir do histórico — sempre já mascarado. */
  argumentoObjecao: string;
  /** `true` quando a sugestão usou o resumo unificado cross-channel do lead, não só o payload deste ticket. */
  baseadoEmHistoricoEpisodico: boolean;
  geradoEm: string;
}

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

  /** Presente apenas em tickets de `motivo: "agendamento-visita-presencial"` — ver `ResumoExecutivoHandoff`. */
  resumoExecutivo?: ResumoExecutivoHandoff;
  /** Presente apenas em tickets de `motivo: "confirmacao-agendamento-clinico"` — ver `ResumoExecutivoClinico`. */
  resumoExecutivoClinico?: ResumoExecutivoClinico;
  /** Presente apenas em tickets de `motivo: "confirmacao-reuniao-diagnostico-b2b"` — ver `ResumoExecutivoB2B`. */
  resumoExecutivoB2B?: ResumoExecutivoB2B;
  /** Presente apenas em tickets de `motivo: "cobranca-documento-pendente"` — ver `ResumoExecutivoCobranca`. */
  resumoExecutivoCobranca?: ResumoExecutivoCobranca;
  /** Presente apenas em tickets originados da Neural Inbox (`conversationId` definido) — ver `SugestaoGhostCoach`. */
  ghostCoach?: SugestaoGhostCoach;
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
  | "auth.sessao.encerrada"
  /** Download do Relatório Executivo (PDF) — o selo resultante é embutido no próprio PDF como atestado de segurança. */
  | "relatorio.executivo.gerado"
  /**
   * Blindagem Jurídica de Procedimento (nicho Clínicas): registro do termo de
   * consentimento informado, selado na mesma cadeia à prova de adulteração
   * do resto da auditoria — prova datada e verificável de que o paciente foi
   * informado antes do procedimento, exatamente o que cortes brasileiras
   * citam como ausente nos casos de condenação por erro estético.
   */
  | "procedimento.consentimento.registrado"
  /** Checagem pós-atendimento (48h) efetivamente enviada — prova de acompanhamento pós-operatório, mesmo racional acima. */
  | "procedimento.posatendimento.registrado"
  /** Download do Relatório de Prontidão para Regulação de IA (EU AI Act, PDF) — mesmo racional do atestado do Relatório Executivo. */
  | "relatorio.prontidao.gerado"
  /** Download do Relatório de Prontidão para Regulação Brasileira (LGPD, PDF) — mesmo racional do atestado do Relatório Executivo. */
  | "relatorio.lgpd.gerado"
  /**
   * SAC Shield: fallback seguro acionado porque um transbordo humano
   * vinculado a uma conversa real estourou a janela legal de atendimento
   * (ex.: Decreto do SAC) sem decisão de um operador — ver
   * `@/lib/server/sacShieldHandoffMonitor`.
   */
  | "sacshield.handoff.fallback-acionado"
  /** SAC Shield: disparo a um canal de mensageria contido (enfileirado) por risco de banimento — ver `@/lib/server/channelReputationShieldAdmin`. */
  | "sacshield.canal.disparo-contido"
  /** SAC Shield: disjuntor de um canal externo de mensageria abriu — conexão instável isolada. */
  | "sacshield.canal.disjuntor-aberto"
  /** SAC Shield: Pacote de Evidência de Conformidade exportado para auditoria corporativa. */
  | "sacshield.evidencia.pacote-gerado"
  /**
   * AgentFlow Connect Hub: evento despachado (ou enfileirado para retry) ao
   * webhook de saída do workspace — ver `@/lib/server/connectors`. Todo
   * egresso de dados a um sistema de terceiros é auditado, mesmo quando o
   * payload já está mascarado (rastreabilidade LGPD de ponta a ponta).
   */
  | "connecthub.webhook.despachado"
  /**
   * Ação "Resetar ambiente de testes" (Configurações → Zona de risco):
   * apagou todas as conversas e fluxos de teste do workspace antes do
   * go-live com um cliente real — ver `@/lib/server/testEnvironmentResetAdmin`.
   * Gerado SEMPRE que a ação roda (não há "resultado negado" silencioso):
   * é o próprio registro de que o reset aconteceu, quem pediu e quando —
   * a cadeia de confiança da auditoria não pode ter um buraco exatamente no
   * momento em que o ambiente de testes é zerado.
   */
  | "ambiente.teste.resetado"
  /**
   * Remoção de um membro da equipe (Configurações → Equipe, exclusivo de
   * admin) — ver `@/lib/server/teamAdmin`. Apaga `users/{uid}` do removido
   * via Admin SDK (as regras do Firestore negam esse delete a qualquer
   * cliente, de propósito — só um admin autorizado nesta rota consegue).
   */
  | "equipe.membro.removido"
  /** Revogação de um convite ainda pendente (Configurações → Equipe) — ver `@/lib/server/teamAdmin`. */
  | "equipe.convite.revogado"
  /**
   * Exclusão de um fluxo individual (lixeira em Fluxos). Diferente do reset
   * de ambiente, esta é uma escrita direta do CLIENTE (`firestore.rules` já
   * permite `write` em `flows/{id}` para qualquer membro do workspace) — o
   * selo de auditoria é gerado À PARTE, via `/api/audit/seal`
   * (`registrarEventoAuditoriaSilencioso`), para que toda exclusão no
   * sistema passe pela mesma trilha verificável, não só as que já exigiam
   * uma rota admin dedicada.
   */
  | "fluxo.excluido"
  /** Exclusão de um conector (lixeira em Canais & Integrações) — mesmo raciocínio de `fluxo.excluido`. */
  | "conector.excluido"
  /**
   * Desfecho comercial de uma conversa registrado na Neural Inbox (ex.:
   * "Fechado / Venda Concretizada") — ver `registrarDesfechoConversao` em
   * `@/lib/inbox/firestore`. Bug real corrigido aqui: esta ação usava
   * indevidamente o tipo `config.alterada` (nenhuma configuração do
   * workspace muda quando um operador marca o desfecho de UM atendimento),
   * o que fazia a trilha de Auditoria mostrar "Configuração alterada" para
   * cada venda/perda fechada — confuso para o dono do negócio revisando a
   * tela de Governança, que lê isso como alguém mexendo nos parâmetros do
   * sistema.
   */
  | "conversa.desfecho.registrado"
  /**
   * Download do Relatório de Prontidão Internacional (GDPR ou Privacidade
   * EUA) — `@/components/governance/GlobalComplianceReadinessPanel`. Tipo
   * PRÓPRIO, nunca reaproveita `relatorio.lgpd.gerado` (regime diferente —
   * mesma lição do bug de `conversa.desfecho.registrado` acima).
   */
  | "relatorio.compliance-global.gerado";

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
