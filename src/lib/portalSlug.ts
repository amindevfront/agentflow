// Slug público do Portal do Cliente (`/portal/[slug]`) — puro, sem Firestore.
//
// Gerado a partir do nome do workspace quando o Link Único do Cliente é
// aberto em Fluxos pela primeira vez (ver `@/lib/firestore` →
// `garantirSlugWorkspace`). Nunca sobrescreve um slug já definido.

import type { Workspace } from "@/types";

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

/**
 * Confirma que o slug da URL corresponde de fato ao workspace resolvido —
 * nunca aceita por aproximação. Sem essa checagem, `/portal/[slug]` aceitaria
 * QUALQUER slug na URL e ainda assim exibiria os dados do workspace de quem
 * estiver autenticado no navegador: um "link fantasma" que parece apontar
 * para um cliente específico, mas na prática mostra sempre quem está logado.
 *
 * Quando o workspace ainda não gerou um slug próprio, aceita o `id` bruto
 * como fallback — o mesmo fallback que `getWorkspaceBySlug`/a rota do portal
 * já documentam.
 */
export function slugCorrespondeAoWorkspace(workspace: Pick<Workspace, "id" | "slug">, slugDaUrl: string): boolean {
  if (workspace.slug) return workspace.slug === slugDaUrl;
  return workspace.id === slugDaUrl;
}
