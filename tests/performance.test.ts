import { describe, expect, it } from "vitest";
import { medirDuracao } from "@/lib/telemetry/performance";

describe("medirDuracao", () => {
  it("devolve o valor de `fn` inalterado em caso de sucesso", async () => {
    const resultado = await medirDuracao("teste.sucesso", async () => "valor-ok");
    expect(resultado).toBe("valor-ok");
  });

  it("relança o erro original em caso de falha, sem engolir nem transformar", async () => {
    const erro = new Error("firestore indisponível");
    await expect(medirDuracao("teste.falha", () => Promise.reject(erro))).rejects.toBe(erro);
  });

  it("mede uma operação assíncrona com duração não-negativa", async () => {
    const inicio = performance.now();
    await medirDuracao("teste.duracao", () => new Promise((resolve) => setTimeout(resolve, 5)));
    expect(performance.now() - inicio).toBeGreaterThanOrEqual(0);
  });
});
