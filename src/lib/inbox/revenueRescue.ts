// Motor de Resgate de Receita Perdida — Neural Inbox.
//
// Mede conversas de alta intenção comercial que chegaram e foram RESOLVIDAS
// fora do expediente — o horário em que, sem automação, a empresa estaria
// fechada e aquele contato teria esperado o próximo dia útil (ou desistido).
// É a prova de ROI mais concreta da Neural Inbox: demanda que seria perdida
// e não foi.
//
// Deliberadamente NÃO atribui um valor em R$ de "receita recuperada": não
// existe, no modelo de dados, um valor de negócio por conversa — inventar
// um multiplicador monetário aqui romperia a mesma regra de honestidade que
// governa `calcularRoi` em `@/lib/roi` ("um painel de ROI que infla a
// economia com estimativas silenciosas destrói a confiança na primeira
// auditoria"). O que este módulo prova, com dados reais e auditáveis, é
// VOLUME: quantas conversas de intenção comercial o sistema atendeu
// enquanto a empresa estaria fechada.

import type { Conversation } from "@/types";

export interface JanelaExpediente {
  /** Hora local de abertura (0-23), inclusive. */
  inicioHora: number;
  /** Hora local de fechamento (0-23), exclusive. */
  fimHora: number;
  /** Dias da semana considerados úteis (0=domingo..6=sábado). */
  diasUteis: number[];
}

/** Expediente comercial padrão: 8h–18h, segunda a sexta. Ajustável por workspace. */
export const EXPEDIENTE_PADRAO: JanelaExpediente = {
  inicioHora: 8,
  fimHora: 18,
  diasUteis: [1, 2, 3, 4, 5],
};

/** `true` quando o instante cai fora do expediente configurado (noite, madrugada ou fim de semana). */
export function foraDoExpediente(data: Date, janela: JanelaExpediente = EXPEDIENTE_PADRAO): boolean {
  if (!Number.isFinite(data.getTime())) return false;
  if (!janela.diasUteis.includes(data.getDay())) return true;
  const hora = data.getHours();
  return hora < janela.inicioHora || hora >= janela.fimHora;
}

export interface ReceitaMadrugadaResultado {
  /** Conversas elegíveis: primeiro contato fora do expediente e já resolvidas. */
  conversas: Conversation[];
  totalConversas: number;
  /** Subconjunto roteado como intenção comercial com confiança razoável — o sinal de "quase virou venda". */
  totalAltaIntencaoComercial: number;
  totalMensagensCliente: number;
}

/** Confiança mínima do roteamento para contar como "alta intenção comercial" — evita contar classificações incertas. */
const CONFIANCA_MINIMA_INTENCAO = 0.5;

/**
 * Seleciona, dentro do conjunto de conversas do workspace, as que tiveram o
 * PRIMEIRO contato do cliente fora do expediente e terminaram resolvidas.
 *
 * Função pura — mesmas garantias de `calcularRoi`: dado o mesmo input e a
 * mesma janela de expediente, o resultado é sempre idêntico e auditável.
 */
export function calcularReceitaRecuperadaMadrugada(
  conversas: Conversation[],
  janela: JanelaExpediente = EXPEDIENTE_PADRAO
): ReceitaMadrugadaResultado {
  const elegiveis = conversas.filter(
    (c) => c.status === "resolvida" && foraDoExpediente(new Date(c.criadaEm), janela)
  );

  const totalAltaIntencaoComercial = elegiveis.filter(
    (c) =>
      c.roteamento?.intencao.categoria === "comercial" &&
      c.roteamento.intencao.confianca >= CONFIANCA_MINIMA_INTENCAO
  ).length;

  return {
    conversas: elegiveis,
    totalConversas: elegiveis.length,
    totalAltaIntencaoComercial,
    totalMensagensCliente: elegiveis.reduce((acc, c) => acc + (c.totalMensagensCliente ?? 0), 0),
  };
}

export interface PicoForaExpediente {
  /** Hora local (0-23) com mais primeiros contatos fora do expediente. */
  hora: number;
  total: number;
}

/** Abaixo disso, apontar um "horário de pico" seria ruído estatístico, não um sinal real. */
const MINIMO_PARA_PICO = 3;

/**
 * Entre as conversas já identificadas como fora do expediente (ver
 * `ReceitaMadrugadaResultado.conversas`), identifica a hora do dia que
 * concentrou mais primeiros contatos — a base real do "Alerta Inteligente"
 * do Portal do Cliente. Nenhum horário é inventado: `null` quando o volume
 * é baixo demais para um pico significativo.
 */
export function identificarPicoForaExpediente(conversasForaDoExpediente: Conversation[]): PicoForaExpediente | null {
  if (conversasForaDoExpediente.length < MINIMO_PARA_PICO) return null;

  const contagemPorHora = new Map<number, number>();
  for (const conversa of conversasForaDoExpediente) {
    const instante = new Date(conversa.criadaEm);
    if (!Number.isFinite(instante.getTime())) continue;
    const hora = instante.getHours();
    contagemPorHora.set(hora, (contagemPorHora.get(hora) ?? 0) + 1);
  }

  let picoHora = -1;
  let picoTotal = 0;
  for (const [hora, total] of contagemPorHora) {
    if (total > picoTotal) {
      picoHora = hora;
      picoTotal = total;
    }
  }

  return picoHora === -1 ? null : { hora: picoHora, total: picoTotal };
}
