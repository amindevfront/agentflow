import { describe, expect, it } from "vitest";
import type { AuditChainVerification } from "@/types";
import { avaliarProntidaoLgpd } from "@/lib/lgpdReadiness";

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

function buscarItem(itens: ReturnType<typeof avaliarProntidaoLgpd>["itens"], id: string) {
  const item = itens.find((i) => i.id === id);
  if (!item) throw new Error(`item ${id} não encontrado`);
  return item;
}

describe("avaliarProntidaoLgpd", () => {
  it("sem nenhuma entrada de auditoria: registro de operações fica 'sem_dados'", () => {
    const resultado = avaliarProntidaoLgpd({ totalEntradasAuditoria: 0, verificacaoCadeia: null });
    expect(buscarItem(resultado.itens, "registro-operacoes").status).toBe("sem_dados");
  });

  it("com entradas registradas, 'registro de operações' atende", () => {
    const resultado = avaliarProntidaoLgpd({ totalEntradasAuditoria: 30, verificacaoCadeia: null });
    expect(buscarItem(resultado.itens, "registro-operacoes").status).toBe("atende");
  });

  it("verificação de cadeia ausente: 'integridade' fica sem_dados, não 'nao_atende'", () => {
    const resultado = avaliarProntidaoLgpd({ totalEntradasAuditoria: 5, verificacaoCadeia: null });
    expect(buscarItem(resultado.itens, "integridade-registro").status).toBe("sem_dados");
  });

  it("verificação íntegra: 'integridade' atende", () => {
    const resultado = avaliarProntidaoLgpd({ totalEntradasAuditoria: 5, verificacaoCadeia: verificacaoIntegra() });
    expect(buscarItem(resultado.itens, "integridade-registro").status).toBe("atende");
  });

  it("verificação com problema: 'integridade' nao_atende", () => {
    const resultado = avaliarProntidaoLgpd({
      totalEntradasAuditoria: 5,
      verificacaoCadeia: verificacaoIntegra({
        integra: false,
        problemas: [{ seq: 2, entryId: "e2", problema: "assinatura-invalida", detalhe: "x" }],
      }),
    });
    expect(buscarItem(resultado.itens, "integridade-registro").status).toBe("nao_atende");
  });

  it("minimização de dados, segurança do cofre e canal de comunicação sempre atendem — controles arquiteturais", () => {
    const resultado = avaliarProntidaoLgpd({ totalEntradasAuditoria: 0, verificacaoCadeia: null });
    expect(buscarItem(resultado.itens, "minimizacao-dados").status).toBe("atende");
    expect(buscarItem(resultado.itens, "seguranca-cofre").status).toBe("atende");
    expect(buscarItem(resultado.itens, "canal-comunicacao-titular").status).toBe("atende");
  });

  it("base legal, encarregado, RIPD e comunicação de incidente são sempre fora do escopo do software", () => {
    const resultado = avaliarProntidaoLgpd({ totalEntradasAuditoria: 500, verificacaoCadeia: verificacaoIntegra() });
    expect(buscarItem(resultado.itens, "base-legal").status).toBe("fora_do_escopo");
    expect(buscarItem(resultado.itens, "encarregado").status).toBe("fora_do_escopo");
    expect(buscarItem(resultado.itens, "ripd").status).toBe("fora_do_escopo");
    expect(buscarItem(resultado.itens, "comunicacao-incidente").status).toBe("fora_do_escopo");
  });

  it("itens fora do escopo nunca entram no denominador avaliável", () => {
    const resultado = avaliarProntidaoLgpd({ totalEntradasAuditoria: 500, verificacaoCadeia: verificacaoIntegra() });
    const foraDoEscopo = resultado.itens.filter((i) => i.status === "fora_do_escopo");
    expect(foraDoEscopo.length).toBe(4);
    expect(resultado.totalAvaliavelPorSoftware).toBe(resultado.itens.length - foraDoEscopo.length);
  });

  it("cenário 'tudo verde': todos os itens avaliáveis pelo software atendem", () => {
    const resultado = avaliarProntidaoLgpd({ totalEntradasAuditoria: 500, verificacaoCadeia: verificacaoIntegra() });
    expect(resultado.totalAtende).toBe(resultado.totalAvaliavelPorSoftware);
    expect(resultado.totalAvaliavelPorSoftware).toBe(5);
  });
});
