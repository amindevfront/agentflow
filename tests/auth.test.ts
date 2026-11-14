import { afterEach, describe, expect, it } from "vitest";
import { deveUsarRedirectParaGoogle, translateAuthError } from "@/lib/auth";

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

// `deveUsarRedirectParaGoogle` decide se o login com Google usa
// `signInWithRedirect` (mobile/PWA) em vez de `signInWithPopup` — a
// suíte roda em ambiente `node` (ver vitest.config.ts), então fabrica um
// `window`/`navigator` mínimo em vez de depender de jsdom, mantendo o
// mesmo estilo "lógica pura, sem DOM real" do resto dos testes.
describe("deveUsarRedirectParaGoogle", () => {
  afterEach(() => {
    // @ts-expect-error -- `window` não existe no ambiente `node` por padrão.
    delete globalThis.window;
  });

  function instalarWindowFalso(userAgent: string, opcoes: { standalone?: boolean; matchMediaStandalone?: boolean } = {}) {
    // Fake mínimo, só os campos que `deveUsarRedirectParaGoogle` lê — `as
    // unknown as typeof window` em vez de `@ts-expect-error` porque o
    // literal tem vários campos incompatíveis com `Window`/`Navigator`
    // reais, e o erro de cada um surgiria numa linha diferente.
    globalThis.window = {
      matchMedia: (query: string) =>
        query === "(display-mode: standalone)" ? { matches: opcoes.matchMediaStandalone === true } : { matches: false },
      navigator: { userAgent, standalone: opcoes.standalone },
    } as unknown as typeof window;
  }

  it("usa popup (devolve false) em desktop comum", () => {
    instalarWindowFalso("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0");
    expect(deveUsarRedirectParaGoogle()).toBe(false);
  });

  it("usa redirect em iPhone/iPad/Android", () => {
    instalarWindowFalso("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15");
    expect(deveUsarRedirectParaGoogle()).toBe(true);

    instalarWindowFalso("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36");
    expect(deveUsarRedirectParaGoogle()).toBe(true);
  });

  it("usa redirect em PWA instalada (display-mode: standalone), mesmo em desktop", () => {
    instalarWindowFalso("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0", { matchMediaStandalone: true });
    expect(deveUsarRedirectParaGoogle()).toBe(true);
  });

  it("usa redirect via `navigator.standalone` (PWA instalada no iOS, sem suporte a matchMedia display-mode)", () => {
    instalarWindowFalso("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", { standalone: true });
    expect(deveUsarRedirectParaGoogle()).toBe(true);
  });

  it("nunca lança quando `window.matchMedia` não existe (navegador antigo/ambiente restrito)", () => {
    // Fake deliberadamente SEM `matchMedia`, para cobrir o bug real já
    // corrigido (optional chaining incompleto lançava TypeError).
    globalThis.window = {
      navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    } as unknown as typeof window;
    expect(() => deveUsarRedirectParaGoogle()).not.toThrow();
    expect(deveUsarRedirectParaGoogle()).toBe(false);
  });

  it("devolve false fora de um navegador (SSR, `window` indefinido)", () => {
    expect(deveUsarRedirectParaGoogle()).toBe(false);
  });
});
