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
// Isomórfico por desenho (ver `isomorphic-dompurify`): usa DOMPurify real no
// navegador e um fallback via jsdom em Node (testes) — nenhuma lógica aqui
// precisa saber em qual ambiente está rodando.

import DOMPurify from "isomorphic-dompurify";

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
  const semMarcacao = DOMPurify.sanitize(bruto, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
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
