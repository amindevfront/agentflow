import { describe, expect, it } from "vitest";
import { slugificar, slugValido } from "@/lib/portalSlug";

describe("slugificar", () => {
  it("converte espaços em hífens e remove acentos/caixa", () => {
    expect(slugificar("Wings Studio Hair")).toBe("wings-studio-hair");
    expect(slugificar("Clínica Oral Spec")).toBe("clinica-oral-spec");
    expect(slugificar("Imobiliária Prime")).toBe("imobiliaria-prime");
  });

  it("remove caracteres não url-safe e colapsa hífens repetidos", () => {
    expect(slugificar("Salão & Barbearia -- Top!!")).toBe("salao-barbearia-top");
  });

  it("remove hífens nas bordas", () => {
    expect(slugificar("  -Clínica-  ")).toBe("clinica");
  });

  it("nunca devolve string vazia — usa 'cliente' como fallback", () => {
    expect(slugificar("")).toBe("cliente");
    expect(slugificar("!!!")).toBe("cliente");
  });

  it("corta no tamanho máximo sem deixar hífen pendurado", () => {
    const nomeGigante = "a".repeat(100);
    const resultado = slugificar(nomeGigante);
    expect(resultado.length).toBeLessThanOrEqual(48);
  });
});

describe("slugValido", () => {
  it("aceita slugs bem formados", () => {
    expect(slugValido("wings-studio-hair")).toBe(true);
    expect(slugValido("a")).toBe(true);
    expect(slugValido("a1-b2")).toBe(true);
  });

  it("rejeita slug vazio, com maiúsculas, espaço ou hífen nas bordas", () => {
    expect(slugValido("")).toBe(false);
    expect(slugValido("Wings-Studio")).toBe(false);
    expect(slugValido("wings studio")).toBe(false);
    expect(slugValido("-wings")).toBe(false);
    expect(slugValido("wings-")).toBe(false);
  });
});
