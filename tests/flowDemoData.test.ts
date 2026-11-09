import { describe, expect, it } from "vitest";
import { obterExemploFluxo } from "@/lib/flowDemoData";
import { NICHE_ORDER } from "@/lib/niches";

describe("obterExemploFluxo", () => {
  it("devolve o exemplo com o nome de marca pedido para construtora-imobiliaria (Horizon BC)", () => {
    const exemplo = obterExemploFluxo("construtora-imobiliaria");
    expect(exemplo.nomeFluxo).toContain("Horizon BC");
    expect(exemplo.payloadExemplo.nome).toBeTruthy();
    expect(exemplo.payloadExemplo.texto).toBeTruthy();
  });

  it("devolve o exemplo com o nome de marca pedido para salao-beleza (Salão da Mãe)", () => {
    const exemplo = obterExemploFluxo("salao-beleza");
    expect(exemplo.nomeFluxo).toContain("Salão da Mãe");
  });

  it("devolve payload em inglês para as gavetas americanas", () => {
    expect(obterExemploFluxo("us-real-estate-luxury").payloadExemplo.message).toBeTruthy();
    expect(obterExemploFluxo("us-construction-remodeling").payloadExemplo.message).toBeTruthy();
  });

  it("nunca devolve undefined — cai no fallback genérico para nichos sem exemplo próprio", () => {
    expect(obterExemploFluxo(null).nomeFluxo).toBeTruthy();
    expect(obterExemploFluxo(undefined).nomeFluxo).toBeTruthy();
    expect(obterExemploFluxo("outros").nomeFluxo).toBe("Meu primeiro fluxo de teste");
    expect(obterExemploFluxo("document-ai-vault").nomeFluxo).toBe("Meu primeiro fluxo de teste");
  });

  it("todo exemplo tem gatilho válido e payload com pelo menos um campo reconhecido pelo extrator do simulador", () => {
    const GATILHOS_VALIDOS = new Set(["webhook", "agendado", "formulario", "manual"]);
    for (const setor of NICHE_ORDER) {
      const exemplo = obterExemploFluxo(setor);
      expect(GATILHOS_VALIDOS.has(exemplo.gatilho)).toBe(true);
      const temCampoReconhecido = ["nome", "name", "texto", "message"].some((chave) => chave in exemplo.payloadExemplo);
      expect(temCampoReconhecido).toBe(true);
    }
  });
});
