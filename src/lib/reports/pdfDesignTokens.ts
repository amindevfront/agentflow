// Tokens de cor e helpers de desenho compartilhados por TODO gerador de PDF
// do AgentFlow — extraído de `lgpdReadinessPdf.ts` pra ser reaproveitado por
// `salesImpactPdf.ts` (e qualquer PDF futuro) em vez de duplicado. Mesmo
// racional de `OPCOES_MOEDA` centralizado em `@/lib/roi`.

import { rgb, type PDFFont, type RGB } from "pdf-lib";

export function hexParaRgb(hex: string): RGB {
  const limpo = hex.replace("#", "");
  const r = parseInt(limpo.slice(0, 2), 16) / 255;
  const g = parseInt(limpo.slice(2, 4), 16) / 255;
  const b = parseInt(limpo.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

/** Espelha os tokens de cor de `globals.css` — nenhuma cor nova é introduzida. */
export const TOKEN = {
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
  stateError: hexParaRgb("#E5484D"),
  stateErrorBg: hexParaRgb("#FBE7E7"),
  stateRunInk: hexParaRgb("#B36B00"),
  stateRunBg: hexParaRgb("#FFF3DC"),
  stateIdle: hexParaRgb("#7A8AA0"),
  stateIdleBg: hexParaRgb("#EDF1F4"),
};

/** A4 retrato, em pontos — mesmo tamanho em todo gerador de PDF do AgentFlow. */
export const LARGURA_A4 = 595.28;
export const ALTURA_A4 = 841.89;
export const MARGEM_PADRAO = 40;

/** Quebra um texto em linhas que cabem em `larguraMax`, na fonte/tamanho dados. */
export function quebrarLinhas(texto: string, fonte: PDFFont, tamanho: number, larguraMax: number): string[] {
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
