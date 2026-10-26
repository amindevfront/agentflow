"use client";

// Latência de transição de rota — ver ADR-0005 e `performance.ts`.
//
// Mede do MOUNT do componente até o momento em que a página considera os
// próprios dados "prontos" (`pronto === true`) — sinal explícito do
// chamador, não um proxy genérico de paint, porque "pronto" significa coisas
// diferentes por tela (em `/flows`: o primeiro snapshot de fluxos E de
// execuções já chegou; em `/inbox`, por ora, o próprio mount — ver
// `src/app/(app)/inbox/page.tsx`).

import { useEffect, useRef } from "react";
import { logger } from "./logger";

export function useMedirCarregamentoRota(nomeRota: string, pronto = true): void {
  const inicioRef = useRef<number | null>(null);
  if (inicioRef.current === null) inicioRef.current = performance.now();
  const jaRegistrouRef = useRef(false);

  useEffect(() => {
    if (!pronto || jaRegistrouRef.current) return;
    jaRegistrouRef.current = true;
    const duracaoMs = Math.round(performance.now() - (inicioRef.current ?? performance.now()));
    logger.info(`perf:rota:${nomeRota}`, {
      contexto: "performance",
      dados: { rota: nomeRota, duracaoMs },
    });
  }, [pronto, nomeRota]);
}
