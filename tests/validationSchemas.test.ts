import { describe, expect, it } from "vitest";
import {
  connectorSchema,
  emailSchema,
  inviteSchema,
  loginSchema,
  nicheKeySchema,
  primeiraMensagemZod,
  signupSchema,
  strongPasswordSchema,
  webhookUrlSchema,
  workspaceNameSchema,
} from "@/lib/validation/schemas";

describe("emailSchema", () => {
  it("aceita e-mails válidos", () => {
    expect(emailSchema.safeParse("caio@exemplo.com").success).toBe(true);
  });

  it("rejeita formato inválido e campo vazio", () => {
    expect(emailSchema.safeParse("não-é-email").success).toBe(false);
    expect(emailSchema.safeParse("").success).toBe(false);
  });
});

describe("strongPasswordSchema", () => {
  it("delega para a política de senha (passwordPolicy)", () => {
    expect(strongPasswordSchema.safeParse("Agentflow#2026").success).toBe(true);
    expect(strongPasswordSchema.safeParse("fraca").success).toBe(false);
  });
});

describe("nicheKeySchema", () => {
  it("aceita apenas as chaves conhecidas em NICHE_ORDER", () => {
    expect(nicheKeySchema.safeParse("construtora-imobiliaria").success).toBe(true);
    expect(nicheKeySchema.safeParse("outros").success).toBe(true);
    expect(nicheKeySchema.safeParse("setor-inventado").success).toBe(false);
  });
});

describe("workspaceNameSchema", () => {
  it("respeita os limites mínimo e máximo", () => {
    expect(workspaceNameSchema.safeParse("A").success).toBe(false);
    expect(workspaceNameSchema.safeParse("Construtora Horizonte").success).toBe(true);
    expect(workspaceNameSchema.safeParse("x".repeat(81)).success).toBe(false);
  });
});

describe("webhookUrlSchema", () => {
  it("aceita vazio (campo opcional)", () => {
    expect(webhookUrlSchema.safeParse("").success).toBe(true);
  });

  it("aceita https:// com domínio válido", () => {
    expect(webhookUrlSchema.safeParse("https://exemplo.com/hook").success).toBe(true);
  });

  it("rejeita http:// (exige https) e URLs incompletas", () => {
    expect(webhookUrlSchema.safeParse("http://exemplo.com").success).toBe(false);
    expect(webhookUrlSchema.safeParse("https://").success).toBe(false);
  });
});

describe("schemas compostos", () => {
  it("signupSchema exige senha forte", () => {
    expect(signupSchema.safeParse({ email: "a@b.com", password: "Agentflow#2026" }).success).toBe(true);
    expect(signupSchema.safeParse({ email: "a@b.com", password: "123" }).success).toBe(false);
  });

  it("loginSchema só exige senha não vazia", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "qualquer" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });

  it("inviteSchema valida e-mail e papel", () => {
    expect(inviteSchema.safeParse({ email: "a@b.com", papel: "admin" }).success).toBe(true);
    expect(inviteSchema.safeParse({ email: "a@b.com", papel: "superadmin" }).success).toBe(false);
  });

  it("connectorSchema valida nome e tipo", () => {
    expect(connectorSchema.safeParse({ nome: "Webhook principal", tipo: "Webhook" }).success).toBe(true);
    expect(connectorSchema.safeParse({ nome: "A", tipo: "" }).success).toBe(false);
  });
});

describe("primeiraMensagemZod", () => {
  it("extrai a primeira mensagem de erro do ZodError", () => {
    const resultado = emailSchema.safeParse("");
    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(primeiraMensagemZod(resultado.error)).toBe("Informe um e-mail.");
    }
  });
});
