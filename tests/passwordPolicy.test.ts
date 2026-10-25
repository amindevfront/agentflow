import { describe, expect, it } from "vitest";
import { PASSWORD_MIN_LENGTH, isPasswordValid, validatePassword } from "@/lib/passwordPolicy";

describe("validatePassword", () => {
  it("rejeita senhas mais curtas que o mínimo", () => {
    expect(validatePassword("Ab1!")).toContain(`${PASSWORD_MIN_LENGTH}`);
  });

  it("rejeita senha longa mas sem todas as classes de caractere", () => {
    expect(validatePassword("somenteletras")).toContain("maiúscula");
    expect(validatePassword("SOMENTEMAIUSCULAS1")).toContain("minúscula");
    expect(validatePassword("SemNumeroOuSimbolo")).toContain("número");
    expect(validatePassword("SemSimbolo123")).toContain("símbolo");
  });

  it("aceita senha com todas as classes e tamanho mínimo", () => {
    expect(validatePassword("Agentflow#2026")).toBeNull();
  });

  it("isPasswordValid é consistente com validatePassword", () => {
    expect(isPasswordValid("Agentflow#2026")).toBe(true);
    expect(isPasswordValid("fraca")).toBe(false);
  });
});
