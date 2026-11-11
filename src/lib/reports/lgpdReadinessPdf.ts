// Gerador do Relatório de Prontidão para Regulação Brasileira (PDF) — LGPD.
//
// Mesmo padrão de `@/lib/reports/aiActReadinessPdf`: função pura e
// assíncrona, recebe dados já calculados (`ProntidaoLgpdResultado`) e
// devolve os bytes do PDF — nenhuma leitura de rede, nenhum acesso a
// Firestore. Quem chama decide o que fazer com os bytes.
//
// Honestidade de escopo: o PDF carrega, em destaque, o mesmo aviso do
// painel — "isto não é um certificado de conformidade" — como primeira
// seção visível, não como rodapé em letra miúda.

import { PDFDocument, StandardFonts, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { ItemProntidaoLgpd, ProntidaoLgpdResultado, StatusItemProntidaoLgpd } from "@/lib/lgpdReadiness";
import { MARGEM_PADRAO as MARGEM, ALTURA_A4 as ALTURA, LARGURA_A4 as LARGURA, TOKEN, quebrarLinhas } from "./pdfDesignTokens";

/**
 * Forma estrutural genérica de um checklist de prontidão regulatória —
 * `ProntidaoLgpdResultado` (LGPD) e `ProntidaoInternacionalResultado`
 * (GDPR/US Privacy, `@/lib/internationalReadiness`) já têm exatamente este
 * formato, então este desenhador de PDF é reaproveitado por ambos em vez de
 * duplicado — mesmo racional de `OPCOES_MOEDA` centralizado em `@/lib/roi`:
 * uma única fonte de verdade para o desenho, nunca um segundo arquivo quase
 * idêntico por regime regulatório.
 */
export interface ItemProntidaoGenerico {
  id: string;
  titulo: string;
  baseLegal: string | null;
  status: StatusItemProntidaoLgpd;
  detalhe: string;
}
export interface ProntidaoGenericaResultado {
  itens: ItemProntidaoGenerico[];
  totalAtende: number;
  totalAvaliavelPorSoftware: number;
}

const CORES_STATUS: Record<StatusItemProntidaoLgpd, { tinta: RGB; fundo: RGB; rotulo: string }> = {
  atende: { tinta: TOKEN.stateDoneInk, fundo: TOKEN.stateDoneBg, rotulo: "ATENDE" },
  nao_atende: { tinta: TOKEN.stateError, fundo: TOKEN.stateErrorBg, rotulo: "NÃO ATENDE" },
  sem_dados: { tinta: TOKEN.stateIdle, fundo: TOKEN.stateIdleBg, rotulo: "SEM DADOS" },
  fora_do_escopo: { tinta: TOKEN.ink500, fundo: TOKEN.mist50, rotulo: "FORA DO ESCOPO" },
};

export interface RelatorioProntidaoLgpdInput {
  workspaceId: string;
  resultado: ProntidaoLgpdResultado;
  geradoEm: string;
  geradoPor: string;
}

/** Versão genérica de `RelatorioProntidaoLgpdInput` — aceita qualquer regime regulatório, não só LGPD. */
export interface RelatorioProntidaoGenericoInput {
  workspaceId: string;
  resultado: ProntidaoGenericaResultado;
  geradoEm: string;
  geradoPor: string;
  /** Ex.: "Relatório de Prontidão — GDPR (União Europeia)". */
  tituloRelatorio: string;
  /** Linha curta sob o título, ex.: "GDPR — Regulamento (UE) 2016/679 · workspace {id}" (sem o workspaceId, que é concatenado automaticamente). */
  subtituloRegime: string;
  /** Texto completo do aviso "isto não é um certificado de conformidade", já adaptado ao regime. */
  textoAviso: string;
  /** Metadados do PDF (título/assunto do documento, não o texto desenhado). */
  tituloDocumento: string;
  assuntoDocumento: string;
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

function desenharCabecalho(
  ctx: ContextoDesenho,
  input: { workspaceId: string; geradoEm: string },
  tituloRelatorio: string,
  subtituloRegime: string
): number {
  const { page, fonteRegular, fonteNegrito, fonteMono } = ctx;
  const alturaFaixa = 92;

  page.drawRectangle({ x: 0, y: ALTURA - alturaFaixa, width: LARGURA, height: alturaFaixa, color: TOKEN.ink950 });
  page.drawText("AgentFlow", { x: MARGEM, y: ALTURA - 34, size: 12, font: fonteNegrito, color: TOKEN.signal100 });
  page.drawText(tituloRelatorio, {
    x: MARGEM,
    y: ALTURA - 56,
    size: 18,
    font: fonteNegrito,
    color: TOKEN.white,
  });
  page.drawText(`${subtituloRegime} · workspace ${input.workspaceId}`, {
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

function desenharAviso(ctx: ContextoDesenho, topoY: number, texto: string): number {
  const { page, fonteNegrito, fonteRegular } = ctx;
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

function desenharResumo(ctx: ContextoDesenho, topoY: number, resultado: ProntidaoGenericaResultado): number {
  const { page, fonteRegular, fonteNegrito } = ctx;
  const alturaCartao = 56;
  const x = MARGEM;
  const y = topoY - alturaCartao;
  const largura = LARGURA - MARGEM * 2;

  page.drawRectangle({ x, y, width: largura, height: alturaCartao, borderColor: TOKEN.ink100, borderWidth: 1, color: TOKEN.white });
  page.drawText("CONTROLES TÉCNICOS ATENDIDOS", { x: x + 14, y: y + alturaCartao - 18, size: 8, font: fonteRegular, color: TOKEN.ink500 });
  page.drawText(`${resultado.totalAtende}/${resultado.totalAvaliavelPorSoftware}`, {
    x: x + 14,
    y: y + alturaCartao - 36,
    size: 16,
    font: fonteNegrito,
    color: TOKEN.ink950,
  });
  page.drawText("avaliáveis pelo software, exclui itens fora do escopo", {
    x: x + 14,
    y: y + 10,
    size: 7.5,
    font: fonteRegular,
    color: TOKEN.ink400,
  });

  return y - 20;
}

const ALTURA_LINHA_ESTIMADA = 60;

function desenharItem(ctx: ContextoDesenho, topoY: number, item: ItemProntidaoGenerico): { proximoY: number } {
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

  return { proximoY: y - 10 };
}

/**
 * Gera o PDF de um checklist de prontidão regulatória — núcleo genérico
 * reaproveitado por LGPD, GDPR e US Privacy (`@/lib/internationalReadiness`).
 *
 * Função pura e assíncrona (pdf-lib é async). Quebra em múltiplas páginas
 * automaticamente quando os itens não cabem em uma só.
 */
export async function gerarRelatorioProntidaoPdf(input: RelatorioProntidaoGenericoInput): Promise<Uint8Array> {
  const documento = await PDFDocument.create();
  documento.setTitle(input.tituloDocumento);
  documento.setAuthor("AgentFlow");
  documento.setSubject(input.assuntoDocumento);
  documento.setProducer("AgentFlow Executive Board Report Engine");

  const fontes = {
    fonteRegular: await documento.embedFont(StandardFonts.Helvetica),
    fonteNegrito: await documento.embedFont(StandardFonts.HelveticaBold),
    fonteMono: await documento.embedFont(StandardFonts.Courier),
  };

  let ctx = novaPagina({ documento, ...fontes });
  let y = desenharCabecalho(ctx, input, input.tituloRelatorio, input.subtituloRegime);
  y = desenharAviso(ctx, y, input.textoAviso);
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

const AVISO_LGPD =
  "Isto não é um certificado de conformidade. É um checklist técnico dos controles que o AgentFlow já oferece, " +
  "mapeados a obrigações da LGPD (registro de operações, segurança, minimização de dados). Itens fora do escopo " +
  "do software continuam sendo decisão e responsabilidade do controlador — o cliente.";

/**
 * Gera o PDF do Relatório de Prontidão para Regulação Brasileira (LGPD).
 *
 * Wrapper fino sobre `gerarRelatorioProntidaoPdf` — mantém a assinatura e o
 * conteúdo exatos de antes da generalização, para que nenhum chamador
 * existente (`LgpdReadinessPanel`) precise mudar.
 */
export async function gerarRelatorioProntidaoLgpdPdf(input: RelatorioProntidaoLgpdInput): Promise<Uint8Array> {
  return gerarRelatorioProntidaoPdf({
    ...input,
    tituloRelatorio: "Relatório de Prontidão para Regulação Brasileira",
    subtituloRegime: "LGPD — Lei 13.709/2018",
    textoAviso: AVISO_LGPD,
    tituloDocumento: "AgentFlow — Relatório de Prontidão para Regulação Brasileira (LGPD)",
    assuntoDocumento: "LGPD — checklist de controles técnicos",
  });
}
