import { describe, expect, it } from "vitest";
import {
  calcularDiasAtraso,
  classificarUrgenciaCobranca,
  construirResumoExecutivoCobranca,
  decidirProximaAcaoCobranca,
  gerarMensagemCobrancaHumanizada,
  MAX_TENTATIVAS_AUTOMATICAS_PADRAO,
} from "@/lib/arRecoveryEngine";
import type { DocumentoPendente } from "@/types";

const REFERENCIA = new Date("2026-03-15T12:00:00.000Z");

function documento(parcial: Partial<DocumentoPendente> = {}): DocumentoPendente {
  return {
    id: "doc-1",
    workspaceId: "ws-1",
    tipo: "fatura",
    referencia: "NF-1001",
    devedorNome: "Maria",
    devedorContato: null,
    valorBrl: null,
    vencimentoEm: "2026-03-15T12:00:00.000Z",
    status: "pendente",
    tentativasCobranca: 0,
    ultimaCobrancaEm: null,
    criadoEm: "2026-03-01T12:00:00.000Z",
    ...parcial,
  };
}

describe("calcularDiasAtraso", () => {
  it("devolve negativo quando o vencimento ainda não chegou", () => {
    const doc = documento({ vencimentoEm: "2026-03-20T12:00:00.000Z" });
    expect(calcularDiasAtraso(doc, REFERENCIA)).toBe(-5);
  });

  it("devolve 0 no próprio dia do vencimento", () => {
    expect(calcularDiasAtraso(documento(), REFERENCIA)).toBe(0);
  });

  it("devolve positivo quando já passou do vencimento", () => {
    const doc = documento({ vencimentoEm: "2026-03-01T12:00:00.000Z" });
    expect(calcularDiasAtraso(doc, REFERENCIA)).toBe(14);
  });
});

describe("classificarUrgenciaCobranca", () => {
  it("classifica os tiers nas fronteiras exatas", () => {
    expect(classificarUrgenciaCobranca(-1)).toBe("no-prazo");
    expect(classificarUrgenciaCobranca(0)).toBe("atencao");
    expect(classificarUrgenciaCobranca(7)).toBe("atencao");
    expect(classificarUrgenciaCobranca(8)).toBe("atraso");
    expect(classificarUrgenciaCobranca(30)).toBe("atraso");
    expect(classificarUrgenciaCobranca(31)).toBe("critico");
  });
});

describe("decidirProximaAcaoCobranca", () => {
  it("aguarda quando o documento já está pago/cancelado/escalado, mesmo se vencido", () => {
    const doc = documento({ status: "pago", vencimentoEm: "2026-01-01T00:00:00.000Z" });
    expect(decidirProximaAcaoCobranca(doc, REFERENCIA).acao).toBe("aguardar");
  });

  it("aguarda quando ainda está dentro do prazo", () => {
    const doc = documento({ vencimentoEm: "2026-04-01T00:00:00.000Z" });
    const decisao = decidirProximaAcaoCobranca(doc, REFERENCIA);
    expect(decisao.acao).toBe("aguardar");
    expect(decisao.nivel).toBe("no-prazo");
  });

  it("envia cobrança automática quando vencido e dentro do limite de tentativas", () => {
    const doc = documento({ vencimentoEm: "2026-03-01T00:00:00.000Z", tentativasCobranca: 0 });
    const decisao = decidirProximaAcaoCobranca(doc, REFERENCIA);
    expect(decisao.acao).toBe("enviar-cobranca");
  });

  it("escala para decisão humana quando as tentativas automáticas se esgotam", () => {
    const doc = documento({ vencimentoEm: "2026-03-01T00:00:00.000Z", tentativasCobranca: MAX_TENTATIVAS_AUTOMATICAS_PADRAO });
    const decisao = decidirProximaAcaoCobranca(doc, REFERENCIA);
    expect(decisao.acao).toBe("escalar-humano");
  });
});

describe("gerarMensagemCobrancaHumanizada", () => {
  it("nunca promete perdão/desconto/renegociação, em nenhum tier ou idioma", () => {
    const doc = documento();
    for (const nivel of ["atencao", "atraso", "critico"] as const) {
      for (const idioma of ["pt", "en"] as const) {
        const mensagem = gerarMensagemCobrancaHumanizada(doc, nivel, idioma).toLowerCase();
        expect(mensagem).not.toMatch(/desconto|discount|perdão|forgiv|renegocia/);
      }
    }
  });

  it("inclui o nome do devedor e a referência do documento", () => {
    const doc = documento({ devedorNome: "João", referencia: "NF-7788" });
    expect(gerarMensagemCobrancaHumanizada(doc, "atraso", "pt")).toContain("João");
    expect(gerarMensagemCobrancaHumanizada(doc, "atraso", "pt")).toContain("NF-7788");
  });

  it("endurece o tom conforme a urgência cresce", () => {
    const doc = documento();
    expect(gerarMensagemCobrancaHumanizada(doc, "atencao", "pt")).toMatch(/lembrar/i);
    expect(gerarMensagemCobrancaHumanizada(doc, "critico", "pt")).toMatch(/atraso significativo/i);
  });
});

describe("construirResumoExecutivoCobranca", () => {
  it("monta o card com faixa de valor por extenso, nunca o valor exato", () => {
    const doc = documento({ valorBrl: 25_000 });
    const resumo = construirResumoExecutivoCobranca(doc, 10);
    expect(resumo.devedorNome).toBe("Maria");
    expect(resumo.diasAtraso).toBe(10);
    expect(resumo.faixaValor).toBe("entre R$ 10 mil e R$ 50 mil");
    expect(resumo.faixaValor).not.toContain("25.000");
  });

  it("deixa faixaValor null quando o valor não foi informado — nunca inventado", () => {
    const resumo = construirResumoExecutivoCobranca(documento({ valorBrl: null }), 10);
    expect(resumo.faixaValor).toBeNull();
  });
});
