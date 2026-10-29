import { describe, expect, it } from "vitest";
import { slugCorrespondeAoWorkspace, slugificar, slugValido } from "@/lib/portalSlug";

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

describe("slugCorrespondeAoWorkspace", () => {
  it("aceita quando o slug da URL é exatamente o slug gravado no workspace", () => {
    expect(slugCorrespondeAoWorkspace({ id: "ws_1", slug: "wings-studio" }, "wings-studio")).toBe(true);
  });

  it("rejeita quando o slug da URL não corresponde ao slug gravado — o 'link fantasma'", () => {
    expect(slugCorrespondeAoWorkspace({ id: "ws_1", slug: "wings-studio" }, "clinica-prime")).toBe(false);
    expect(slugCorrespondeAoWorkspace({ id: "ws_1", slug: "wings-studio" }, "ws_1")).toBe(false);
  });

  it("aceita o id bruto como fallback quando o workspace ainda não tem slug", () => {
    expect(slugCorrespondeAoWorkspace({ id: "ws_1", slug: null }, "ws_1")).toBe(true);
    expect(slugCorrespondeAoWorkspace({ id: "ws_1", slug: undefined }, "ws_1")).toBe(true);
  });

  it("rejeita qualquer outro slug quando ainda não há slug definido", () => {
    expect(slugCorrespondeAoWorkspace({ id: "ws_1", slug: null }, "outro-slug")).toBe(false);
  });
});
