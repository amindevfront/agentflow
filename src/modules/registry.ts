// Registro de Módulos Verticais (Gavetas) — AgentFlow.
//
// Ponto único de verdade sobre quais gavetas existem e qual o módulo ativo
// de um workspace. SERVER-SAFE: nenhuma importação de React, direta ou
// transitiva — pode ser importado por qualquer rota/serviço server-only
// (ex.: `@/lib/server/roiDashboard`) sem puxar componentes de UI para o
// bundle. A UI injetada por módulo vive em `./registry.client`, consumida só
// por componentes "use client" (ex.: `NeuralInbox`) — ver o header daquele
// arquivo para o porquê da separação em dois registros.
//
// Adicionar uma gaveta nova = um diretório em `src/modules/<nicho>/` +
// uma entrada aqui (+ em `./registry.client` se tiver UI de Inbox). Nenhum
// arquivo do core (`@/lib/shared`, `@/lib/guardrails`, `@/lib/server/*`
// genéricos) precisa mudar.

import type { NicheKey, Workspace } from "@/types";
import { NICHE_ORDER } from "@/lib/niches";
import type { VerticalModuleDefinition } from "./types";
import { REAL_ESTATE_MODULE } from "./real-estate";
import { CLINICS_EXAMS_MODULE, CLINICS_MODULE } from "./clinics";
import { LOGISTICS_MODULE } from "./logistics";
import { ECOMMERCE_MODULE } from "./ecommerce";
import { PROFESSIONAL_SERVICES_MODULE } from "./professional-services";
import { US_REAL_ESTATE_LUXURY_MODULE } from "./us-real-estate-luxury";
import { US_CONSTRUCTION_REMODELING_MODULE } from "./us-construction-remodeling";
import { PORTUGAL_CLINICS_HEALTH_MODULE } from "./portugal-clinics-health";
import { DOCUMENT_AI_VAULT_MODULE } from "./document-ai-vault";
import { SHEET_RECONCILIATION_MODULE } from "./sheet-reconciliation";
import { AR_RECOVERY_ENGINE_MODULE } from "./ar-recovery-engine";
import { SPOT_DRIVER_ONBOARDING_MODULE } from "./spot-driver-onboarding";

export const MODULE_REGISTRY: Partial<Record<NicheKey, VerticalModuleDefinition>> = {
  "construtora-imobiliaria": REAL_ESTATE_MODULE,
  "clinica-alto-padrao": CLINICS_MODULE,
  "clinica-medica-exames": CLINICS_EXAMS_MODULE,
  "logistica-portuaria": LOGISTICS_MODULE,
  ecommerce: ECOMMERCE_MODULE,
  "advocacia-contabilidade": PROFESSIONAL_SERVICES_MODULE,
  // --- Expansão Enterprise Global (EUA/Flórida e Portugal) ---
  "us-real-estate-luxury": US_REAL_ESTATE_LUXURY_MODULE,
  "us-construction-remodeling": US_CONSTRUCTION_REMODELING_MODULE,
  "portugal-clinics-health": PORTUGAL_CLINICS_HEALTH_MODULE,
  // --- Full-Scope Enterprise Operations (gavetas de back-office) ---
  "document-ai-vault": DOCUMENT_AI_VAULT_MODULE,
  "sheet-reconciliation": SHEET_RECONCILIATION_MODULE,
  "ar-recovery-engine": AR_RECOVERY_ENGINE_MODULE,
  "spot-driver-onboarding": SPOT_DRIVER_ONBOARDING_MODULE,
};

/** Definição da gaveta registrada para `id`, ou `null` quando o nicho não tem módulo (ex.: `outros`). */
export function obterModulo(id: NicheKey | null | undefined): VerticalModuleDefinition | null {
  if (!id) return null;
  return MODULE_REGISTRY[id] ?? null;
}

/**
 * IDs das gavetas ativas de um workspace.
 *
 * `modulosAtivos` explícito (o toggle multi-módulo do tenant, ver
 * `Workspace.modulosAtivos` em `@/types`) tem prioridade. Sem ele, cai no
 * `setor` único herdado do Onboarding Cognitivo — compatibilidade retroativa
 * total: nenhum workspace já existente muda de comportamento só por esta
 * função existir, porque todos eles só têm `setor`, nunca `modulosAtivos`.
 */
export function obterIdsModulosAtivos(
  workspace: Pick<Workspace, "setor" | "modulosAtivos"> | null | undefined
): NicheKey[] {
  if (!workspace) return [];
  if (workspace.modulosAtivos && workspace.modulosAtivos.length > 0) return workspace.modulosAtivos;
  return workspace.setor ? [workspace.setor] : [];
}

const CHAVES_NICHO_INDUSTRIA = new Set<NicheKey>(NICHE_ORDER);

/**
 * Recalcula `Workspace.modulosAtivos` para uma TROCA de nicho (quiz de
 * onboarding, ou "trocar nicho" em Configurações) — preserva as gavetas de
 * back-office que o tenant já tinha ligado como extra, mas nunca deixa o
 * nicho ANTERIOR sobrevivendo no slot primário.
 *
 * Bug real que isto corrige: `obterIdsModulosAtivos` dá prioridade total a
 * `modulosAtivos` sobre `setor` sempre que ele existe e não está vazio. Como
 * `handleToggleGaveta` (Configurações) grava `modulosAtivos = [setorAtual,
 * ...extras]` ao ligar QUALQUER gaveta extra, e a troca de nicho (antes
 * desta correção) só atualizava `setor` — nunca `modulosAtivos` —, o nicho
 * ANTIGO ficava "orfanizado" como primário em todo consumidor de
 * `obterIdsModulosAtivos` (Neural Inbox, aba Back-office da Governança)
 * mesmo depois do operador confirmar o novo nicho em Configurações.
 */
export function recalcularModulosAtivosParaNovoSetor(
  modulosAtivosAtuais: NicheKey[] | undefined,
  novoSetor: NicheKey
): NicheKey[] {
  const extras = (modulosAtivosAtuais ?? []).filter((id) => !CHAVES_NICHO_INDUSTRIA.has(id));
  return extras.length > 0 ? [novoSetor, ...extras] : [];
}

/** Mesmo que `obterIdsModulosAtivos`, já resolvido em definições (deduplicadas — duas chaves podem apontar para a mesma gaveta, ex. os dois `NicheKey` de Clínicas). */
export function obterModulosAtivos(
  workspace: Pick<Workspace, "setor" | "modulosAtivos"> | null | undefined
): VerticalModuleDefinition[] {
  const vistos = new Set<VerticalModuleDefinition>();
  const resultado: VerticalModuleDefinition[] = [];
  for (const id of obterIdsModulosAtivos(workspace)) {
    const modulo = obterModulo(id);
    if (modulo && !vistos.has(modulo)) {
      vistos.add(modulo);
      resultado.push(modulo);
    }
  }
  return resultado;
}

/**
 * Monta uma tabela `NicheKey → valorMedioPipelineBrl` a partir do registro —
 * fonte derivada (não duplicada) consumida por
 * `VALOR_MEDIO_PIPELINE_PADRAO_BRL` em `@/lib/server/roiDashboard`. Nichos
 * sem gaveta registrada ficam em `0`, nunca inventados.
 */
export function construirTabelaPipelinePadrao(nichos: readonly NicheKey[]): Record<NicheKey, number> {
  const tabela = {} as Record<NicheKey, number>;
  for (const id of nichos) {
    tabela[id] = obterModulo(id)?.valorMedioPipelineBrl ?? 0;
  }
  return tabela;
}
