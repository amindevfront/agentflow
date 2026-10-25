// Política de senha para contas criadas dentro do app (self-serve signup e
// aceite de convite). O Firebase Auth por si só só exige 6 caracteres — esta
// validação roda no cliente, ANTES de chamar o SDK, como camada adicional de
// hardening (ver ADR-0003).

export const PASSWORD_MIN_LENGTH = 8;

const HAS_LOWER = /[a-z]/;
const HAS_UPPER = /[A-Z]/;
const HAS_NUMBER = /[0-9]/;
const HAS_SYMBOL = /[^A-Za-z0-9]/;

/** Retorna a mensagem de erro em pt-BR, ou `null` se a senha atende a política. */
export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  }
  const faltando: string[] = [];
  if (!HAS_LOWER.test(password)) faltando.push("letra minúscula");
  if (!HAS_UPPER.test(password)) faltando.push("letra maiúscula");
  if (!HAS_NUMBER.test(password)) faltando.push("número");
  if (!HAS_SYMBOL.test(password)) faltando.push("símbolo");

  if (faltando.length > 0) {
    return `Inclua ao menos: ${faltando.join(", ")}.`;
  }
  return null;
}

export function isPasswordValid(password: string): boolean {
  return validatePassword(password) === null;
}
