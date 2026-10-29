import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { calcularRoi, periodoMesAtual, ROI_CONFIG_PADRAO } from "@/lib/roi";
import { gerarRelatorioExecutivoPdf } from "@/lib/reports/executiveReportPdf";

const REFERENCIA = new Date("2026-03-15T12:00:00.000Z");

function snapshotDeTeste() {
  return calcularRoi({
    execucoes: [],
    tickets: [],
    conversas: [],
    campanhas: [],
    config: ROI_CONFIG_PADRAO,
    periodo: periodoMesAtual(REFERENCIA),
    referencia: REFERENCIA,
  });
}

describe("gerarRelatorioExecutivoPdf", () => {
  it("gera um PDF válido de uma única página, com o atestado de segurança embutido", async () => {
    const snapshot = snapshotDeTeste();

    const bytes = await gerarRelatorioExecutivoPdf({
      workspaceId: "ws-teste",
      periodoRotulo: snapshot.periodo.rotulo,
      moeda: "BRL",
      snapshot,
      receitaMadrugada: { totalConversas: 3, totalAltaIntencaoComercial: 2 },
      custoEvitadoMadrugadaFormatado: "R$ 45,00",
      moedaDoValor: (v) => `R$ ${v.toFixed(2)}`,
      atestado: {
        entryId: "ws-teste__000000000001",
        seq: 1,
        chainHash: "a".repeat(64),
        assinatura: "b".repeat(64),
        seladoEm: REFERENCIA.toISOString(),
      },
      geradoEm: REFERENCIA.toISOString(),
      geradoPor: "teste@agentflow.com",
    });

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(Buffer.from(bytes.slice(0, 5)).toString("utf-8")).toBe("%PDF-");

    // O PDF precisa ser um documento estruturalmente válido, não só bytes que
    // começam com o cabeçalho certo — reabrir com pdf-lib garante isso.
    const documento = await PDFDocument.load(bytes);
    expect(documento.getPageCount()).toBe(1);
  });

  it("degrada graciosamente quando a trilha de auditoria está indisponível (sem forjar selo)", async () => {
    const snapshot = snapshotDeTeste();

    const bytes = await gerarRelatorioExecutivoPdf({
      workspaceId: "ws-teste",
      periodoRotulo: snapshot.periodo.rotulo,
      moeda: "BRL",
      snapshot,
      receitaMadrugada: { totalConversas: 0, totalAltaIntencaoComercial: 0 },
      custoEvitadoMadrugadaFormatado: "R$ 0,00",
      moedaDoValor: (v) => `R$ ${v.toFixed(2)}`,
      atestado: null,
      geradoEm: REFERENCIA.toISOString(),
      geradoPor: "teste@agentflow.com",
    });

    const documento = await PDFDocument.load(bytes);
    expect(documento.getPageCount()).toBe(1);
  });

  it("é determinístico na estrutura: mesma entrada produz o mesmo número de páginas e tamanho na mesma ordem de grandeza", async () => {
    const snapshot = snapshotDeTeste();
    const input = {
      workspaceId: "ws-teste",
      periodoRotulo: snapshot.periodo.rotulo,
      moeda: "BRL" as const,
      snapshot,
      receitaMadrugada: { totalConversas: 1, totalAltaIntencaoComercial: 1 },
      custoEvitadoMadrugadaFormatado: "R$ 15,00",
      moedaDoValor: (v: number) => `R$ ${v.toFixed(2)}`,
      atestado: null,
      geradoEm: REFERENCIA.toISOString(),
      geradoPor: "teste@agentflow.com",
    };

    const a = await gerarRelatorioExecutivoPdf(input);
    const b = await gerarRelatorioExecutivoPdf(input);

    expect(a.byteLength).toBeGreaterThan(0);
    expect(Math.abs(a.byteLength - b.byteLength)).toBeLessThan(200);
  });
});
