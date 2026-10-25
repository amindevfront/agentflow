"use client";

// Query cacheada de `workspaces/{id}` (ver `src/lib/queryClient.tsx` para o
// racional de FinOps). Substitui o padrão anterior — repetido em `/flows` e
// `/settings` — de `getWorkspace(id).then(setState)` a cada montagem de
// página, que pagava uma leitura nova do Firestore em toda navegação.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getWorkspace } from "@/lib/firestore";

export function chaveWorkspace(workspaceId: string | null) {
  return ["workspace", workspaceId] as const;
}

export function useWorkspaceDoc(workspaceId: string | null) {
  return useQuery({
    queryKey: chaveWorkspace(workspaceId),
    queryFn: () => getWorkspace(workspaceId as string),
    enabled: Boolean(workspaceId),
  });
}

/**
 * Invalida o cache de um workspace — chamar depois de qualquer escrita bem-
 * sucedida em `workspaces/{id}` (hoje: `updateWorkspaceName`). Sem isso, a
 * própria tela que acabou de salvar mostraria o valor antigo até o
 * `staleTime` expirar.
 */
export function useInvalidarWorkspace() {
  const queryClient = useQueryClient();
  return (workspaceId: string) => queryClient.invalidateQueries({ queryKey: chaveWorkspace(workspaceId) });
}
