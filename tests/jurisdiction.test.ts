import { describe, expect, it } from "vitest";
import { inferirIdiomaPorTelefone, inferirJurisdicaoPorTelefone, inferirPaisPorTelefone } from "@/lib/jurisdiction";

describe("inferirJurisdicaoPorTelefone", () => {
  it("reconhece Brasil (LGPD)", () => {
    expect(inferirJurisdicaoPorTelefone("+5547999998888")).toBe("br-lgpd");
  });

  it("reconhece Portugal (GDPR) — mercado explicitamente alvo da expansão", () => {
    expect(inferirJurisdicaoPorTelefone("+351912345678")).toBe("eu-gdpr");
  });

  it("reconhece outros países da UE como GDPR", () => {
    expect(inferirJurisdicaoPorTelefone("+34912345678")).toBe("eu-gdpr"); // Espanha
    expect(inferirJurisdicaoPorTelefone("+33612345678")).toBe("eu-gdpr"); // França
  });

  it("reconhece EUA/Canadá (NANP) como 'us-privacy', nunca 'ccpa' (CCPA é lei estadual, não de todo o +1)", () => {
    expect(inferirJurisdicaoPorTelefone("+15551234567")).toBe("us-privacy");
  });

  it("devolve 'desconhecida' para DDI não catalogado, telefone malformado ou ausente", () => {
    expect(inferirJurisdicaoPorTelefone("+999999")).toBe("desconhecida");
    expect(inferirJurisdicaoPorTelefone("sem-mais")).toBe("desconhecida");
    expect(inferirJurisdicaoPorTelefone("5547999998888")).toBe("desconhecida"); // sem "+"
    expect(inferirJurisdicaoPorTelefone(null)).toBe("desconhecida");
    expect(inferirJurisdicaoPorTelefone(undefined)).toBe("desconhecida");
    expect(inferirJurisdicaoPorTelefone("")).toBe("desconhecida");
  });

  it("nunca lança, mesmo com entrada absurda", () => {
    expect(() => inferirJurisdicaoPorTelefone("+")).not.toThrow();
    expect(() => inferirJurisdicaoPorTelefone("+abc")).not.toThrow();
  });
});

describe("inferirIdiomaPorTelefone", () => {
  it("mapeia Brasil e Portugal para português", () => {
    expect(inferirIdiomaPorTelefone("+5547999998888")).toBe("pt");
    expect(inferirIdiomaPorTelefone("+351912345678")).toBe("pt");
  });

  it("mapeia Espanha e países hispânicos para espanhol", () => {
    expect(inferirIdiomaPorTelefone("+34912345678")).toBe("es"); // Espanha
    expect(inferirIdiomaPorTelefone("+525512345678")).toBe("es"); // México
  });

  it("mapeia EUA/Canadá para inglês", () => {
    expect(inferirIdiomaPorTelefone("+15551234567")).toBe("en");
  });

  it("usa inglês como fallback para país da UE sem idioma nativo suportado (ex.: França, Alemanha)", () => {
    expect(inferirIdiomaPorTelefone("+33612345678")).toBe("en"); // França
    expect(inferirIdiomaPorTelefone("+4915123456789")).toBe("en"); // Alemanha
  });

  it("usa inglês como fallback para DDI desconhecido, nunca assume português por padrão", () => {
    expect(inferirIdiomaPorTelefone("+999999")).toBe("en");
    expect(inferirIdiomaPorTelefone(null)).toBe("en");
  });
});

describe("inferirPaisPorTelefone", () => {
  it("devolve o nome do país catalogado, e null quando desconhecido", () => {
    expect(inferirPaisPorTelefone("+351912345678")).toBe("Portugal");
    expect(inferirPaisPorTelefone("+5547999998888")).toBe("Brasil");
    expect(inferirPaisPorTelefone("+999999")).toBeNull();
  });
});
