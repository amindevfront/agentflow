import { describe, expect, it } from "vitest";
import type { AuditChainVerification } from "@/types";
import { avaliarProntidaoGdpr, avaliarProntidaoUsPrivacy } from "@/lib/internationalReadiness";

function verificacaoIntegra(overrides: Partial<AuditChainVerification> = {}): AuditChainVerification {
  return {
    integra: true,
    entradasVerificadas: 10,
    assinaturasVerificadas: true,
    problemas: [],
    verificadoEm: new Date().toISOString(),
    ...overrides,
  };
}

function buscarItem(itens: ReturnType<typeof avaliarProntidaoGdpr>["itens"], id: string) {
  const item = itens.find((i) => i.id === id);
  if (!item) throw new Error(`item ${id} não encontrado`);
  return item;
}

describe("avaliarProntidaoGdpr", () => {
  it("sem nenhuma entrada de auditoria: registro de tratamento fica 'sem_dados'", () => {
    const resultado = avaliarProntidaoGdpr({ totalEntradasAuditoria: 0, verificacaoCadeia: null });
    expect(buscarItem(resultado.itens, "registro-tratamento").status).toBe("sem_dados");
  });

  it("com entradas registradas, 'registro de tratamento' atende", () => {
    const resultado = avaliarProntidaoGdpr({ totalEntradasAuditoria: 12, verificacaoCadeia: null });
    expect(buscarItem(resultado.itens, "registro-tratamento").status).toBe("atende");
  });

  it("verificação de cadeia ausente: integridade fica sem_dados, não nao_atende", () => {
    const resultado = avaliarProntidaoGdpr({ totalEntradasAuditoria: 5, verificacaoCadeia: null });
    expect(buscarItem(resultado.itens, "integridade-registro").status).toBe("sem_dados");
  });

  it("verificação íntegra: integridade atende; com problema: nao_atende", () => {
    const ok = avaliarProntidaoGdpr({ totalEntradasAuditoria: 5, verificacaoCadeia: verificacaoIntegra() });
    expect(buscarItem(ok.itens, "integridade-registro").status).toBe("atende");

    const comProblema = avaliarProntidaoGdpr({
      totalEntradasAuditoria: 5,
      verificacaoCadeia: verificacaoIntegra({
        integra: false,
        problemas: [{ seq: 2, entryId: "e2", problema: "assinatura-invalida", detalhe: "x" }],
      }),
    });
    expect(buscarItem(comProblema.itens, "integridade-registro").status).toBe("nao_atende");
  });

  it("itens fora do escopo do software nunca entram no denominador de totalAvaliavelPorSoftware", () => {
    const resultado = avaliarProntidaoGdpr({ totalEntradasAuditoria: 5, verificacaoCadeia: verificacaoIntegra() });
    const foraDoEscopo = resultado.itens.filter((i) => i.status === "fora_do_escopo");
    expect(foraDoEscopo.length).toBeGreaterThan(0);
    expect(resultado.totalAvaliavelPorSoftware).toBe(resultado.itens.length - foraDoEscopo.length);
  });

  it("cita artigos reais e estáveis do GDPR, nunca uma referência inventada", () => {
    const resultado = avaliarProntidaoGdpr({ totalEntradasAuditoria: 5, verificacaoCadeia: verificacaoIntegra() });
    const comBase = resultado.itens.filter((i) => i.baseLegal !== null);
    expect(comBase.every((i) => i.baseLegal?.startsWith("GDPR, Art."))).toBe(true);
  });
});

describe("avaliarProntidaoUsPrivacy", () => {
  it("sem nenhuma entrada de auditoria: registro de operações fica 'sem_dados'", () => {
    const resultado = avaliarProntidaoUsPrivacy({ totalEntradasAuditoria: 0, verificacaoCadeia: null });
    expect(buscarItem(resultado.itens, "registro-operacoes").status).toBe("sem_dados");
  });

  it("com entradas registradas, 'registro de operações' atende", () => {
    const resultado = avaliarProntidaoUsPrivacy({ totalEntradasAuditoria: 12, verificacaoCadeia: null });
    expect(buscarItem(resultado.itens, "registro-operacoes").status).toBe("atende");
  });

  it("NUNCA cita 'CCPA' ou qualquer lei estadual específica como base legal de um item (honestidade de escopo)", () => {
    const resultado = avaliarProntidaoUsPrivacy({ totalEntradasAuditoria: 5, verificacaoCadeia: verificacaoIntegra() });
    expect(resultado.itens.every((i) => i.baseLegal === null)).toBe(true);
  });

  it("direito de exclusão do consumidor é sempre fora do escopo do software", () => {
    const resultado = avaliarProntidaoUsPrivacy({ totalEntradasAuditoria: 5, verificacaoCadeia: verificacaoIntegra() });
    expect(buscarItem(resultado.itens, "direito-exclusao").status).toBe("fora_do_escopo");
  });

  it("itens fora do escopo do software nunca entram no denominador de totalAvaliavelPorSoftware", () => {
    const resultado = avaliarProntidaoUsPrivacy({ totalEntradasAuditoria: 5, verificacaoCadeia: verificacaoIntegra() });
    const foraDoEscopo = resultado.itens.filter((i) => i.status === "fora_do_escopo");
    expect(foraDoEscopo.length).toBeGreaterThan(0);
    expect(resultado.totalAvaliavelPorSoftware).toBe(resultado.itens.length - foraDoEscopo.length);
  });
});
