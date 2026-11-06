// `normalizarDetalhes` (/api/audit/seal) precisa mascarar PII antes de selar
// o evento na trilha de auditoria — a cadeia é hash-encadeada e assinada por
// HMAC, ou seja, por desenho resiste à remoção. Um campo `detalhes` escalar
// que aceitasse texto livre sem passar pelo mesmo motor de PII usado no resto
// do sistema (`@/lib/guardrails`) selaria dados pessoais em claro,
// permanentemente. Ver achado 2.1 da auditoria de segurança.

import { describe, expect, it } from "vitest";
import { ErroApi } from "@/lib/server/http";
import { normalizarDetalhesAuditoria as normalizarDetalhes } from "@/lib/server/auditDetalhes";

describe("normalizarDetalhesAuditoria", () => {
  it("mascara CPF em um valor de detalhe antes de aceitar", () => {
    const resultado = normalizarDetalhes({ observacao: "Cliente com CPF 529.982.247-25 confirmou o pedido." });
    expect(resultado.observacao).not.toContain("529.982.247-25");
    expect(resultado.observacao).toContain("[[PII:CPF:1]]");
  });

  it("mascara e-mail e telefone em campos distintos", () => {
    const resultado = normalizarDetalhes({
      contato: "cliente@exemplo.com",
      telefone: "(11) 98888-7777",
    });
    expect(resultado.contato).not.toContain("cliente@exemplo.com");
    expect(resultado.telefone).not.toContain("98888-7777");
  });

  it("preserva texto sem PII inalterado (fora da normalização de espaços)", () => {
    const resultado = normalizarDetalhes({ status: "ticket resolvido pelo operador" });
    expect(resultado.status).toBe("ticket resolvido pelo operador");
  });

  it("preserva escalares não-string (number, boolean, null) sem alteração", () => {
    const resultado = normalizarDetalhes({ tentativas: 3, sucesso: true, motivo: null });
    expect(resultado).toEqual({ tentativas: 3, sucesso: true, motivo: null });
  });

  it("rejeita estrutura aninhada (deve ir para detalhesSensiveis cifrados, não aqui)", () => {
    expect(() => normalizarDetalhes({ payload: { aninhado: true } })).toThrow(ErroApi);
  });
});
