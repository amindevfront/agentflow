import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assinarFalhas,
  limparFalha,
  limparTodasFalhas,
  reportarErro,
  type FalhaCapturada,
} from "@/lib/telemetry/errorReporting";

describe("reportarErro / buffer de falhas silenciosas", () => {
  beforeEach(() => {
    limparTodasFalhas();
  });

  it("registra uma falha e a devolve com id e timestamp", () => {
    const falha = reportarErro(new Error("falha de rede"), "neural-inbox");
    expect(falha.mensagem).toBe("falha de rede");
    expect(falha.contexto).toBe("neural-inbox");
    expect(falha.id).toBeTruthy();
  });

  it("aceita string e valores não-Error sem lançar", () => {
    expect(() => reportarErro("algo deu errado")).not.toThrow();
    expect(() => reportarErro({ codigo: 500 })).not.toThrow();
  });

  it("deduplica a mesma falha (mesma mensagem+contexto) dentro da janela de 10s", () => {
    vi.useFakeTimers();
    try {
      const primeira = reportarErro(new Error("timeout"), "onboarding");
      const segunda = reportarErro(new Error("timeout"), "onboarding");
      expect(segunda.id).toBe(primeira.id);

      vi.advanceTimersByTime(11_000);
      const terceira = reportarErro(new Error("timeout"), "onboarding");
      expect(terceira.id).not.toBe(primeira.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falhas com contexto diferente não são deduplicadas entre si", () => {
    const a = reportarErro(new Error("timeout"), "onboarding");
    const b = reportarErro(new Error("timeout"), "neural-inbox");
    expect(a.id).not.toBe(b.id);
  });

  it("assinarFalhas notifica o estado atual imediatamente e a cada mudança", () => {
    const recebidos: number[] = [];
    const cancelar = assinarFalhas((falhas) => recebidos.push(falhas.length));

    reportarErro(new Error("primeira"));
    reportarErro(new Error("segunda"));
    cancelar();
    reportarErro(new Error("terceira"));

    // snapshot inicial (vazio) + duas notificações — a terceira falha ocorre
    // após `cancelar()`, então não deveria gerar uma quarta notificação.
    expect(recebidos).toEqual([0, 1, 2]);
  });

  it("limparFalha remove apenas a entrada indicada", () => {
    const a = reportarErro(new Error("primeira"));
    const b = reportarErro(new Error("segunda"));

    let estadoAtual: FalhaCapturada[] = [];
    const cancelar = assinarFalhas((falhas) => {
      estadoAtual = falhas;
    });

    limparFalha(a.id);
    cancelar();

    expect(estadoAtual.some((f) => f.id === a.id)).toBe(false);
    expect(estadoAtual.some((f) => f.id === b.id)).toBe(true);
  });
});
