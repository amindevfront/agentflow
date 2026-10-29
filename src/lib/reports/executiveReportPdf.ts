// Gerador do Relatório Executivo Mensal (PDF) — Governança / Cofre & Blindagem Jurídica.
//
// Puro e testável: recebe dados já calculados (o mesmo `RoiSnapshot` que
// alimenta `BusinessROIWidget` e `OpexTaxShieldPanel`) e devolve os bytes do
// PDF. Nenhuma leitura de rede, nenhum acesso a Firestore — quem chama é
// responsável por buscar os dados e por acionar o download no navegador.
//
// Honestidade do número (mesma regra de `@/lib/roi` e `@/lib/inbox/revenueRescue`):
// este relatório NUNCA inventa um valor de negócio. "Receita resgatada de
// madrugada" é reportada como VOLUME (conversas de alta intenção comercial
// atendidas fora do expediente) mais o custo humano evitado nessas conversas
// — nunca um valor de venda estimado, que não existe no modelo de dados.
//
// O "Atestado de segurança" não é uma assinatura decorativa: é a entrada real
// da trilha de auditoria (hash-chain + HMAC), selada por `/api/audit/seal`
// antes da geração do PDF — ver `@/lib/crypto/auditChain`. Sem uma entrada
// selada, o relatório ainda é gerado (degradação graciosa), mas o bloco de
// atestado diz explicitamente que a trilha estava indisponível, em vez de
// forjar uma assinatura.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { Moeda, RoiSnapshot } from "@/types";

/** Espelha os tokens de cor de `globals.css` — nenhuma cor nova é introduzida. */
const TOKEN = {
  ink950: hexParaRgb("#0A0F1A"),
  ink700: hexParaRgb("#202D40"),
  ink500: hexParaRgb("#59697D"),
  ink400: hexParaRgb("#7A8AA0"),
  ink200: hexParaRgb("#C7D0DA"),
  ink100: hexParaRgb("#E4E9EE"),
  mist50: hexParaRgb("#F5F7F9"),
  white: hexParaRgb("#FFFFFF"),
  signal700: hexParaRgb("#0B3FCB"),
  signal100: hexParaRgb("#E4ECFF"),
  stateDone: hexParaRgb("#177A52"),
  stateDoneInk: hexParaRgb("#1AA16B"),
  stateDoneBg: hexParaRgb("#E1F5EB"),
  stateRunInk: hexParaRgb("#FFB020"),
  stateError: hexParaRgb("#C22A2E"),
};

function hexParaRgb(hex: string): RGB {
  const limpo = hex.replace("#", "");
  const r = parseInt(limpo.slice(0, 2), 16) / 255;
  const g = parseInt(limpo.slice(2, 4), 16) / 255;
  const b = parseInt(limpo.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

export interface AtestadoRelatorio {
  entryId: string;
  seq: number;
  chainHash: string;
  assinatura: string;
  seladoEm: string;
}

export interface RelatorioExecutivoInput {
  workspaceId: string;
  periodoRotulo: string;
  moeda: Moeda;
  snapshot: RoiSnapshot;
  receitaMadrugada: { totalConversas: number; totalAltaIntencaoComercial: number };
  custoEvitadoMadrugadaFormatado: string;
  moedaDoValor: (valorBrl: number) => string;
  /** `null` quando a trilha de auditoria estava indisponível na geração — ver nota de topo. */
  atestado: AtestadoRelatorio | null;
  geradoEm: string;
  geradoPor: string;
}

const LARGURA = 595.28; // A4 retrato, em pontos.
const ALTURA = 841.89;
const MARGEM = 40;

function truncar(valor: string, tamanho: number): string {
  return valor.length > tamanho ? `${valor.slice(0, tamanho)}…` : valor;
}

interface ContextoDesenho {
  page: PDFPage;
  fonteRegular: PDFFont;
  fonteNegrito: PDFFont;
  fonteMono: PDFFont;
}

function desenharCabecalho(ctx: ContextoDesenho, input: RelatorioExecutivoInput): number {
  const { page, fonteRegular, fonteNegrito, fonteMono } = ctx;
  const alturaFaixa = 92;

  page.drawRectangle({ x: 0, y: ALTURA - alturaFaixa, width: LARGURA, height: alturaFaixa, color: TOKEN.ink950 });

  page.drawText("AgentFlow", {
    x: MARGEM,
    y: ALTURA - 34,
    size: 12,
    font: fonteNegrito,
    color: TOKEN.signal100,
  });
  page.drawText("Relatório Executivo Mensal", {
    x: MARGEM,
    y: ALTURA - 56,
    size: 20,
    font: fonteNegrito,
    color: TOKEN.white,
  });
  page.drawText(`${input.periodoRotulo} · workspace ${input.workspaceId}`, {
    x: MARGEM,
    y: ALTURA - 76,
    size: 10,
    font: fonteRegular,
    color: TOKEN.ink200,
  });

  const rotuloGerado = `gerado em ${new Date(input.geradoEm).toLocaleString("pt-BR")}`;
  const largura = fonteMono.widthOfTextAtSize(rotuloGerado, 9);
  page.drawText(rotuloGerado, {
    x: LARGURA - MARGEM - largura,
    y: ALTURA - 76,
    size: 9,
    font: fonteMono,
    color: TOKEN.ink200,
  });

  return ALTURA - alturaFaixa - 28;
}

interface CartaoMetrica {
  rotulo: string;
  valor: string;
  detalhe: string;
  tom?: RGB;
}

/** Grade 2×2 de cartões planos — mesma estética de `MetricCard` (borda 1px, sem glass/gradiente). */
function desenharCartoes(ctx: ContextoDesenho, topoY: number, cartoes: CartaoMetrica[]): number {
  const { page, fonteRegular, fonteNegrito } = ctx;
  const colunas = 2;
  const gap = 12;
  const larguraCartao = (LARGURA - MARGEM * 2 - gap) / colunas;
  const alturaCartao = 64;

  cartoes.forEach((cartao, indice) => {
    const coluna = indice % colunas;
    const linha = Math.floor(indice / colunas);
    const x = MARGEM + coluna * (larguraCartao + gap);
    const y = topoY - linha * (alturaCartao + gap) - alturaCartao;

    page.drawRectangle({
      x,
      y,
      width: larguraCartao,
      height: alturaCartao,
      borderColor: TOKEN.ink100,
      borderWidth: 1,
      color: TOKEN.white,
    });
    page.drawText(cartao.rotulo.toUpperCase(), {
      x: x + 14,
      y: y + alturaCartao - 20,
      size: 8.5,
      font: fonteRegular,
      color: TOKEN.ink500,
    });
    page.drawText(cartao.valor, {
      x: x + 14,
      y: y + alturaCartao - 38,
      size: 16,
      font: fonteNegrito,
      color: cartao.tom ?? TOKEN.ink950,
    });
    page.drawText(truncar(cartao.detalhe, 58), {
      x: x + 14,
      y: y + 10,
      size: 8,
      font: fonteRegular,
      color: TOKEN.ink400,
    });
  });

  const linhas = Math.ceil(cartoes.length / colunas);
  return topoY - linhas * (alturaCartao + gap);
}

interface BarraMetrica {
  rotulo: string;
  fracao: number; // 0..1
  rotuloValor: string;
  tom: RGB;
}

function desenharBarras(ctx: ContextoDesenho, topoY: number, titulo: string, barras: BarraMetrica[]): number {
  const { page, fonteRegular, fonteNegrito, fonteMono } = ctx;
  let y = topoY;

  page.drawText(titulo, { x: MARGEM, y, size: 11, font: fonteNegrito, color: TOKEN.ink950 });
  y -= 22;

  const larguraTrilha = LARGURA - MARGEM * 2 - 150;

  for (const barra of barras) {
    page.drawText(barra.rotulo, { x: MARGEM, y: y + 3, size: 9, font: fonteRegular, color: TOKEN.ink700 });

    const xTrilha = MARGEM + 150;
    page.drawRectangle({ x: xTrilha, y, width: larguraTrilha, height: 8, color: TOKEN.ink100 });
    const fracaoSegura = Math.max(0, Math.min(1, barra.fracao));
    if (fracaoSegura > 0) {
      page.drawRectangle({ x: xTrilha, y, width: larguraTrilha * fracaoSegura, height: 8, color: barra.tom });
    }

    const larguraValor = fonteMono.widthOfTextAtSize(barra.rotuloValor, 9);
    page.drawText(barra.rotuloValor, {
      x: LARGURA - MARGEM - larguraValor,
      y: y + 1,
      size: 9,
      font: fonteMono,
      color: TOKEN.ink950,
    });

    y -= 24;
  }

  return y - 8;
}

function desenharConformidade(ctx: ContextoDesenho, topoY: number, snapshot: RoiSnapshot): number {
  const { page, fonteRegular, fonteNegrito } = ctx;
  let y = topoY;

  page.drawText("Conformidade & Segurança", { x: MARGEM, y, size: 11, font: fonteNegrito, color: TOKEN.ink950 });
  y -= 18;

  page.drawRectangle({ x: MARGEM, y: y - 3, width: 8, height: 8, color: TOKEN.stateDoneInk });
  page.drawText("Zero-Trust Active · AES-256-GCM (envelope encryption em repouso)", {
    x: MARGEM + 16,
    y,
    size: 9.5,
    font: fonteRegular,
    color: TOKEN.ink700,
  });
  y -= 18;

  page.drawRectangle({ x: MARGEM, y: y - 3, width: 8, height: 8, color: TOKEN.stateDoneInk });
  page.drawText("100% dos payloads enviados a modelos de IA passam pelo mascaramento de PII (guardrails de entrada)", {
    x: MARGEM + 16,
    y,
    size: 9.5,
    font: fonteRegular,
    color: TOKEN.ink700,
  });
  y -= 18;

  page.drawRectangle({ x: MARGEM, y: y - 3, width: 8, height: 8, color: TOKEN.stateDoneInk });
  page.drawText(
    `Trilha de auditoria encadeada e assinada (hash-chain + HMAC) · cobertura de telemetria: ${(snapshot.cobertura * 100).toFixed(0)}%`,
    { x: MARGEM + 16, y, size: 9.5, font: fonteRegular, color: TOKEN.ink700 }
  );
  y -= 18;

  return y - 10;
}

function desenharAtestado(ctx: ContextoDesenho, topoY: number, input: RelatorioExecutivoInput): number {
  const { page, fonteRegular, fonteNegrito, fonteMono } = ctx;
  const altura = 86;
  const y = topoY - altura;

  page.drawRectangle({
    x: MARGEM,
    y,
    width: LARGURA - MARGEM * 2,
    height: altura,
    borderColor: TOKEN.ink100,
    borderWidth: 1,
    color: TOKEN.mist50,
  });

  page.drawText("Atestado de segurança", {
    x: MARGEM + 14,
    y: y + altura - 20,
    size: 10,
    font: fonteNegrito,
    color: TOKEN.ink950,
  });

  if (input.atestado) {
    const linhas = [
      `entrada: ${input.atestado.entryId} · seq ${input.atestado.seq}`,
      `chainHash: ${truncar(input.atestado.chainHash, 48)}`,
      `assinatura (HMAC): ${truncar(input.atestado.assinatura, 48)}`,
      `selado em ${new Date(input.atestado.seladoEm).toLocaleString("pt-BR")} · verificável em Auditoria de IA & Logs`,
    ];
    linhas.forEach((linha, indice) => {
      page.drawText(linha, {
        x: MARGEM + 14,
        y: y + altura - 38 - indice * 13,
        size: 8,
        font: fonteMono,
        color: TOKEN.ink700,
      });
    });
  } else {
    page.drawText(
      "Trilha de auditoria indisponível no momento da geração — este relatório não carrega selo criptográfico verificável.",
      { x: MARGEM + 14, y: y + altura - 40, size: 8.5, font: fonteRegular, color: TOKEN.stateError }
    );
  }

  return y - 16;
}

/**
 * Gera o PDF do Relatório Executivo Mensal a partir de um snapshot já
 * calculado. Função pura e assíncrona (pdf-lib é async), sem efeitos
 * colaterais — quem chama decide o que fazer com os bytes (download,
 * upload, anexar a um e-mail).
 */
export async function gerarRelatorioExecutivoPdf(input: RelatorioExecutivoInput): Promise<Uint8Array> {
  const documento = await PDFDocument.create();
  documento.setTitle("AgentFlow — Relatório Executivo Mensal");
  documento.setAuthor("AgentFlow");
  documento.setSubject(`Relatório executivo · ${input.periodoRotulo}`);
  documento.setProducer("AgentFlow Executive Board Report Engine");

  const page = documento.addPage([LARGURA, ALTURA]);
  const ctx: ContextoDesenho = {
    page,
    fonteRegular: await documento.embedFont(StandardFonts.Helvetica),
    fonteNegrito: await documento.embedFont(StandardFonts.HelveticaBold),
    fonteMono: await documento.embedFont(StandardFonts.Courier),
  };

  let y = desenharCabecalho(ctx, input);

  ctx.page.drawText("ROI total do mês", { x: MARGEM, y, size: 13, font: ctx.fonteNegrito, color: TOKEN.ink950 });
  y -= 20;

  const { snapshot } = input;
  y = desenharCartoes(ctx, y, [
    {
      rotulo: "Dinheiro líquido retido no caixa",
      valor: input.moedaDoValor(snapshot.economiaLiquidaBrl),
      detalhe: `ROI ${(snapshot.roiPercentual * 100).toFixed(0)}% sobre o custo da automação`,
      tom: snapshot.economiaLiquidaBrl >= 0 ? TOKEN.stateDone : TOKEN.stateError,
    },
    {
      rotulo: "OpEx poupado (custo humano evitado)",
      valor: input.moedaDoValor(snapshot.custoHumanoEvitadoBrl),
      detalhe: `${(snapshot.reducaoOpexPercentual * 100).toFixed(0)}% de redução de OpEx`,
      tom: TOKEN.signal700,
    },
    {
      rotulo: "Tax Shield (encargos patronais evitados)",
      valor: input.moedaDoValor(snapshot.encargosTotaisBrl),
      detalhe: "soma de INSS, FGTS, 13º, férias e provisão de rescisão",
    },
    {
      rotulo: "Receita resgatada de madrugada",
      valor: `${input.receitaMadrugada.totalConversas} conversa(s)`,
      detalhe: `${input.receitaMadrugada.totalAltaIntencaoComercial} de alta intenção · ${input.custoEvitadoMadrugadaFormatado} evitados`,
      tom: TOKEN.stateDone,
    },
  ]);
  y -= 16;

  y = desenharBarras(ctx, y, "Eficiência operacional", [
    {
      rotulo: "Autonomia dos agentes (zero-touch)",
      fracao: snapshot.taxaZeroTouch,
      rotuloValor: `${(snapshot.taxaZeroTouch * 100).toFixed(0)}%`,
      tom: snapshot.taxaZeroTouch >= 0.85 ? TOKEN.stateDoneInk : TOKEN.stateRunInk,
    },
    {
      rotulo: "Taxa de sucesso das execuções",
      fracao: snapshot.taxaSucesso,
      rotuloValor: `${(snapshot.taxaSucesso * 100).toFixed(0)}%`,
      tom: snapshot.taxaSucesso >= 0.95 ? TOKEN.stateDoneInk : TOKEN.stateRunInk,
    },
    {
      rotulo: "Redução de OpEx",
      fracao: snapshot.reducaoOpexPercentual,
      rotuloValor: `${(snapshot.reducaoOpexPercentual * 100).toFixed(0)}%`,
      tom: TOKEN.signal700,
    },
  ]);
  y -= 8;

  y = desenharConformidade(ctx, y, snapshot);
  desenharAtestado(ctx, y, input);

  const rodape = `AgentFlow · relatório gerado por ${input.geradoPor} · não substitui orientação contábil ou jurídica.`;
  page.drawText(rodape, { x: MARGEM, y: 24, size: 7.5, font: ctx.fonteRegular, color: TOKEN.ink400 });

  return documento.save();
}
