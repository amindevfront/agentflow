"use client";

// Provider de cache client-side — FinOps de leituras do Firestore (ver
// ADR-0004).
//
// A maior parte do produto já lê em tempo real via `onSnapshot`
// (`src/lib/firestore.ts`): isso já é eficiente — o Firestore cobra uma vez
// no attach do listener e uma vez por documento que de fato mudar depois,
// não há "refetch" redundante para cortar ali.
//
// O alvo real desta camada são as leituras ONE-SHOT (`getDoc`) de documentos
// que raramente mudam — o caso canônico é `workspaces/{id}`, lido via
// `getWorkspace()` a cada visita a `/flows` (para sugerir playbooks) e a
// `/settings` (para exibir nome/nicho). Sem cache, dez visitas a essas duas
// telas pagavam dez leituras idênticas. Com `staleTime` de 5 minutos e
// `refetchOnWindowFocus: false`, a mesma navegação paga uma leitura só — e
// qualquer escrita própria (ex.: `updateWorkspaceName`) invalida a entrada
// explicitamente (ver `src/lib/queries/workspace.ts`), então o cache nunca
// fica "preso" mostrando um valor que o próprio usuário acabou de mudar.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

const CINCO_MINUTOS_MS = 5 * 60 * 1000;
const TRINTA_MINUTOS_MS = 30 * 60 * 1000;

function criarQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: CINCO_MINUTOS_MS,
        gcTime: TRINTA_MINUTOS_MS,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

export function AppQueryProvider({ children }: { children: ReactNode }) {
  // `useState(criarQueryClient)` garante UMA instância por ciclo de vida do
  // componente (não por render) — recriar o QueryClient a cada render
  // descartaria o cache que ele deveria preservar.
  const [client] = useState(criarQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
