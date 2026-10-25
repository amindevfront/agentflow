import { describe, expect, it } from "vitest";
import { ErroSanitizacao, sanitizeEmailInput, sanitizeText, sanitizeUrl } from "@/lib/sanitize";

describe("sanitizeText", () => {
  it("remove toda marcação HTML, inclusive tentativas de XSS", () => {
    // `<script>` é removido junto com o próprio conteúdo (não só a tag) —
    // comportamento do DOMPurify, mais seguro que apenas strip de tag.
    expect(sanitizeText("<script>alert(1)</script>Olá")).toBe("Olá");
    expect(sanitizeText('<img src=x onerror="alert(1)">Fluxo')).toBe("Fluxo");
    expect(sanitizeText("<b>Nome</b> em negrito")).toBe("Nome em negrito");
  });

  it("normaliza espaços e corta nas bordas", () => {
    expect(sanitizeText("  Nome   com   espaços  ")).toBe("Nome com espaços");
  });

  it("trunca no limite informado", () => {
    expect(sanitizeText("a".repeat(600), 10)).toBe("a".repeat(10));
  });

  it("trata entrada não-string como vazia, sem lançar", () => {
    expect(sanitizeText(undefined)).toBe("");
    expect(sanitizeText(null)).toBe("");
    expect(sanitizeText(42)).toBe("");
  });
});

describe("sanitizeEmailInput", () => {
  it("normaliza para minúsculas e remove espaços", () => {
    expect(sanitizeEmailInput("  Caio@Example.COM  ")).toBe("caio@example.com");
  });

  it("também remove marcação, caso injetada", () => {
    expect(sanitizeEmailInput("<b>caio</b>@example.com")).toBe("caio@example.com");
  });
});

describe("sanitizeUrl", () => {
  it("aceita uma URL https válida e a normaliza", () => {
    expect(sanitizeUrl("https://exemplo.com/webhook")).toBe("https://exemplo.com/webhook");
  });

  it("string vazia passa adiante sem validar esquema (campo opcional)", () => {
    expect(sanitizeUrl("")).toBe("");
    expect(sanitizeUrl("   ")).toBe("");
  });

  it("rejeita esquemas perigosos disfarçados de webhook", () => {
    expect(() => sanitizeUrl("javascript:alert(1)")).toThrow(ErroSanitizacao);
    expect(() => sanitizeUrl("data:text/html,<script>alert(1)</script>")).toThrow(ErroSanitizacao);
  });

  it("rejeita texto que não é uma URL", () => {
    expect(() => sanitizeUrl("não é uma url")).toThrow(ErroSanitizacao);
  });
});
