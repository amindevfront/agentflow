// Tipos globais compartilhados entre as features do AgentFlow.
// Modelo de dados segue docs/architecture/adr-0001-workspace-model.md:
// toda entidade carrega workspaceId, mesmo operando single-tenant na v1.

// Domínios de governança e métricas ficam em módulos dedicados e são
// re-exportados aqui para que `@/types` continue sendo o ponto único de import.
export * from "./guardrails";
export * from "./governance";
export * from "./roi";
export * from "./inbox";

import type { RunCostMetrics } from "./roi";
import type { GuardrailPolicy } from "./guardrails";

export type UserRole = "operacoes" | "admin";

export interface AppUser {
  uid: string;
  nome: string;
  email: string;
  avatarUrl?: string | null;
  papel: UserRole;
  workspaceId: string;
}

/**
 * Nicho primário do workspace, escolhido na triagem de onboarding
 * (ver `src/lib/niches.ts`). Determina os playbooks sugeridos exibidos
 * no estado vazio de Fluxos — nunca renomeia navegação ou componentes
 * do design system (ver .claude/rules/design-system-compliance.md).
 */
export type NicheKey =
  | "construtora-imobiliaria"
  | "logistica-portuaria"
  | "clinica-alto-padrao"
  | "servicos-luxo"
  | "ecommerce"
  | "outros";

/**
 * Região/idioma da operação, capturada no Onboarding Cognitivo
 * (`DynamicNicheQuizModal`). Determina o regime legal de referência exibido
 * na UI (LGPD vs. CCPA/GDPR) e os valores padrão de moeda/regime de encargos
 * aplicados ao `RoiConfig` do workspace — ver `@/lib/onboardingQuiz`.
 */
export type RegiaoOperacao = "br" | "global";

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
