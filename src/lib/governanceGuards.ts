// Guia de 4 Passos (Configurações → Fluxo → Sandbox → Governança) — checagem
// cruzada usada por `GovernancePage`: decide se o operador que chegou à
// Governança sem nunca ter passado por Configurações deve ver um aviso
// único guiando de volta, em vez de deixar cada painel (Oportunidade &
// Pipeline, Back-office, etc.) tratar a ausência de `setor` como um erro
// próprio e desconectado.
//
// Extraído da página para ficar testável sem DOM (este projeto não roda
// React Testing Library — ver `tests/copilotoGuiadoFlow.test.ts`) — mesmo
// desenho de `calcularMetricasPipelineVertical` vs. seu wrapper Admin em
// `@/lib/server/roiDashboard`: a decisão pura fica separada do componente.

import type { Workspace } from "@/types";

export interface EstadoWorkspaceParaGuia {
  /** `true` enquanto a gravação otimista do workspace ainda sincroniza com o Firestore (ver `useWorkspace`). */
  pendingSync: boolean;
  /** `true` enquanto a leitura do documento do workspace ainda está em curso. */
  workspaceCarregando: boolean;
  workspace: Pick<Workspace, "setor"> | null | undefined;
}

/**
 * `true` só quando já existe uma resposta DEFINITIVA de que o workspace não
 * tem `setor` configurado — nunca durante sincronização otimista ainda em
 * voo (`pendingSync`) ou enquanto a leitura do documento ainda está em
 * curso, para não confundir "ainda não confirmou" com "nunca configurou"
 * (a causa raiz do bug real: HTTP 500/"Nicho ainda não configurado" mesmo
 * com um Fluxo já criado e salvo).
 */
export function precisaConfigurarNicho({
  pendingSync,
  workspaceCarregando,
  workspace,
}: EstadoWorkspaceParaGuia): boolean {
  if (pendingSync || workspaceCarregando) return false;
  if (workspace === undefined) return false;
  return !workspace?.setor;
}
