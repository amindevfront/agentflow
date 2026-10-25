// Fricção client-side contra força bruta nas telas de login/signup.
//
// Fronteira honesta: isto NÃO é o limite de segurança real contra força bruta
// — esse é o próprio Firebase Auth (que já devolve `auth/too-many-requests`,
// traduzido em `src/lib/auth.tsx`) e, para as rotas de API internas,
// `src/lib/server/distributedRateLimit.ts` (token bucket distribuído via
// transação do Firestore). Um `sessionStorage` do lado do cliente é trivial de
// contornar (aba anônima, limpar storage, outro navegador).
//
// O que isto FAZ é encarecer um script ingênuo rodando dentro do próprio
// navegador da vítima/atacante (ex.: um bookmarklet ou extensão tentando
// credenciais em loop) e dar feedback imediato ao usuário legítimo que
// errou a senha repetidas vezes, sem esperar o backend responder — UX e
// uma camada adicional, nunca a defesa primária.

export interface EstadoThrottle {
  tentativas: number;
  /** 0 = não bloqueado; caso contrário, epoch ms até quando o login fica suspenso. */
  bloqueadoAteMs: number;
  ultimaTentativaMs: number;
}

export interface StatusBloqueio {
  bloqueado: boolean;
  restanteSegundos: number;
}

/** Tentativas falhas consecutivas antes do primeiro bloqueio. */
const LIMIAR_BLOQUEIO = 5;
const BASE_BLOQUEIO_MS = 30_000;
const MAX_BLOQUEIO_MS = 15 * 60_000;
/** Sem nova tentativa dentro desta janela, a contagem anterior não conta mais. */
const JANELA_RESET_MS = 15 * 60_000;

const PREFIX = "agentflow:authThrottle:";
const memoryFallback = new Map<string, string>();

function storage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    // Modo privado restrito — cai para memória.
  }
  return {
    getItem: (key: string) => memoryFallback.get(key) ?? null,
    setItem: (key: string, value: string) => memoryFallback.set(key, value),
    removeItem: (key: string) => memoryFallback.delete(key),
  };
}

function normalizarChave(identificador: string): string {
  return PREFIX + identificador.trim().toLowerCase();
}

/**
 * Calcula o próximo estado após uma falha — pura, sem I/O, para ser testável
 * isoladamente do `sessionStorage`.
 *
 * Backoff exponencial a partir do limiar: 30s, 1min, 2min, 4min… até o teto de
 * 15min. A contagem zera se a última tentativa foi há mais que
 * `JANELA_RESET_MS` — um erro isolado de digitação não deve se acumular com
 * uma tentativa de ontem.
 */
export function calcularProximoEstado(anterior: EstadoThrottle | null, agoraMs: number): EstadoThrottle {
  const contagemBase =
    anterior && agoraMs - anterior.ultimaTentativaMs <= JANELA_RESET_MS ? anterior.tentativas : 0;
  const tentativas = contagemBase + 1;

  let bloqueadoAteMs = 0;
  if (tentativas >= LIMIAR_BLOQUEIO) {
    const excedente = tentativas - LIMIAR_BLOQUEIO;
    const duracaoMs = Math.min(MAX_BLOQUEIO_MS, BASE_BLOQUEIO_MS * 2 ** excedente);
    bloqueadoAteMs = agoraMs + duracaoMs;
  }

  return { tentativas, bloqueadoAteMs, ultimaTentativaMs: agoraMs };
}

function lerEstado(identificador: string): EstadoThrottle | null {
  try {
    const raw = storage().getItem(normalizarChave(identificador));
    return raw ? (JSON.parse(raw) as EstadoThrottle) : null;
  } catch {
    return null;
  }
}

function salvarEstado(identificador: string, estado: EstadoThrottle): void {
  try {
    storage().setItem(normalizarChave(identificador), JSON.stringify(estado));
  } catch {
    // Falha ao persistir o throttle não pode impedir o fluxo principal de auth.
  }
}

/** Registra uma falha de autenticação para o identificador (normalmente o e-mail digitado). */
export function registrarFalhaAuth(identificador: string): StatusBloqueio {
  const agora = Date.now();
  const proximo = calcularProximoEstado(lerEstado(identificador), agora);
  salvarEstado(identificador, proximo);
  return statusDe(proximo, agora);
}

/** Login bem-sucedido — limpa qualquer histórico de falhas para este identificador. */
export function registrarSucessoAuth(identificador: string): void {
  try {
    storage().removeItem(normalizarChave(identificador));
  } catch {
    // Pior caso: o histórico expira pela janela de reset no próximo acesso.
  }
}

function statusDe(estado: EstadoThrottle, agoraMs: number): StatusBloqueio {
  if (estado.bloqueadoAteMs <= agoraMs) return { bloqueado: false, restanteSegundos: 0 };
  return { bloqueado: true, restanteSegundos: Math.ceil((estado.bloqueadoAteMs - agoraMs) / 1000) };
}

/** Consulta se o identificador está atualmente bloqueado, sem registrar uma nova tentativa. */
export function verificarBloqueioAuth(identificador: string): StatusBloqueio {
  const estado = lerEstado(identificador);
  if (!estado) return { bloqueado: false, restanteSegundos: 0 };
  return statusDe(estado, Date.now());
}
