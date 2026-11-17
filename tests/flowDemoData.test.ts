import { describe, expect, it } from "vitest";
import { obterExemploFluxo } from "@/lib/flowDemoData";
import { NICHE_ORDER } from "@/lib/niches";

describe("obterExemploFluxo", () => {
  it("devolve o exemplo do Motor Vertical A (Incorporadora Atlântica — Itajaí/BC)", () => {
    const exemplo = obterExemploFluxo("construtora-imobiliaria");
    expect(exemplo.nomeFluxo).toContain("Incorporadora Atlântica");
    expect(exemplo.payloadExemplo.nome).toBeTruthy();
    expect(exemplo.payloadExemplo.texto).toBeTruthy();
  });

  it("devolve o exemplo do Motor Vertical B (Logística B2B) com peso e cubagem no payload", () => {
    const exemplo = obterExemploFluxo("logistica-portuaria");
    expect(exemplo.nomeFluxo).toContain("Logística");
    expect(exemplo.payloadExemplo.texto).toContain("kg");
    expect(exemplo.payloadExemplo.texto).toContain("m³");
  });

  it("nenhum exemplo de demonstração carrega artefato residual de Salão de Beleza/Barbearia", () => {
    const PROIBIDO = /sal[ãa]o|barbearia|escova|manicure/i;
    for (const setor of NICHE_ORDER) {
      const exemplo = obterExemploFluxo(setor);
      expect(PROIBIDO.test(exemplo.nomeFluxo)).toBe(false);
      expect(PROIBIDO.test(JSON.stringify(exemplo.payloadExemplo))).toBe(false);
    }
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
