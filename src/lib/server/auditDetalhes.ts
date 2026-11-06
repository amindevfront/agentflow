// Normalização de `AuditEventBody.detalhes` — extraído de
// `/api/audit/seal/route.ts` porque Next.js restringe os exports permitidos
// num arquivo de rota (App Router) a um conjunto fixo (verbos HTTP, `config`,
// `runtime`, `dynamic`, ...) — qualquer outro export quebra o typecheck do
// framework. Lógica pura e testável vive aqui; a rota só a chama.
//
// Isomórfico por desenho (sem Firestore nem Admin SDK), mas vive em
// `server/` porque seu único consumidor é uma rota de servidor.

import { evidenciaSegura } from "@/lib/guardrails";
import { ErroApi } from "./http";

/** Teto de campos em `detalhes`, para que a entrada não se torne um depósito. */
export const MAX_DETALHES_AUDITORIA = 24;

/**
 * Normaliza `detalhes`: aceita apenas escalares.
 * Estruturas aninhadas iriam para o campo cifrado — misturar texto livre em um
 * campo legível é a via mais comum de PII vazar para dentro de um log.
 *
 * Toda string passa por `evidenciaSegura` (mascaramento de PII, mesmo motor
 * usado em toda a trilha de auditoria) antes de ser gravada: sem isso, um
 * chamador podia colocar qualquer texto livre em `detalhes` — ex.: um CPF
 * literal numa observação — e ele seria selado em claro, PERMANENTEMENTE,
 * na cadeia hash-encadeada e assinada por HMAC (que por desenho resiste à
 * remoção). Validar só a forma do campo (chave, tipo, tamanho) não bastava.
 */
export function normalizarDetalhesAuditoria(
  bruto: unknown
): Record<string, string | number | boolean | null> {
  if (bruto === undefined || bruto === null) return {};
  if (typeof bruto !== "object" || Array.isArray(bruto)) {
    throw new ErroApi(400, 'Campo "corpo.detalhes" deve ser um objeto.', "campo_invalido");
  }

  const entradas = Object.entries(bruto as Record<string, unknown>);
  if (entradas.length > MAX_DETALHES_AUDITORIA) {
    throw new ErroApi(400, `"corpo.detalhes" excede ${MAX_DETALHES_AUDITORIA} campos.`, "campo_invalido");
  }

  const saida: Record<string, string | number | boolean | null> = {};
  for (const [chave, valor] of entradas) {
    if (!/^[A-Za-z0-9_.-]{1,48}$/.test(chave)) {
      throw new ErroApi(400, `Chave inválida em detalhes: ${chave}`, "campo_invalido");
    }
    if (valor === null || typeof valor === "boolean") {
      saida[chave] = valor;
    } else if (typeof valor === "number") {
      saida[chave] = Number.isFinite(valor) ? valor : null;
    } else if (typeof valor === "string") {
      saida[chave] = evidenciaSegura(valor, 512);
    } else {
      throw new ErroApi(
        400,
        `Detalhe "${chave}" deve ser escalar. Use "detalhesSensiveis" para estruturas.`,
        "campo_invalido"
      );
    }
  }
  return saida;
}
