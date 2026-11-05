import { describe, expect, it } from "vitest";
import { avaliarRiscoConteudoDisparo, avaliarRiscoDisparoCanal } from "@/lib/channelReputationShield";

describe("avaliarRiscoConteudoDisparo", () => {
  it("não acumula peso para uma mensagem comum", () => {
    const resultado = avaliarRiscoConteudoDisparo("Olá! Seu pedido saiu para entrega hoje às 14h.");
    expect(resultado.peso).toBe(0);
    expect(resultado.motivos).toEqual([]);
  });

  it("acumula peso para cada sinal de spam presente, sem duplicar categorias", () => {
    const resultado = avaliarRiscoConteudoDisparo("GRÁTIS!!! Clique aqui agora: bit.ly/promo");
    expect(resultado.peso).toBeGreaterThan(0);
    expect(resultado.motivos.length).toBeGreaterThan(1);
  });

  it("trata texto vazio como risco zero", () => {
    expect(avaliarRiscoConteudoDisparo("")).toEqual({ peso: 0, motivos: [] });
    expect(avaliarRiscoConteudoDisparo("   ")).toEqual({ peso: 0, motivos: [] });
  });

  it("detecta link de encurtador isoladamente", () => {
    const resultado = avaliarRiscoConteudoDisparo("Veja mais em bit.ly/oferta");
    expect(resultado.motivos).toContain("link de encurtador");
  });
});

describe("avaliarRiscoDisparoCanal", () => {
  it("permite e não recomenda atraso para uma mensagem normal, canal estável, sem pico de volume", () => {
    const avaliacao = avaliarRiscoDisparoCanal({
      texto: "Seu pedido foi confirmado.",
      limiteDeVolumeExcedido: false,
      disjuntorAberto: false,
    });

    expect(avaliacao).toEqual({ nivel: "normal", permitido: true, motivos: [], atrasoMsRecomendado: 0 });
  });

  it("bloqueia incondicionalmente quando o disjuntor do canal está aberto, mesmo com conteúdo inofensivo", () => {
    const avaliacao = avaliarRiscoDisparoCanal({
      texto: "Mensagem perfeitamente normal.",
      limiteDeVolumeExcedido: false,
      disjuntorAberto: true,
    });

    expect(avaliacao.nivel).toBe("critico");
    expect(avaliacao.permitido).toBe(false);
    expect(avaliacao.motivos.some((m) => m.includes("disjuntor"))).toBe(true);
  });

  it("bloqueia incondicionalmente quando o limite de volume foi excedido", () => {
    const avaliacao = avaliarRiscoDisparoCanal({
      texto: "Mensagem perfeitamente normal.",
      limiteDeVolumeExcedido: true,
      disjuntorAberto: false,
    });

    expect(avaliacao.permitido).toBe(false);
    expect(avaliacao.motivos.some((m) => m.includes("pico de volume"))).toBe(true);
  });

  it("bloqueia por conteúdo de alto risco, mesmo com infraestrutura saudável", () => {
    const avaliacao = avaliarRiscoDisparoCanal({
      texto: "GANHE DINHEIRO FÁCIL!!! Clique aqui: bit.ly/renda-extra",
      limiteDeVolumeExcedido: false,
      disjuntorAberto: false,
    });

    expect(avaliacao.nivel).toBe("critico");
    expect(avaliacao.permitido).toBe(false);
  });

  it("permite com atraso recomendado quando o risco de conteúdo é apenas moderado", () => {
    const avaliacao = avaliarRiscoDisparoCanal({
      texto: "Promoção imperdível só até hoje!",
      limiteDeVolumeExcedido: false,
      disjuntorAberto: false,
    });

    expect(avaliacao.nivel).toBe("elevado");
    expect(avaliacao.permitido).toBe(true);
    expect(avaliacao.atrasoMsRecomendado).toBeGreaterThan(0);
  });
});
