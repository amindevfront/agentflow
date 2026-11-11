// Gerador do PDF do Sales Impact Engine — "Proposta de Governança e Impacto".
//
// Função pura e assíncrona (pdf-lib é async), mesmo padrão de
// `gerarRelatorioProntidaoPdf`: recebe números JÁ CALCULADOS (nunca refaz
// conta aqui) e devolve os bytes do PDF. Reaproveita os tokens de cor e o
// quebrador de linha de `./pdfDesignTokens` — mesma fonte visual de todo
// gerador de PDF do AgentFlow, nunca uma paleta nova por relatório.
//
// Honestidade de escopo, mesmo princípio dos relatórios de prontidão: o
// rodapé deixa explícito que isto é uma ESTIMATIVA comercial com parâmetros
// ajustáveis pelo vendedor, não um relatório de dados reais de produção
// (esses vivem em Governança → Oportunidade & Pipeline, calculados a partir
// de execuções de fato registradas).

import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { ALTURA_A4 as ALTURA, LARGURA_A4 as LARGURA, MARGEM_PADRAO as MARGEM, TOKEN, quebrarLinhas } from "./pdfDesignTokens";

export interface PropostaImpactoInput {
  nomeProspect?: string;
  geradoEm: string;
  geradoPor: string;
  /** Já formatados na moeda de apresentação escolhida (ex.: "R$ 12.400,00") — este módulo nunca formata moeda, só desenha texto pronto. */
  moedaLabel: string;
  leadsPerdidosNoite: number;
  leadsMensaisPerdidos: number;
  ticketMedioFormatado: string;
  taxaConversaoPercentual: number;
  visitantesMensaisSite?: number | null;
  receitaRecuperadaMensalFormatada: string;
  receitaRecuperadaAnualFormatada: string;
  planoLabel: string;
  planoDescricao: string;
  setupFormatado: string;
  mrrFormatado: string;
  mesesProjecao: number;
  custoTotalFormatado: string;
  ganhoTotalFormatado: string;
  lucroLiquidoFormatado: string;
  roiPercentualFormatado: string;
  paybackLabel: string;
  argumentoExecutivo: string;
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

function desenharCabecalho(ctx: ContextoDesenho, input: PropostaImpactoInput): number {
  const { page, fonteRegular, fonteNegrito, fonteMono } = ctx;
  const alturaFaixa = 92;

  page.drawRectangle({ x: 0, y: ALTURA - alturaFaixa, width: LARGURA, height: alturaFaixa, color: TOKEN.ink950 });
  page.drawText("AgentFlow", { x: MARGEM, y: ALTURA - 34, size: 12, font: fonteNegrito, color: TOKEN.signal100 });
  page.drawText("Proposta de Governança e Impacto Comercial", {
    x: MARGEM,
    y: ALTURA - 56,
    size: 18,
    font: fonteNegrito,
    color: TOKEN.white,
  });
  page.drawText(
    input.nomeProspect ? `Preparado para ${input.nomeProspect}` : "Simulação de impacto comercial",
    { x: MARGEM, y: ALTURA - 76, size: 10, font: fonteRegular, color: TOKEN.ink100 }
  );

  const rotuloGerado = `gerado em ${new Date(input.geradoEm).toLocaleString("pt-BR")} · ${input.moedaLabel}`;
  const largura = fonteMono.widthOfTextAtSize(rotuloGerado, 9);
  page.drawText(rotuloGerado, { x: LARGURA - MARGEM - largura, y: ALTURA - 76, size: 9, font: fonteMono, color: TOKEN.ink100 });

  return ALTURA - alturaFaixa - 24;
}

/** Card de destaque com um número grande — mesmo padrão visual do `MetricCard` da UI. */
function desenharCardDestaque(
  ctx: ContextoDesenho,
  x: number,
  y: number,
  largura: number,
  rotulo: string,
  valor: string,
  detalhe: string,
  corValor = TOKEN.ink950
): void {
  const { page, fonteRegular, fonteNegrito } = ctx;
  const altura = 68;
  page.drawRectangle({ x, y: y - altura, width: largura, height: altura, borderColor: TOKEN.ink100, borderWidth: 1, color: TOKEN.white });
  page.drawText(rotulo.toUpperCase(), { x: x + 12, y: y - 18, size: 7.5, font: fonteRegular, color: TOKEN.ink500 });
  page.drawText(valor, { x: x + 12, y: y - 40, size: 16, font: fonteNegrito, color: corValor });
  const linhasDetalhe = quebrarLinhas(detalhe, fonteRegular, 7.5, largura - 24);
  page.drawText(linhasDetalhe[0] ?? "", { x: x + 12, y: y - 56, size: 7.5, font: fonteRegular, color: TOKEN.ink400 });
}

function desenharSecaoParametros(ctx: ContextoDesenho, topoY: number, input: PropostaImpactoInput): number {
  const { page, fonteNegrito, fonteRegular } = ctx;
  let y = topoY;
  page.drawText("Parâmetros informados pelo implementador", { x: MARGEM, y, size: 12, font: fonteNegrito, color: TOKEN.ink950 });
  y -= 20;

  const linhas = [
    `Leads perdidos por noite (fora do horário comercial): ${input.leadsPerdidosNoite} — ${input.leadsMensaisPerdidos} leads/mês`,
    `Ticket médio do produto/serviço: ${input.ticketMedioFormatado}`,
    `Taxa de conversão estimada da IA: ${input.taxaConversaoPercentual}%`,
    ...(input.visitantesMensaisSite ? [`Visitantes mensais no site (contexto): ${input.visitantesMensaisSite}`] : []),
  ];
  for (const linha of linhas) {
    page.drawText(`• ${linha}`, { x: MARGEM, y, size: 9.5, font: fonteRegular, color: TOKEN.ink700 });
    y -= 15;
  }
  return y - 10;
}

function desenharSecaoImpacto(ctx: ContextoDesenho, topoY: number, input: PropostaImpactoInput): number {
  const { page, fonteNegrito } = ctx;
  let y = topoY;
  page.drawText("Impacto financeiro estimado (sem o AgentFlow)", { x: MARGEM, y, size: 12, font: fonteNegrito, color: TOKEN.ink950 });
  y -= 14;

  const larguraCard = (LARGURA - MARGEM * 2 - 16) / 2;
  desenharCardDestaque(ctx, MARGEM, y, larguraCard, "Receita perdida por mês", input.receitaRecuperadaMensalFormatada, "estimativa, parâmetros ajustáveis", TOKEN.stateError);
  desenharCardDestaque(ctx, MARGEM + larguraCard + 16, y, larguraCard, "Receita perdida por ano", input.receitaRecuperadaAnualFormatada, "projeção em 12 meses", TOKEN.stateError);

  void page;
  return y - 68 - 20;
}

function desenharSecaoRoi(ctx: ContextoDesenho, topoY: number, input: PropostaImpactoInput): number {
  const { page, fonteNegrito, fonteRegular } = ctx;
  let y = topoY;
  page.drawText(`ROI projetado do contrato — plano ${input.planoLabel}`, { x: MARGEM, y, size: 12, font: fonteNegrito, color: TOKEN.ink950 });
  y -= 14;
  page.drawText(input.planoDescricao, { x: MARGEM, y, size: 8.5, font: fonteRegular, color: TOKEN.ink500 });
  y -= 18;

  const larguraCard = (LARGURA - MARGEM * 2 - 32) / 3;
  desenharCardDestaque(ctx, MARGEM, y, larguraCard, `Custo em ${input.mesesProjecao} meses`, input.custoTotalFormatado, `setup ${input.setupFormatado} + MRR ${input.mrrFormatado}`);
  desenharCardDestaque(ctx, MARGEM + larguraCard + 16, y, larguraCard, `Ganho em ${input.mesesProjecao} meses`, input.ganhoTotalFormatado, "receita recuperada acumulada", TOKEN.stateDoneInk);
  desenharCardDestaque(
    ctx,
    MARGEM + (larguraCard + 16) * 2,
    y,
    larguraCard,
    "ROI no período",
    input.roiPercentualFormatado,
    `payback: ${input.paybackLabel}`,
    TOKEN.signal700
  );

  y -= 68 + 16;
  page.drawText(`Lucro líquido projetado: ${input.lucroLiquidoFormatado}`, {
    x: MARGEM,
    y,
    size: 10,
    font: fonteNegrito,
    color: TOKEN.ink950,
  });
  return y - 24;
}

function desenharArgumento(ctx: ContextoDesenho, topoY: number, input: PropostaImpactoInput): number {
  const { page, fonteNegrito, fonteRegular } = ctx;
  const linhas = quebrarLinhas(input.argumentoExecutivo, fonteRegular, 10, LARGURA - MARGEM * 2 - 28);
  const altura = 30 + linhas.length * 14;
  const y = topoY - altura;

  page.drawRectangle({ x: MARGEM, y, width: LARGURA - MARGEM * 2, height: altura, borderColor: TOKEN.signal100, borderWidth: 1, color: TOKEN.signal100 });
  page.drawText("Argumento executivo", { x: MARGEM + 14, y: y + altura - 16, size: 9.5, font: fonteNegrito, color: TOKEN.signal700 });
  linhas.forEach((linha, i) => {
    page.drawText(linha, { x: MARGEM + 14, y: y + altura - 32 - i * 14, size: 9.5, font: fonteRegular, color: TOKEN.ink700 });
  });
  return y - 16;
}

/**
 * Gera o PDF da Proposta de Governança e Impacto — todos os números já
 * formatados na moeda escolhida chegam prontos (este módulo nunca calcula
 * nem formata moeda, só desenha).
 */
export async function gerarPropostaImpactoPdf(input: PropostaImpactoInput): Promise<Uint8Array> {
  const documento = await PDFDocument.create();
  documento.setTitle("AgentFlow — Proposta de Governança e Impacto Comercial");
  documento.setAuthor("AgentFlow");
  documento.setSubject("Simulador de Impacto Comercial — ROI projetado de contrato");
  documento.setProducer("AgentFlow Executive Board Report Engine");

  const fontes = {
    fonteRegular: await documento.embedFont(StandardFonts.Helvetica),
    fonteNegrito: await documento.embedFont(StandardFonts.HelveticaBold),
    fonteMono: await documento.embedFont(StandardFonts.Courier),
  };

  const ctx = novaPagina({ documento, ...fontes });
  let y = desenharCabecalho(ctx, input);
  y = desenharSecaoParametros(ctx, y, input);
  y = desenharSecaoImpacto(ctx, y, input);
  y = desenharSecaoRoi(ctx, y, input);
  y = desenharArgumento(ctx, y, input);

  const rodape =
    `AgentFlow · relatório gerado por ${input.geradoPor} · estimativa comercial com parâmetros ajustáveis — ` +
    "não substitui o Relatório Executivo de dados reais de produção (Governança).";
  const linhasRodape = quebrarLinhas(rodape, ctx.fonteRegular, 7.5, LARGURA - MARGEM * 2);
  linhasRodape.forEach((linha, i) => {
    ctx.page.drawText(linha, { x: MARGEM, y: 24 - i * 10, size: 7.5, font: ctx.fonteRegular, color: TOKEN.ink400 });
  });

  return documento.save();
}
