import { describe, expect, it } from "vitest";
import type { Shipment } from "@/types";
import { buscarCargaPorCodigo, calcularDesvioSla, extrairCodigoRastreio } from "@/lib/shipments";

const AGORA = new Date(2026, 0, 10, 12, 0, 0);

function criarCarga(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: "ship_1",
    workspaceId: "default",
    codigoRastreio: "BRX-004521",
    origem: "São Paulo",
    destino: "Recife",
    status: "em-transito",
    previsaoEntrega: AGORA.toISOString(),
    atualizadoEm: AGORA.toISOString(),
    criadoEm: AGORA.toISOString(),
    historico: [{ status: "coletado", ocorridoEm: AGORA.toISOString() }],
    ...overrides,
  };
}

describe("calcularDesvioSla", () => {
  it("dentro do SLA quando a previsão ainda não passou", () => {
    const previsao = new Date(AGORA.getTime() + 5 * 60 * 60 * 1000).toISOString();
    const resultado = calcularDesvioSla(criarCarga({ previsaoEntrega: previsao }), AGORA);
    expect(resultado.emAtraso).toBe(false);
    expect(resultado.horasDesvio).toBe(0);
    expect(resultado.severidade).toBe("nenhum");
  });

  it("severidade baixa para atraso pequeno (abaixo de 6h)", () => {
    const previsao = new Date(AGORA.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const resultado = calcularDesvioSla(criarCarga({ previsaoEntrega: previsao }), AGORA);
    expect(resultado.emAtraso).toBe(true);
    expect(resultado.horasDesvio).toBeCloseTo(2, 1);
    expect(resultado.severidade).toBe("baixa");
  });

  it("severidade média para atraso entre 6h e 24h", () => {
    const previsao = new Date(AGORA.getTime() - 10 * 60 * 60 * 1000).toISOString();
    const resultado = calcularDesvioSla(criarCarga({ previsaoEntrega: previsao }), AGORA);
    expect(resultado.severidade).toBe("media");
  });

  it("severidade alta para atraso de 24h ou mais", () => {
    const previsao = new Date(AGORA.getTime() - 30 * 60 * 60 * 1000).toISOString();
    const resultado = calcularDesvioSla(criarCarga({ previsaoEntrega: previsao }), AGORA);
    expect(resultado.severidade).toBe("alta");
  });

  it("carga entregue: congela o desvio no instante do último evento, não na referência atual", () => {
    const previsao = new Date(AGORA.getTime() - 5 * 60 * 60 * 1000).toISOString();
    const entregueEm = new Date(AGORA.getTime() - 4 * 60 * 60 * 1000).toISOString();
    const carga = criarCarga({
      status: "entregue",
      previsaoEntrega: previsao,
      historico: [
        { status: "coletado", ocorridoEm: new Date(AGORA.getTime() - 20 * 60 * 60 * 1000).toISOString() },
        { status: "entregue", ocorridoEm: entregueEm },
      ],
    });
    // Referência bem mais tarde não deveria inflar o desvio de uma carga já entregue.
    const referenciaBemDepois = new Date(AGORA.getTime() + 48 * 60 * 60 * 1000);
    const resultado = calcularDesvioSla(carga, referenciaBemDepois);
    expect(resultado.horasDesvio).toBeCloseTo(1, 1);
  });

  it("nunca produz horasDesvio negativo", () => {
    const previsao = new Date(AGORA.getTime() + 100 * 60 * 60 * 1000).toISOString();
    const resultado = calcularDesvioSla(criarCarga({ previsaoEntrega: previsao }), AGORA);
    expect(resultado.horasDesvio).toBeGreaterThanOrEqual(0);
  });
});

describe("buscarCargaPorCodigo", () => {
  it("encontra por correspondência exata", () => {
    const carga = criarCarga({ codigoRastreio: "BRX-004521" });
    expect(buscarCargaPorCodigo([carga], "BRX-004521")).toBe(carga);
  });

  it("ignora maiúsculas/minúsculas e espaços nas pontas", () => {
    const carga = criarCarga({ codigoRastreio: "BRX-004521" });
    expect(buscarCargaPorCodigo([carga], "  brx-004521  ")).toBe(carga);
  });

  it("devolve null quando o código não existe", () => {
    expect(buscarCargaPorCodigo([criarCarga()], "INEXISTENTE-1")).toBeNull();
  });

  it("devolve null para código vazio", () => {
    expect(buscarCargaPorCodigo([criarCarga()], "   ")).toBeNull();
  });
});

describe("extrairCodigoRastreio", () => {
  it("extrai um código no formato letras+hífen+dígitos", () => {
    expect(extrairCodigoRastreio("Cadê minha encomenda BRX-004521?")).toBe("BRX-004521");
  });

  it("extrai e normaliza para maiúsculas", () => {
    expect(extrairCodigoRastreio("código brx004521 por favor")).toBe("BRX004521");
  });

  it("devolve null quando não há nada parecido com um código", () => {
    expect(extrairCodigoRastreio("Olá, bom dia, gostaria de saber do meu pedido.")).toBeNull();
  });

  it("não confunde um número de telefone com código de rastreio", () => {
    expect(extrairCodigoRastreio("Meu telefone é 11987654321")).toBeNull();
  });
});
