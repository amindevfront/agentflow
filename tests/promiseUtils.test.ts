import { describe, expect, it, vi } from "vitest";
import { TimeoutError, delay, retryWithTimeout, withTimeout } from "@/lib/promiseUtils";

describe("withTimeout", () => {
  it("resolve normalmente quando a promise termina antes do limite", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 50)).resolves.toBe("ok");
  });

  it("rejeita com TimeoutError quando a promise demora além do limite", async () => {
    const nuncaResolve = new Promise(() => {});
    await expect(withTimeout(nuncaResolve, 20)).rejects.toBeInstanceOf(TimeoutError);
  });

  it("propaga a rejeição original quando a promise falha antes do timeout", async () => {
    await expect(withTimeout(Promise.reject(new Error("falhou")), 50)).rejects.toThrow("falhou");
  });
});

describe("retryWithTimeout", () => {
  it("retorna ok na primeira tentativa quando a função sucede", async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const result = await retryWithTimeout(fn, { maxAttempts: 3, timeoutMs: 50, baseDelayMs: 1 });
    expect(result).toEqual({ ok: true, value: 42 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("tenta novamente após falha e eventualmente sucede", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("tentativa 1"))
      .mockResolvedValueOnce("sucesso");
    const result = await retryWithTimeout(fn, { maxAttempts: 3, timeoutMs: 50, baseDelayMs: 1 });
    expect(result).toEqual({ ok: true, value: "sucesso" });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("nunca lança — esgota as tentativas e retorna ok:false com o último erro", async () => {
    const erroFinal = new Error("sempre falha");
    const fn = vi.fn().mockRejectedValue(erroFinal);
    const result = await retryWithTimeout(fn, { maxAttempts: 3, timeoutMs: 50, baseDelayMs: 1 });
    expect(result.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(3);
    if (!result.ok) expect(result.error).toBe(erroFinal);
  });

  it("limita cada tentativa individualmente pelo timeout", async () => {
    const fn = vi.fn().mockImplementation(() => new Promise(() => {}));
    const result = await retryWithTimeout(fn, { maxAttempts: 2, timeoutMs: 10, baseDelayMs: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(TimeoutError);
  });
});

describe("delay", () => {
  it("resolve depois do tempo informado", async () => {
    const inicio = Date.now();
    await delay(15);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(10);
  });
});
