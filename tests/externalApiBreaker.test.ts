import { describe, expect, it, vi } from "vitest";
import { DisjuntorChamadaExterna, ErroDisjuntorAberto } from "@/lib/server/externalApiBreaker";

function relogio(inicialMs: number) {
  let atual = inicialMs;
  return { agora: () => atual, avancar: (ms: number) => (atual += ms) };
}

describe("DisjuntorChamadaExterna", () => {
  it("permanece fechado e repassa o resultado enquanto a função sucede", async () => {
    const disjuntor = new DisjuntorChamadaExterna("teste", { limiarFalhas: 3, resfriamentoMs: 1000 });
    const fn = vi.fn().mockResolvedValue("ok");

    await expect(disjuntor.executar(fn)).resolves.toBe("ok");
    expect(disjuntor.estadoAtual()).toBe("fechado");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("abre após atingir o limiar de falhas consecutivas", async () => {
    const disjuntor = new DisjuntorChamadaExterna("teste", { limiarFalhas: 3, resfriamentoMs: 1000 });
    const fn = vi.fn().mockRejectedValue(new Error("falhou"));

    await expect(disjuntor.executar(fn)).rejects.toThrow("falhou");
    expect(disjuntor.estadoAtual()).toBe("fechado");
    await expect(disjuntor.executar(fn)).rejects.toThrow("falhou");
    expect(disjuntor.estadoAtual()).toBe("fechado");
    await expect(disjuntor.executar(fn)).rejects.toThrow("falhou");
    expect(disjuntor.estadoAtual()).toBe("aberto");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("recusa chamadas sem tocar a função enquanto está aberto", async () => {
    const r = relogio(0);
    const disjuntor = new DisjuntorChamadaExterna("teste", { limiarFalhas: 1, resfriamentoMs: 1000 }, r.agora);
    const fn = vi.fn().mockRejectedValue(new Error("falhou"));

    await expect(disjuntor.executar(fn)).rejects.toThrow("falhou");
    expect(disjuntor.estadoAtual()).toBe("aberto");

    fn.mockClear();
    await expect(disjuntor.executar(fn)).rejects.toBeInstanceOf(ErroDisjuntorAberto);
    expect(fn).not.toHaveBeenCalled();
  });

  it("permite uma tentativa em meio-aberto após o resfriamento, e fecha se ela suceder", async () => {
    const r = relogio(0);
    const disjuntor = new DisjuntorChamadaExterna("teste", { limiarFalhas: 1, resfriamentoMs: 1000 }, r.agora);

    await expect(disjuntor.executar(() => Promise.reject(new Error("falhou")))).rejects.toThrow("falhou");
    expect(disjuntor.estadoAtual()).toBe("aberto");

    r.avancar(999);
    expect(disjuntor.estadoAtual()).toBe("aberto");

    r.avancar(1);
    expect(disjuntor.estadoAtual()).toBe("meio-aberto");

    await expect(disjuntor.executar(() => Promise.resolve("recuperou"))).resolves.toBe("recuperou");
    expect(disjuntor.estadoAtual()).toBe("fechado");
  });

  it("reabre e reinicia o resfriamento se a tentativa em meio-aberto falhar", async () => {
    const r = relogio(0);
    const disjuntor = new DisjuntorChamadaExterna("teste", { limiarFalhas: 1, resfriamentoMs: 1000 }, r.agora);

    await expect(disjuntor.executar(() => Promise.reject(new Error("falhou")))).rejects.toThrow("falhou");
    r.avancar(1000);
    expect(disjuntor.estadoAtual()).toBe("meio-aberto");

    await expect(disjuntor.executar(() => Promise.reject(new Error("ainda falhando")))).rejects.toThrow(
      "ainda falhando"
    );
    expect(disjuntor.estadoAtual()).toBe("aberto");

    r.avancar(999);
    expect(disjuntor.estadoAtual()).toBe("aberto");
    r.avancar(1);
    expect(disjuntor.estadoAtual()).toBe("meio-aberto");
  });
});
