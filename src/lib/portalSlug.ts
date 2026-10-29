// Slug público do Portal do Cliente (`/portal/[slug]`) — puro, sem Firestore.
//
// Gerado a partir do nome do workspace quando o Link Único do Cliente é
// aberto em Fluxos pela primeira vez (ver `@/lib/firestore` →
// `garantirSlugWorkspace`). Nunca sobrescreve um slug já definido.

const TAMANHO_MAXIMO = 48;

/** Converte um nome livre em um slug url-safe: minúsculas, sem acento, hífens no lugar de espaço. */
export function slugificar(nome: string): string {
  const normalizado = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove diacríticos (á, ç, ã, ...)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  const cortado = normalizado.slice(0, TAMANHO_MAXIMO).replace(/-+$/g, "");
  return cortado.length > 0 ? cortado : "cliente";
}

/** Formato aceito por `/portal/[slug]` — minúsculas, dígitos e hífen interno, 1–48 caracteres. */
export function slugValido(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(slug);
}
