// Schemas Zod — segunda camada de validação, independente da reativa da UI.
//
// Por que duas camadas, se a UI (Field + estado de erro reativo) já valida?
// Porque a validação de tela pode ser pulada (chamada direta ao handler em
// teste, um novo caminho de código que esquece de checar `canSubmit`, uma
// extensão futura) — o schema aqui é o último portão ANTES de qualquer dado
// alcançar `src/lib/firestore.ts` ou uma chamada ao Firebase Auth, e não
// depende de nenhum estado de componente (ver ADR-0004).
//
// Propositalmente redundante com `passwordPolicy.ts`/`sanitize.ts`: cada um
// cobre uma preocupação (política de senha, sanitização de persistência,
// forma estrutural dos dados) e nenhum substitui o outro.

import { z } from "zod";
import { isPasswordValid } from "@/lib/passwordPolicy";
import { NICHE_ORDER } from "@/lib/niches";
import type { NicheKey } from "@/types";

export const emailSchema = z
  .string()
  .trim()
  .min(3, "Informe um e-mail.")
  .max(254, "E-mail excede o tamanho máximo.")
  .email("Formato de e-mail inválido.");

/** Apenas "não está vazia" — a política completa (8+/misto) é responsabilidade de `passwordPolicy.ts`. */
export const loginPasswordSchema = z.string().min(1, "Informe a senha.");

export const strongPasswordSchema = z
  .string()
  .refine(isPasswordValid, "Senha não atende à política de segurança mínima.");

export const nicheKeySchema = z.enum(NICHE_ORDER as [NicheKey, ...NicheKey[]]);

export const userRoleSchema = z.enum(["operacoes", "admin"]);

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(2, "Mínimo de 2 caracteres.")
  .max(80, "Máximo de 80 caracteres.");

export const connectorNameSchema = z
  .string()
  .trim()
  .min(2, "Mínimo de 2 caracteres.")
  .max(80, "Máximo de 80 caracteres.");

export const connectorTypeSchema = z.string().trim().min(1, "Selecione um tipo.").max(60);

export const flowNameSchema = z
  .string()
  .trim()
  .min(3, "Mínimo de 3 caracteres.")
  .max(120, "Máximo de 120 caracteres.");

export const flowOrigemSchema = z.string().trim().max(200, "Máximo de 200 caracteres.");

/** Vazio é válido (campo opcional) — a URL só é verificada quando preenchida. */
export const webhookUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((valor) => valor.length === 0 || /^https:\/\/[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(valor), {
    message: "Endereço incompleto — use https:// e um domínio válido.",
  });

export const signupSchema = z.object({
  email: emailSchema,
  password: strongPasswordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: loginPasswordSchema,
});

export const inviteSchema = z.object({
  email: emailSchema,
  papel: userRoleSchema,
});

export const connectorSchema = z.object({
  nome: connectorNameSchema,
  tipo: connectorTypeSchema,
});

/** Extrai a primeira mensagem de erro de um `ZodError` — suficiente para exibição de uma linha na UI. */
export function primeiraMensagemZod(erro: z.ZodError): string {
  return erro.issues[0]?.message ?? "Dados inválidos.";
}
