// Auditoria estática: todo valor da união `AuditEventType` precisa estar na
// allowlist `TIPOS_EVENTO` de `/api/audit/seal/route.ts`.
//
// Por que isto existe: `procedimento.consentimento.registrado` e
// `procedimento.posatendimento.registrado` foram adicionados ao tipo em
// `src/types/governance.ts`, compilaram sem erro (TypeScript não verifica o
// CONTEÚDO de um `Set` em runtime) e ainda assim todo selo desses eventos
// falhava com HTTP 400 "Tipo de evento desconhecido" — a allowlist do
// servidor é uma estrutura de dados separada, não derivada do tipo. Mesmo
// padrão de auditoria estática de `firestoreRulesAudit.test.ts`: não executa
// a rota (exigiria Admin SDK), mas pega exatamente a classe de regressão
// mais perigosa — alguém adiciona um tipo de evento e esquece de habilitá-lo
// no único lugar que de fato decide se o selo é aceito.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const TEXTO_TIPOS = readFileSync(resolve(__dirname, "..", "src", "types", "governance.ts"), "utf-8");
const TEXTO_ROTA = readFileSync(resolve(__dirname, "..", "src", "app", "api", "audit", "seal", "route.ts"), "utf-8");

/** Extrai os literais de string da união `AuditEventType`. */
function membrosDaUniao(): string[] {
  const inicio = TEXTO_TIPOS.indexOf("export type AuditEventType =");
  if (inicio === -1) throw new Error("União AuditEventType não encontrada em governance.ts.");
  const fim = TEXTO_TIPOS.indexOf(";", inicio);
  const bloco = TEXTO_TIPOS.slice(inicio, fim);
  const literais = [...bloco.matchAll(/"([a-z0-9.]+)"/g)].map((m) => m[1]);
  if (literais.length === 0) throw new Error("Nenhum literal extraído da união AuditEventType — regex desalinhada?");
  return literais;
}

/** Extrai os literais de string dentro do bloco `const TIPOS_EVENTO = new Set<AuditEventType>([ ... ]);`. */
function membrosDaAllowlist(): string[] {
  const inicio = TEXTO_ROTA.indexOf("const TIPOS_EVENTO");
  if (inicio === -1) throw new Error("TIPOS_EVENTO não encontrado em route.ts.");
  const fim = TEXTO_ROTA.indexOf("]);", inicio);
  const bloco = TEXTO_ROTA.slice(inicio, fim);
  return [...bloco.matchAll(/"([a-z0-9.]+)"/g)].map((m) => m[1]);
}

describe("AuditEventType ↔ TIPOS_EVENTO (allowlist do servidor) — sincronia", () => {
  const uniao = membrosDaUniao();
  const allowlist = membrosDaAllowlist();

  it.each(uniao)("'%s' está habilitado na allowlist do servidor (/api/audit/seal)", (tipo) => {
    expect(allowlist, `"${tipo}" existe em AuditEventType mas falta em TIPOS_EVENTO — todo selo deste tipo falharia com HTTP 400.`).toContain(tipo);
  });

  it("a allowlist não contém nenhum tipo que já não exista na união (nenhum morto/typo)", () => {
    for (const tipo of allowlist) {
      expect(uniao, `"${tipo}" está na allowlist mas não existe em AuditEventType — typo ou tipo removido?`).toContain(tipo);
    }
  });
});
