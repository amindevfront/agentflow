// Sanitização de entrada de usuário na fronteira de escrita do Firestore —
// defesa em profundidade contra XSS/injeção (ver docs/architecture/adr-0004).
//
// React já escapa toda interpolação JSX por padrão — isto não é o que fecha o
// risco real. O risco real é um CONSUMIDOR FUTURO que não escapa: exportação
// de relatório, e-mail transacional, painel administrativo, integração de
// terceiro lendo via API. Sanitizar no momento da escrita (aqui, não em cada
// tela) garante que todo documento em `flows`, `connectors`, `invites`,
// `workspaces` e `users` já nasce seguro, independente de quem o lê depois.
//
// `sanitize-html` em vez de `isomorphic-dompurify`: a versão anterior
// dependia de jsdom em Node, cujo transitivo `html-encoding-sniffer`
// quebra em runtime na Vercel (`ERR_REQUIRE_ESM` ao exigir um arquivo
// ESM de `@exodus/bytes` via `require()` CJS) — derrubava `/portal/[slug]`
// e `/api/roi-dashboard` com HTTP 500 (visto em produção, 2026-11).
// `sanitize-html` faz exatamente o que usávamos do DOMPurify aqui (remover
// toda marcação com um allowlist vazio) sem precisar de DOM nenhum, real
// ou simulado — funciona identicamente em qualquer ambiente Node.

import sanitizeHtml from "sanitize-html";

export class ErroSanitizacao extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroSanitizacao";
  }
}

const LIMITE_TEXTO_PADRAO = 500;

/**
 * Remove TODA marcação HTML/SVG e normaliza espaços. Uso padrão para qualquer
 * campo de texto livre (nomes, descrições, rótulos) que nunca precisa conter
 * HTML — nem mesmo formatação básica.
 */
export function sanitizeText(valor: unknown, limite = LIMITE_TEXTO_PADRAO): string {
  const bruto = typeof valor === "string" ? valor : "";
  const semMarcacao = sanitizeHtml(bruto, { allowedTags: [], allowedAttributes: {} });
  return semMarcacao.replace(/\s+/g, " ").trim().slice(0, limite);
}

/** `sanitizeText` + normalização de e-mail (trim + lowercase), espelhando `sanitizeEmail` em `auth.tsx`. */
export function sanitizeEmailInput(valor: unknown): string {
  return sanitizeText(valor, 254).toLowerCase();
}

const PROTOCOLOS_PERMITIDOS = new Set(["https:", "http:"]);

/**
 * Valida e normaliza uma URL de webhook. String vazia é um valor válido
 * (campo opcional) e passa adiante sem tocar — só uma URL não vazia é
 * verificada contra esquema permitido, fechando o caminho de um
 * `javascript:`/`data:` disfarçado de webhook.
 */
export function sanitizeUrl(valor: unknown, limite = 2048): string {
  const texto = sanitizeText(valor, limite);
  if (texto.length === 0) return texto;

  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    throw new ErroSanitizacao("URL inválida.");
  }
  if (!PROTOCOLOS_PERMITIDOS.has(url.protocol)) {
    throw new ErroSanitizacao("Apenas URLs http:// ou https:// são permitidas.");
  }
  return url.toString();
}
