// Utilitários puros de resiliência — sem dependência de Firebase/React, para
// que qualquer chamada de rede (Firestore, Auth) possa ser limitada no tempo
// sem travar a UI indefinidamente (ver docs/architecture/adr-0003).

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operação excedeu o limite de ${ms}ms.`);
    this.name = "TimeoutError";
  }
}

/**
 * Corre `promise` contra um relógio: se não resolver/rejeitar em `ms`,
 * rejeita com `TimeoutError`. A promise original continua rodando em
 * segundo plano (não há como cancelar uma Promise nativa) — quem chama
 * `withTimeout` deve tratar esse resultado tardio como irrelevante.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Tenta `fn` até `maxAttempts` vezes, com backoff exponencial (`baseDelayMs *
 * 2^tentativa`) e cada tentativa limitada por `timeoutMs`. Nunca lança — só
 * resolve `{ ok: true, value }` ou `{ ok: false, error }`, para que o
 * chamador sempre tenha um caminho seguro de fallback em vez de um reject
 * inesperado.
 */
export async function retryWithTimeout<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts: number; timeoutMs: number; baseDelayMs: number }
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      const value = await withTimeout(fn(), opts.timeoutMs);
      return { ok: true, value };
    } catch (err) {
      lastError = err;
      if (attempt < opts.maxAttempts - 1) {
        await delay(opts.baseDelayMs * 2 ** attempt);
      }
    }
  }
  return { ok: false, error: lastError };
}
