// Rastreamento de performance — latência de operações críticas (ver
// ADR-0005). Mesmo formato estruturado de `logger.ts` (`contexto:
// "performance"`), para que a mesma ferramenta de observabilidade que já
// ingere erros (Datadog/New Relic/Sentry via log de console JSON) consiga
// filtrar e agregar latência sem precisar de um pipeline separado.
//
// Escopo deliberado: mede operações de resposta única (auth, leitura
// one-shot do Firestore) — não os listeners `onSnapshot` de tempo real.
// "Tempo de resposta" não é um conceito bem definido para um listener que
// fica aberto indefinidamente e dispara de novo a cada mudança; medir só a
// primeira chamada conflaria rede, cache local e "coleção vazia" num único
// número que enganaria mais do que ajudaria.

import { logger } from "./logger";

export type ResultadoOperacao = "sucesso" | "falha";

export interface MedicaoPerformance {
  operacao: string;
  duracaoMs: number;
  resultado: ResultadoOperacao;
}

function registrar(medicao: MedicaoPerformance): void {
  logger.info(`perf:${medicao.operacao}`, { contexto: "performance", dados: { ...medicao } });
}

/**
 * Mede a duração de `fn` e loga estruturado — sucesso ou falha, nunca
 * engolindo o erro original (ele é relançado depois de registrado).
 */
export async function medirDuracao<T>(operacao: string, fn: () => Promise<T>): Promise<T> {
  const inicio = performance.now();
  try {
    const resultado = await fn();
    registrar({ operacao, duracaoMs: Math.round(performance.now() - inicio), resultado: "sucesso" });
    return resultado;
  } catch (erro) {
    registrar({ operacao, duracaoMs: Math.round(performance.now() - inicio), resultado: "falha" });
    throw erro;
  }
}
