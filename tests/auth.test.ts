import { describe, expect, it } from "vitest";
import { translateAuthError } from "@/lib/auth";

function erroComCodigo(code: string): unknown {
  return { code };
}

describe("translateAuthError", () => {
  it("traduz credenciais inválidas sem revelar se o e-mail existe", () => {
    expect(translateAuthError(erroComCodigo("auth/invalid-credential"))).toBe("E-mail ou senha incorretos.");
    expect(translateAuthError(erroComCodigo("auth/wrong-password"))).toBe("E-mail ou senha incorretos.");
    expect(translateAuthError(erroComCodigo("auth/user-not-found"))).toBe("E-mail ou senha incorretos.");
  });

  it("agrupa e-mail em formato inválido na mesma mensagem genérica (anti-enumeração)", () => {
    expect(translateAuthError(erroComCodigo("auth/invalid-email"))).toBe("E-mail ou senha incorretos.");
  });

  it("traduz e-mail já em uso no cadastro", () => {
    expect(translateAuthError(erroComCodigo("auth/email-already-in-use"))).toBe(
      "Já existe uma conta com este e-mail. Faça login normalmente."
    );
  });

  it("traduz senha fraca e falha de rede", () => {
    expect(translateAuthError(erroComCodigo("auth/weak-password"))).toContain("Senha muito curta");
    expect(translateAuthError(erroComCodigo("auth/network-request-failed"))).toContain("Falha de conexão");
  });

  it("nunca repassa error.message para um código auth/* desconhecido (sem vazar detalhe técnico)", () => {
    const erroTecnico = { code: "auth/internal-error-xyz", message: "detalhe técnico sensível do backend" };
    const traduzido = translateAuthError(erroTecnico);
    expect(traduzido).toBe("Não foi possível concluir a autenticação. Tente novamente.");
    expect(traduzido).not.toContain("sensível");
  });

  it("repassa a mensagem de um Error SEM code — são erros gerados pelo próprio app (ex.: política de senha)", () => {
    expect(translateAuthError(new Error("algo específico quebrou"))).toBe("algo específico quebrou");
  });

  it("cai em mensagem genérica quando não há código nem Error", () => {
    expect(translateAuthError("qualquer coisa")).toBe("Não foi possível concluir a autenticação. Tente novamente.");
  });
});
