// Gerador do Relatório de Prontidão para Regulação de IA (PDF) — EU AI Act.
//
// Mesmo padrão de `@/lib/reports/executiveReportPdf`: função pura e
// assíncrona, recebe dados já calculados (`ProntidaoAiActResultado`) e
// devolve os bytes do PDF — nenhuma leitura de rede, nenhum acesso a
// Firestore. Quem chama decide o que fazer com os bytes.
//
// Honestidade de escopo: o PDF carrega, em destaque, o mesmo aviso do
// painel — "isto não é um certificado de conformidade" — como primeira
// seção visível, não como rodapé em letra miúda. Um relatório que parece
// um selo oficial sem ser um é exatamente o tipo de confusão que o Artigo
// IV (No Invention) deste produto existe para evitar.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { ItemProntidaoAiAct, ProntidaoAiActResultado, StatusItemProntidao } from "@/lib/aiActReadiness";

/** Espelha os tokens de cor de `globals.css` — nenhuma cor nova é introduzida. */
const TOKEN = {
  ink950: hexParaRgb("#0A0F1A"),
  ink700: hexParaRgb("#202D40"),
  ink500: hexParaRgb("#59697D"),
  ink400: hexParaRgb("#7A8AA0"),
  ink100: hexParaRgb("#E4E9EE"),
  mist50: hexParaRgb("#F5F7F9"),
  white: hexParaRgb("#FFFFFF"),
  signal700: hexParaRgb("#0B3FCB"),
  signal100: hexParaRgb("#E4ECFF"),
  stateDoneInk: hexParaRgb("#1AA16B"),
  stateDoneBg: hexParaRgb("#E1F5EB"),
  stateRunInk: hexParaRgb("#FFB020"),
  stateRunBg: hexParaRgb("#FFF3DC"),
  stateError: hexParaRgb("#E5484D"),
  stateErrorBg: hexParaRgb("#FBE7E7"),
  stateIdle: hexParaRgb("#7A8AA0"),
  stateIdleBg: hexParaRgb("#EDF1F4"),
};

function hexParaRgb(hex: string): RGB {
  const limpo = hex.replace("#", "");
  const r = parseInt(limpo.slice(0, 2), 16) / 255;
  const g = parseInt(limpo.slice(2, 4), 16) / 255;
  const b = parseInt(limpo.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

const CORES_STATUS: Record<StatusItemProntidao, { tinta: RGB; fundo: RGB; rotulo: string }> = {
  atende: { tinta: TOKEN.stateDoneInk, fundo: TOKEN.stateDoneBg, rotulo: "ATENDE" },
  em_formacao: { tinta: TOKEN.stateRunInk, fundo: TOKEN.stateRunBg, rotulo: "EM FORMAÇÃO" },
  nao_atende: { tinta: TOKEN.stateError, fundo: TOKEN.stateErrorBg, rotulo: "NÃO ATENDE" },
  sem_dados: { tinta: TOKEN.stateIdle, fundo: TOKEN.stateIdleBg, rotulo: "SEM DADOS" },
  fora_do_escopo: { tinta: TOKEN.ink500, fundo: TOKEN.mist50, rotulo: "FORA DO ESCOPO" },
};

export interface RelatorioProntidaoAiActInput {
  workspaceId: string;
  resultado: ProntidaoAiActResultado;
  geradoEm: string;
  geradoPor: string;
}

const LARGURA = 595.28; // A4 retrato, em pontos.
const ALTURA = 841.89;
const MARGEM = 40;

function quebrarLinhas(texto: string, fonte: PDFFont, tamanho: number, larguraMax: number): string[] {
  const palavras = texto.split(" ");
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of palavras) {
    const candidata = atual ? `${atual} ${palavra}` : palavra;
    if (fonte.widthOfTextAtSize(candidata, tamanho) > larguraMax && atual) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = candidata;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

interface ContextoDesenho {
  documento: PDFDocument;
  page: PDFPage;
  fonteRegular: PDFFont;
  fonteNegrito: PDFFont;
  fonteMono: PDFFont;
}

function novaPagina(ctx: Pick<ContextoDesenho, "documento" | "fonteRegular" | "fonteNegrito" | "fonteMono">): ContextoDesenho {
  const page = ctx.documento.addPage([LARGURA, ALTURA]);
  return { ...ctx, page };
}

function desenharCabecalho(ctx: ContextoDesenho, input: RelatorioProntidaoAiActInput): number {
  const { page, fonteRegular, fonteNegrito, fonteMono } = ctx;
  const alturaFaixa = 92;

  page.drawRectangle({ x: 0, y: ALTURA - alturaFaixa, width: LARGURA, height: alturaFaixa, color: TOKEN.ink950 });
  page.drawText("AgentFlow", { x: MARGEM, y: ALTURA - 34, size: 12, font: fonteNegrito, color: TOKEN.signal100 });
  page.drawText("Relatório de Prontidão para Regulação de IA", {
    x: MARGEM,
    y: ALTURA - 56,
    size: 18,
    font: fonteNegrito,
    color: TOKEN.white,
  });
  page.drawText(`EU AI Act (Art. 12) · workspace ${input.workspaceId}`, {
    x: MARGEM,
    y: ALTURA - 76,
    size: 10,
    font: fonteRegular,
    color: TOKEN.ink100,
  });

  const rotuloGerado = `gerado em ${new Date(input.geradoEm).toLocaleString("pt-BR")}`;
  const largura = fonteMono.widthOfTextAtSize(rotuloGerado, 9);
  page.drawText(rotuloGerado, { x: LARGURA - MARGEM - largura, y: ALTURA - 76, size: 9, font: fonteMono, color: TOKEN.ink100 });

  return ALTURA - alturaFaixa - 24;
}

function desenharAviso(ctx: ContextoDesenho, topoY: number): number {
  const { page, fonteNegrito, fonteRegular } = ctx;
  const texto =
    "Isto não é um certificado de conformidade. É um checklist técnico dos controles que o AgentFlow já oferece, " +
    "mapeados ao Artigo 12 do AI Act (registro, integridade e retenção de eventos). Itens fora do escopo do " +
    "software continuam sendo decisão e responsabilidade do cliente e do seu jurídico.";
  const linhas = quebrarLinhas(texto, fonteRegular, 9.5, LARGURA - MARGEM * 2 - 28);
  const altura = 26 + linhas.length * 13;
  const y = topoY - altura;

  page.drawRectangle({
    x: MARGEM,
    y,
    width: LARGURA - MARGEM * 2,
    height: altura,
    borderColor: TOKEN.signal100,
    borderWidth: 1,
    color: TOKEN.mist50,
  });
  page.drawText("Leia antes de compartilhar", {
    x: MARGEM + 14,
    y: y + altura - 16,
    size: 9.5,
    font: fonteNegrito,
    color: TOKEN.ink950,
  });
  linhas.forEach((linha, i) => {
    page.drawText(linha, { x: MARGEM + 14, y: y + altura - 32 - i * 13, size: 9, font: fonteRegular, color: TOKEN.ink700 });
  });

  return y - 16;
}

function desenharResumo(ctx: ContextoDesenho, topoY: number, resultado: ProntidaoAiActResultado): number {
  const { page, fonteRegular, fonteNegrito } = ctx;
  const cartoes = [
    {
      rotulo: "CONTROLES ATENDIDOS",
      valor: `${resultado.totalAtende}/${resultado.totalAvaliavelPorSoftware}`,
      detalhe: "avaliáveis pelo software",
    },
    {
      rotulo: "RETENÇÃO DEMONSTRADA",
      valor: resultado.diasRetencaoDemonstrados !== null ? `${resultado.diasRetencaoDemonstrados} dias` : "—",
      detalhe: "mínimo exigido: 180 dias",
    },
  ];
  const gap = 12;
  const larguraCartao = (LARGURA - MARGEM * 2 - gap) / 2;
  const alturaCartao = 56;

  cartoes.forEach((cartao, i) => {
    const x = MARGEM + i * (larguraCartao + gap);
    const y = topoY - alturaCartao;
    page.drawRectangle({ x, y, width: larguraCartao, height: alturaCartao, borderColor: TOKEN.ink100, borderWidth: 1, color: TOKEN.white });
    page.drawText(cartao.rotulo, { x: x + 14, y: y + alturaCartao - 18, size: 8, font: fonteRegular, color: TOKEN.ink500 });
    page.drawText(cartao.valor, { x: x + 14, y: y + alturaCartao - 36, size: 16, font: fonteNegrito, color: TOKEN.ink950 });
    page.drawText(cartao.detalhe, { x: x + 14, y: y + 10, size: 7.5, font: fonteRegular, color: TOKEN.ink400 });
  });

  return topoY - alturaCartao - 20;
}

const ALTURA_LINHA_ESTIMADA = 60;

function desenharItem(ctx: ContextoDesenho, topoY: number, item: ItemProntidaoAiAct): { proximoY: number; altura: number } {
  const { page, fonteRegular, fonteNegrito, fonteMono } = ctx;
  const cor = CORES_STATUS[item.status];
  const larguraTexto = LARGURA - MARGEM * 2 - 110;
  const linhasDetalhe = quebrarLinhas(item.detalhe, fonteRegular, 8.5, larguraTexto);
  const altura = 36 + linhasDetalhe.length * 11;
  const y = topoY - altura;

  page.drawRectangle({ x: MARGEM, y, width: LARGURA - MARGEM * 2, height: altura, borderColor: TOKEN.ink100, borderWidth: 1, color: TOKEN.white });

  page.drawText(item.titulo, { x: MARGEM + 14, y: y + altura - 16, size: 10, font: fonteNegrito, color: TOKEN.ink950 });

  const larguraSelo = fonteNegrito.widthOfTextAtSize(cor.rotulo, 8) + 16;
  page.drawRectangle({
    x: LARGURA - MARGEM - 14 - larguraSelo,
    y: y + altura - 24,
    width: larguraSelo,
    height: 16,
    color: cor.fundo,
  });
  page.drawText(cor.rotulo, {
    x: LARGURA - MARGEM - 14 - larguraSelo + 8,
    y: y + altura - 20,
    size: 8,
    font: fonteNegrito,
    color: cor.tinta,
  });

  if (item.baseLegal) {
    page.drawText(item.baseLegal, { x: MARGEM + 14, y: y + altura - 29, size: 8, font: fonteMono, color: TOKEN.signal700 });
  }

  linhasDetalhe.forEach((linha, i) => {
    page.drawText(linha, {
      x: MARGEM + 14,
      y: y + altura - 44 - i * 11,
      size: 8.5,
      font: fonteRegular,
      color: TOKEN.ink500,
    });
  });

  return { proximoY: y - 10, altura };
}

/**
 * Gera o PDF do Relatório de Prontidão para Regulação de IA.
 *
 * Função pura e assíncrona (pdf-lib é async). Quebra em múltiplas páginas
 * automaticamente quando os itens não cabem em uma só — diferente do
 * Relatório Executivo (sempre 1 página, grade fixa), este tem uma lista de
 * tamanho variável.
 */
export async function gerarRelatorioProntidaoAiActPdf(input: RelatorioProntidaoAiActInput): Promise<Uint8Array> {
  const documento = await PDFDocument.create();
  documento.setTitle("AgentFlow — Relatório de Prontidão para Regulação de IA");
  documento.setAuthor("AgentFlow");
  documento.setSubject("EU AI Act — checklist de controles técnicos (Art. 12)");
  documento.setProducer("AgentFlow Executive Board Report Engine");

  const fontes = {
    fonteRegular: await documento.embedFont(StandardFonts.Helvetica),
    fonteNegrito: await documento.embedFont(StandardFonts.HelveticaBold),
    fonteMono: await documento.embedFont(StandardFonts.Courier),
  };

  let ctx = novaPagina({ documento, ...fontes });
  let y = desenharCabecalho(ctx, input);
  y = desenharAviso(ctx, y);
  y = desenharResumo(ctx, y, input.resultado);

  for (const item of input.resultado.itens) {
    if (y - ALTURA_LINHA_ESTIMADA < MARGEM + 30) {
      ctx = novaPagina({ documento, ...fontes });
      y = ALTURA - MARGEM;
    }
    const desenho = desenharItem(ctx, y, item);
    y = desenho.proximoY;
  }

  const rodape = `AgentFlow · relatório gerado por ${input.geradoPor} · não substitui orientação jurídica.`;
  ctx.page.drawText(rodape, { x: MARGEM, y: 24, size: 7.5, font: ctx.fonteRegular, color: TOKEN.ink400 });

  return documento.save();
}
