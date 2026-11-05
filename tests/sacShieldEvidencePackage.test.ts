import { describe, expect, it } from "vitest";
import type { AuditEntry, AuditEventBody } from "@/types";
import { selecionarEntradasDoPeriodo } from "@/lib/server/sacShieldEvidencePackage";

function corpo(ocorridoEm: string, parcial: Partial<AuditEventBody> = {}): AuditEventBody {
  return {
    tipo: "guardrail.entrada.mascarada",
    resultado: "sucesso",
    workspaceId: "ws-1",
    ator: "uid-1",
    recurso: "flows/flow-1",
    detalhes: {},
    ocorridoEm,
    ...parcial,
  };
}

function entrada(seq: number, ocorridoEm: string): AuditEntry {
  return {
    id: `ws-1__${String(seq).padStart(12, "0")}`,
    workspaceId: "ws-1",
    seq,
    corpo: corpo(ocorridoEm),
    contentHash: `hash-${seq}`,
    prevHash: seq === 1 ? "" : `hash-${seq - 1}`,
    chainHash: `hash-${seq}`,
    assinatura: `sig-${seq}`,
    versaoSelo: "1",
    seladoEm: ocorridoEm,
  };
}

describe("selecionarEntradasDoPeriodo", () => {
  const entradas = [
    entrada(1, "2026-01-01T00:00:00.000Z"),
    entrada(2, "2026-02-15T10:00:00.000Z"),
    entrada(3, "2026-03-01T23:59:59.999Z"),
    entrada(4, "2026-04-01T00:00:00.000Z"),
  ];

  it("inclui apenas entradas cujo ocorridoEm cai dentro do período, com as bordas inclusivas", () => {
    const resultado = selecionarEntradasDoPeriodo(
      entradas,
      new Date("2026-02-01T00:00:00.000Z"),
      new Date("2026-03-01T23:59:59.999Z")
    );

    expect(resultado.map((e) => e.seq)).toEqual([2, 3]);
  });

  it("devolve lista vazia quando nenhuma entrada cai no período", () => {
    const resultado = selecionarEntradasDoPeriodo(
      entradas,
      new Date("2025-01-01T00:00:00.000Z"),
      new Date("2025-12-31T23:59:59.999Z")
    );
    expect(resultado).toEqual([]);
  });

  it("ordena o resultado por seq crescente, independente da ordem de entrada", () => {
    const foraDeOrdem = [entradas[3], entradas[0], entradas[2], entradas[1]];
    const resultado = selecionarEntradasDoPeriodo(
      foraDeOrdem,
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-04-01T00:00:00.000Z")
    );
    expect(resultado.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });
});
