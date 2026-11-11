// Tipos globais compartilhados entre as features do AgentFlow.
// Modelo de dados segue docs/architecture/adr-0001-workspace-model.md:
// toda entidade carrega workspaceId, mesmo operando single-tenant na v1.

// Domínios de governança e métricas ficam em módulos dedicados e são
// re-exportados aqui para que `@/types` continue sendo o ponto único de import.
export * from "./guardrails";
export * from "./governance";
export * from "./roi";
export * from "./inbox";
export * from "./sacShield";
export * from "./connectors";
export * from "./backOffice";

import type { RunCostMetrics } from "./roi";
import type { GuardrailPolicy } from "./guardrails";
import type { ConnectHubConfig } from "./connectors";

export type UserRole = "operacoes" | "admin";

export interface AppUser {
  uid: string;
  nome: string;
  email: string;
  avatarUrl?: string | null;
  papel: UserRole;
  workspaceId: string;
  /**
   * Presente apenas na gravação que aceita um convite (ver
   * `src/app/(auth)/invite/[token]/page.tsx`). `firestore.rules` usa este
   * campo para confirmar que `papel`/`workspaceId` vieram de um convite
   * pendente real — nunca escolhidos livremente pelo próprio usuário — e o
   * documento final não precisa retê-lo depois.
   */
  conviteAceitoId?: string;
}

/**
 * Nicho primário do workspace, escolhido na triagem de onboarding
 * (ver `src/lib/niches.ts`). Determina os playbooks sugeridos exibidos
 * no estado vazio de Fluxos — nunca renomeia navegação ou componentes
 * do design system (ver .claude/rules/design-system-compliance.md).
 *
 * Desde a Expansão Full-Scope Enterprise Operations, este tipo é também a
 * CHAVE GERAL do Registro de Módulos (`@/modules/registry`) — cobre tanto
 * verticais de INDÚSTRIA/front-office (ex.: `construtora-imobiliaria`,
 * entram via `Workspace.setor`) quanto gavetas FUNCIONAIS de back-office
 * (ex.: `document-ai-vault`, entram via `Workspace.modulosAtivos` — nunca
 * via `setor`, já que não são um "ramo de negócio"). `obterModulosAtivos`
 * (`@/modules/registry`) é o único ponto que precisa saber dessa distinção;
 * em todo o resto do código, um `NicheKey` continua só "o id de uma gaveta".
 */
export type NicheKey =
  | "construtora-imobiliaria"
  | "logistica-portuaria"
  | "clinica-alto-padrao"
  | "servicos-luxo"
  | "ecommerce"
  | "salao-beleza"
  | "clinica-medica-exames"
  | "advocacia-contabilidade"
  // --- Expansão Enterprise Global (EUA/Flórida e Portugal) ---
  // Empreiteiras/reformas de alto padrão nos EUA (Flórida) — qualificação de
  // leads em USD, follow-up agressivo e estimativa preliminar automatizada.
  | "us-construction-remodeling"
  // Imobiliárias de luxo em Miami/Orlando — triagem de compradores com
  // capacidade financeira validada (proof of funds / pre-approval).
  | "us-real-estate-luxury"
  // Clínicas e centros de saúde em Portugal/Europa — GDPR, agendamento
  // multicanal e redução de faltas. Ver `@/lib/jurisdiction` (`eu-gdpr`).
  | "portugal-clinics-health"
  // --- Full-Scope Enterprise Operations (gavetas de back-office, não um nicho de indústria) ---
  // Gestão inteligente de documentos/contratos: extração de cláusulas
  // críticas, PII Shield e resumo executivo — ver `@/lib/documentAiVault`.
  | "document-ai-vault"
  // Conciliação de planilhas via IA, integrada à Neural Inbox — ver `@/lib/sheetReconciliation`.
  | "sheet-reconciliation"
  // Motor autônomo de cobrança/follow-up de papelada vencida, via HITL — ver `@/lib/server/arRecoveryEngine`.
  | "ar-recovery-engine"
  | "outros";

/**
 * Região/idioma da operação, capturada no Onboarding Cognitivo
 * (`DynamicNicheQuizModal`). Determina o regime legal de referência exibido
 * na UI (LGPD vs. GDPR vs. CCPA) e os valores padrão de moeda/regime de
 * encargos aplicados ao `RoiConfig` do workspace — ver
 * `@/lib/onboardingQuiz`.
 *
 * `"pt"` existe como opção PRÓPRIA (não encaixada em `"global"`) desde a
 * Expansão Enterprise Global: antes disso, escolher a gaveta
 * `portugal-clinics-health` e depois "global" aqui resultava em moeda USD/
 * regime Payroll-US-UK para um workspace português — mismatch real que
 * `regiaoRecomendadaPorSetor` (`@/lib/onboardingQuiz`) agora evita por
 * desenho, sugerindo a região certa a partir do nicho escolhido.
 */
export type RegiaoOperacao = "br" | "pt" | "global";

/**
 * Maior ralo de caixa relatado no Quiz de onboarding — mapeado para ajustes
 * concretos de guardrail em `Workspace.guardrailOverrides` (ver
 * `PAIN_POINT_PRESETS` em `@/lib/onboardingQuiz`). Duas categorias (atrito
 * fora do horário e no-show de agendamento) não têm um módulo dedicado nesta
 * versão — o preset documenta isso explicitamente em vez de fingir cobertura.
 */
export type PainPointKey =
  | "whatsapp-fora-horario"
  | "no-show-agendamento"
  | "passivo-clt-overtime"
  | "vazamento-pii"
  | "outro";

export interface Workspace {
  id: string;
  nome: string;
  /**
   * uid de quem criou este workspace no onboarding self-serve — ver
   * `prepareWorkspace`. `firestore.rules` usa este campo para confirmar que
   * só o próprio criador pode se autodeclarar `admin` deste workspace;
   * qualquer outro acesso de administrador passa por convite, nunca por
   * auto-atribuição de papel.
   */
  donoUid: string;
  setor?: NicheKey;
  criadoEm?: string;
  /** Nomes de fluxo sugeridos para o nicho escolhido (ver NICHE_PRESETS). */
  playbooksSugeridos?: string[];

  // --- Onboarding Cognitivo (Quiz dinâmico de setup por nicho) ---
  regiaoOperacao?: RegiaoOperacao;
  ralogDeCaixa?: PainPointKey;
  /**
   * Ajustes de política de guardrail derivados do ralo de caixa informado no
   * quiz. Mesclado como `sobrescritas` ao resolver a política padrão do
   * workspace (ver `GuardrailInspectorPanel` e `resolverPolitica`).
   */
  guardrailOverrides?: Partial<GuardrailPolicy>;
  /** Presença indica que o quiz já foi respondido — controla a reexibição do modal. */
  quizRespondidoEm?: string;

  /**
   * Registro de Módulos por Workspace (Gavetas) — quais Módulos Verticais
   * (ver `@/modules/registry`) estão ativos neste tenant. `undefined`/vazio:
   * comportamento herdado, só a gaveta de `setor` (se houver) é considerada
   * ativa — nenhum workspace já existente muda de comportamento por este
   * campo existir. Presente: substitui `setor` como fonte de módulos ativos,
   * permitindo mais de uma gaveta ligada ao mesmo tempo (ex.: um workspace
   * que atende tanto Imobiliário quanto Advocacia) sem alterar o core.
   */
  modulosAtivos?: NicheKey[];

  /**
   * AgentFlow Connect Hub — webhook de saída configurado para o workspace.
   * `null`/ausente: Connect Hub desativado, nenhum evento é despachado (ver
   * `@/lib/server/connectors`).
   */
  connectHub?: ConnectHubConfig | null;

  // --- Portal do Cliente (`/portal/[slug]`) ---
  /**
   * Identificador público, url-safe, usado em `/portal/{slug}` — gerado a
   * partir do nome na primeira vez que o Link Único do Cliente é aberto em
   * Fluxos (ver `@/lib/portalSlug`). Ausente = a rota aceita o `workspaceId`
   * bruto como fallback, então o portal nunca fica inacessível por falta de
   * slug.
   */
  slug?: string | null;
  /**
   * Horário de funcionamento do estabelecimento, editável pelo próprio
   * cliente no Portal. Ausente = `EXPEDIENTE_PADRAO` (8h–18h, seg. a sex.) de
   * `@/lib/inbox/revenueRescue` — este workspace ainda não personalizou.
   */
  horarioFuncionamento?: { inicioHora: number; fimHora: number; diasUteis: number[] } | null;
  /**
   * Link principal de conversão exibido no Portal do Cliente — agendamento
   * online (ex.: SalonSoft), WhatsApp do corretor de plantão, confirmação de
   * presença em clínica, etc. O significado exato depende do nicho; o
   * AgentFlow nunca valida o destino, só exibe e copia.
   */
  linkPrincipalConversao?: string | null;
  /** Tabela de preços/serviços em destaque, editável pelo cliente no Portal. */
  servicosDestaque?: Array<{ nome: string; precoBrl: number }>;

  /**
   * Auto-Feedback de Conversão: resumo textual determinístico, derivado dos
   * desfechos (`Conversation.desfechoConversao`) registrados neste nicho —
   * ver `@/lib/inbox/conversionFeedback`. É o "parâmetro contextual do
   * workspace" consumido por `montarPrompt` (`@/lib/server/orchestrator`)
   * nos próximos ciclos do mesmo nicho. `null` quando não há amostra
   * suficiente para gerar contexto.
   */
  insightsConversaoTexto?: string | null;
  insightsConversaoAtualizadoEm?: string | null;
}

export type InviteStatus = "pendente" | "aceito" | "expirado";

export interface Invite {
  id: string;
  email: string;
  workspaceId: string;
  papel: UserRole;
  status: InviteStatus;
  criadoPor: string;
  criadoEm: string;
}

export type RunStatus = "em-execucao" | "concluido" | "falhou" | "ocioso";

export interface FlowStepDef {
  id: string;
  titulo: string;
}

export interface Flow {
  id: string;
  workspaceId: string;
  nome: string;
  gatilho: string;
  origem: string;
  webhookUrl?: string;
  /**
   * Referência ao cofre Zero-Trust (`credentials/{id}`), nunca o segredo em
   * claro. Corrige uma falha real da v1: o campo anterior, `apiToken`,
   * gravava o token diretamente no documento do fluxo — legível por qualquer
   * membro do workspace via `allow read: if belongsToWorkspace(...)` em
   * `firestore.rules`, completamente fora do cofre de credenciais. O valor em
   * claro só existe, hoje, de passagem no formulário e na chamada a
   * `armazenarCredencial`/`rotacionarCredencial` — nunca em um documento.
   */
  apiTokenCredentialId?: string | null;
  steps: FlowStepDef[];
  status: RunStatus;
  atualizadoEm: string;
}

export type StepRunStatus = "concluido" | "em-execucao" | "ociosa" | "falhou";

export interface FlowRunStep {
  id: string;
  titulo: string;
  status: StepRunStatus;
  timestamp?: string;
  duracaoMs?: number;
}

export interface FlowRun {
  id: string;
  workspaceId: string;
  flowId: string;
  flowNome: string;
  status: RunStatus;
  iniciadoEm: string;
  steps: FlowRunStep[];
  /**
   * Telemetria de custo gravada pelo motor de orquestração. Opcional: execuções
   * anteriores a esta versão não possuem o campo e são contabilizadas apenas no
   * volume, nunca nos agregados financeiros (ver `cobertura` em RoiSnapshot).
   */
  metrica?: RunCostMetrics;
}

export type ConnectorStatus = "conectado" | "erro" | "nao-configurado";

export interface Connector {
  id: string;
  workspaceId: string;
  nome: string;
  tipo: string;
  status: ConnectorStatus;
  atualizadoEm: string;
  /**
   * Phone Number ID do WhatsApp Cloud API (Meta for Developers) — só usado
   * quando `tipo` é o conector de WhatsApp. É o identificador interno do
   * Meta, não o número de telefone em si; é o que aparece em
   * `value.metadata.phone_number_id` em todo webhook real, e o que a rota de
   * envio usa para responder pelo número certo.
   */
  metaPhoneNumberId?: string;
  /**
   * Número Twilio (formato E.164, ex.: "+15551234567") — só usado quando
   * `tipo` é o conector "SMS / Twilio Gateway". É o número `To` que a
   * Twilio inclui em TODO webhook de SMS recebido, usado pra resolver qual
   * workspace é dono da mensagem (mesmo papel de `metaPhoneNumberId` pro
   * WhatsApp — ver `resolverConectorPorNumeroTwilio` em `@/lib/server/twilioSmsAdmin`).
   */
  twilioPhoneNumber?: string;
}

export interface TeamMember {
  id: string;
  workspaceId: string;
  nome: string;
  email: string;
  papel: UserRole;
  avatarUrl?: string | null;
}

export interface SimTestResult {
  id: string;
  executadoEm: string;
  payload: string;
  output: string;
  sucesso: boolean;
}
