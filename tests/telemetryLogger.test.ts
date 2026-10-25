import { describe, expect, it } from "vitest";
import { formatarRegistro } from "@/lib/telemetry/logger";

describe("formatarRegistro", () => {
  it("monta um registro estruturado com nível, mensagem e timestamp ISO", () => {
    const registro = formatarRegistro("info", "operação concluída");
    expect(registro.nivel).toBe("info");
    expect(registro.mensagem).toBe("operação concluída");
    expect(() => new Date(registro.timestamp).toISOString()).not.toThrow();
  });

  it("inclui contexto e dados quando informados, e os omite quando não", () => {
    const comExtras = formatarRegistro("warn", "falha parcial", {
      contexto: "onboarding",
      dados: { tentativa: 2 },
    });
    expect(comExtras.contexto).toBe("onboarding");
    expect(comExtras.dados).toEqual({ tentativa: 2 });

    const semExtras = formatarRegistro("debug", "apenas debug");
    expect(semExtras.contexto).toBeUndefined();
    expect(semExtras.dados).toBeUndefined();
  });

  it("serializa um Error dentro de `dados` em vez de perder a informação", () => {
    const registro = formatarRegistro("error", "falha de rede", {
      dados: { erro: new Error("timeout") },
    });
    expect(registro.dados?.erro).toMatchObject({ nome: "Error", mensagem: "timeout" });
  });

  it("nunca lança mesmo com dados não serializáveis (referência circular)", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => formatarRegistro("error", "falha", { dados: { circular } })).not.toThrow();
  });
});
