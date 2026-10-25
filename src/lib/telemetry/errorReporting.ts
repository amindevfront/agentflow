// Buffer de falhas silenciosas — núcleo puro, sem React (ver ADR-0004).
//
// "Falha silenciosa" aqui significa: uma exceção de rede ou de SDK (Firebase,
// orquestração) que não tem ninguém olhando no momento — o usuário está em
// outra aba, o componente que disparou a chamada já desmontou, ou o erro vem
// de um `unhandledrejection` genuíno. Sem este módulo, esse erro só existiria
// no `console` do navegador do usuário, que nenhum operador jamais vê.
// `logger.error` já garante o log estruturado; este módulo adiciona um canal
// de FEEDBACK ao vivo (assinável por UI) e deduplicação, para que um mesmo
// erro repetindo em loop (ex.: retry de rede) não produza vinte notificações
// idênticas.

import { logger } from "./logger";

export interface FalhaCapturada {
  id: string;
  mensagem: string;
  contexto?: string;
  timestamp: string;
}

const MAX_BUFFER = 20;
/** Falhas idênticas (mesmo contexto+mensagem) dentro desta janela contam como uma só. */
const JANELA_DEDUPE_MS = 10_000;

let buffer: FalhaCapturada[] = [];
const ouvintes = new Set<(falhas: FalhaCapturada[]) => void>();

function notificar(): void {
  for (const ouvinte of ouvintes) ouvinte(buffer);
}

/** Assina o buffer de falhas — chamado imediatamente com o estado atual, depois a cada mudança. */
export function assinarFalhas(ouvinte: (falhas: FalhaCapturada[]) => void): () => void {
  ouvintes.add(ouvinte);
  ouvinte(buffer);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

function extrairMensagem(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  if (typeof erro === "string") return erro;
  try {
    return JSON.stringify(erro);
  } catch {
    return "Erro desconhecido.";
  }
}

/**
 * Registra uma falha: sempre loga estruturado, e só adiciona ao buffer
 * observável se não for uma repetição recente da mesma falha. Nunca lança —
 * reportar um erro não pode, em si, se tornar outro erro não tratado.
 */
export function reportarErro(erro: unknown, contexto?: string): FalhaCapturada {
  const mensagem = extrairMensagem(erro);
  logger.error(mensagem, {
    contexto,
    dados: erro instanceof Error ? { erro } : undefined,
  });

  const agora = Date.now();
  const duplicata = buffer.find(
    (f) =>
      f.mensagem === mensagem &&
      f.contexto === contexto &&
      agora - new Date(f.timestamp).getTime() < JANELA_DEDUPE_MS
  );
  if (duplicata) return duplicata;

  const falha: FalhaCapturada = {
    id: `${agora}-${Math.random().toString(36).slice(2, 8)}`,
    mensagem,
    contexto,
    timestamp: new Date(agora).toISOString(),
  };
  buffer = [falha, ...buffer].slice(0, MAX_BUFFER);
  notificar();
  return falha;
}

export function limparFalha(id: string): void {
  buffer = buffer.filter((f) => f.id !== id);
  notificar();
}

/** Usado apenas em teste, para isolar casos entre si. */
export function limparTodasFalhas(): void {
  buffer = [];
  notificar();
}
