// Limitador de taxa por identidade — token bucket em memória.
//
// SERVER-ONLY.
//
// Este NÃO é mais o caminho padrão de produção — veja `distributedRateLimit.ts`,
// que implementa o mesmo algoritmo sobre uma transação do Firestore e é o que
// `http.ts` efetivamente chama. Este módulo permanece como:
//
//   1. a base matemática pura do token bucket, reutilizada e testada aqui
//      isoladamente, sem depender de Firestore nem do Admin SDK;
//   2. o fallback automático de `consumirLimiteDistribuido` quando o Admin SDK
//      não está configurado ou a transação falha — um limite por instância
//      (bypassável ao bater em réplicas diferentes) é preferível a nenhum
//      limite, e a queda para este caminho é registrada em log, nunca silenciosa.

interface Balde {
  tokens: number;
  ultimoAbastecimento: number;
}

const baldes = new Map<string, Balde>();

/** Teto de chaves rastreadas, para que o mapa não cresça sem limite. */
const MAX_CHAVES = 10_000;

export interface ConfiguracaoLimite {
  /** Capacidade do balde: rajada máxima permitida. */
  capacidade: number;
  /** Tokens reabastecidos por segundo: a taxa sustentada. */
  taxaPorSegundo: number;
}

export const LIMITE_PADRAO: ConfiguracaoLimite = { capacidade: 30, taxaPorSegundo: 0.5 };
/** Operações de cofre são raras e caras: limite bem mais apertado. */
export const LIMITE_COFRE: ConfiguracaoLimite = { capacidade: 10, taxaPorSegundo: 0.1 };

export interface ResultadoLimite {
  permitido: boolean;
  /** Segundos até a próxima permissão, quando negado. */
  tentarEmSegundos: number;
  restantes: number;
}

/**
 * Remove os baldes mais antigos quando o mapa atinge a capacidade.
 * Preferir descartar estado a crescer indefinidamente: um balde descartado
 * apenas concede uma rajada extra, enquanto um mapa sem teto vaza memória.
 */
function podar(): void {
  if (baldes.size < MAX_CHAVES) return;
  const excedente = baldes.size - Math.floor(MAX_CHAVES * 0.9);
  let removidos = 0;
  for (const chave of baldes.keys()) {
    baldes.delete(chave);
    removidos += 1;
    if (removidos >= excedente) break;
  }
}

export function consumirLimite(
  chave: string,
  configuracao: ConfiguracaoLimite = LIMITE_PADRAO
): ResultadoLimite {
  const agora = Date.now();
  let balde = baldes.get(chave);

  if (!balde) {
    podar();
    balde = { tokens: configuracao.capacidade, ultimoAbastecimento: agora };
    baldes.set(chave, balde);
  } else {
    const decorridoS = (agora - balde.ultimoAbastecimento) / 1000;
    balde.tokens = Math.min(
      configuracao.capacidade,
      balde.tokens + decorridoS * configuracao.taxaPorSegundo
    );
    balde.ultimoAbastecimento = agora;
  }

  if (balde.tokens < 1) {
    const faltante = 1 - balde.tokens;
    return {
      permitido: false,
      tentarEmSegundos: Math.ceil(faltante / configuracao.taxaPorSegundo),
      restantes: 0,
    };
  }

  balde.tokens -= 1;
  return { permitido: true, tentarEmSegundos: 0, restantes: Math.floor(balde.tokens) };
}

/** Usado apenas em teste, para isolar casos entre si. */
export function limparLimites(): void {
  baldes.clear();
}
