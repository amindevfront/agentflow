// Fila de reenvio otimista — observabilidade sobre escritas do Firestore em
// voo, não uma reimplementação da fila offline do próprio SDK (ver
// ADR-0005).
//
// Por que não reimplementar: com a persistência local habilitada
// (`src/lib/firebase.ts`), o Firestore JÁ aplica toda escrita ao cache local
// imediatamente — qualquer `onSnapshot` ativo already reflete o novo valor
// antes mesmo do servidor confirmar — e JÁ reenfileira e reenvia a escrita
// sozinho quando a conexão volta, de forma durável (sobrevive a reload). Uma
// fila própria duplicaria exatamente essa lógica, com mais chance de
// divergir dela do que de melhorá-la.
//
// O que falta, e é o que este módulo resolve: (1) visibilidade — nada hoje diz
// ao operador "há N operações aguardando confirmação do servidor"; (2) uma
// escrita que falha por um motivo real (não só "ainda sem rede") não pode
// desaparecer sem reportar — ver `src/lib/telemetry/errorReporting.ts`.
//
// Deliberadamente NÃO muda a semântica de quem chama: `enfileirarEscrita`
// devolve a MESMA Promise que `fn()` produziria — quem precisa aguardar a
// confirmação real continua podendo `await`; quem só quer navegar
// otimisticamente (ver o padrão já usado no onboarding, ADR-0003) ignora o
// retorno.

import { reportarErro } from "./telemetry/errorReporting";

export interface OperacaoPendente {
  id: string;
  descricao: string;
  iniciadaEm: string;
}

let pendentes: OperacaoPendente[] = [];
const ouvintes = new Set<(lista: OperacaoPendente[]) => void>();

function notificar(): void {
  for (const ouvinte of ouvintes) ouvinte(pendentes);
}

/** Assina a lista de operações pendentes — chamado imediatamente com o estado atual. */
export function assinarOperacoesPendentes(ouvinte: (lista: OperacaoPendente[]) => void): () => void {
  ouvintes.add(ouvinte);
  ouvinte(pendentes);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/**
 * Executa `fn` (normalmente uma escrita do Firestore) registrando-a como
 * pendente até o momento em que resolver ou rejeitar. Uma rejeição genuína
 * é reportada via `reportarErro` antes de sair da lista — nunca fica
 * pendente para sempre nem desaparece silenciosamente.
 */
export function enfileirarEscrita<T>(descricao: string, fn: () => Promise<T>): Promise<T> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  pendentes = [...pendentes, { id, descricao, iniciadaEm: new Date().toISOString() }];
  notificar();

  function remover(): void {
    pendentes = pendentes.filter((p) => p.id !== id);
    notificar();
  }

  const promise = fn();
  promise.then(remover, (erro) => {
    reportarErro(erro, `offline-queue:${descricao}`);
    remover();
  });

  return promise;
}

/** `true` quando o navegador reporta conexão — usado junto da lista de pendentes para o banner de status. */
export function estaOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

/** Assina mudanças de conectividade do navegador (`online`/`offline`). */
export function assinarConectividade(ouvinte: (online: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  function aoMudar(): void {
    ouvinte(navigator.onLine);
  }
  window.addEventListener("online", aoMudar);
  window.addEventListener("offline", aoMudar);
  return () => {
    window.removeEventListener("online", aoMudar);
    window.removeEventListener("offline", aoMudar);
  };
}

/** Usado apenas em teste, para isolar casos entre si. */
export function limparOperacoesPendentes(): void {
  pendentes = [];
  notificar();
}
