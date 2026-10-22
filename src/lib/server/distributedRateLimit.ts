// Limitador de taxa distribuído — token bucket via transação do Firestore.
//
// SERVER-ONLY.
//
// Substitui o balde em memória de `rateLimit.ts` como caminho padrão: aquele
// implementava corretamente o algoritmo, mas o estado vivia no processo —
// em deploy multi-instância (Cloud Run, Vercel serverless), cada réplica tinha
// seu próprio balde, e o limite efetivo era `limite × instâncias`, bypassável
// simplesmente por bater em instâncias diferentes em um pico de tráfego.
//
// A transação do Firestore é o que torna isto correto sob concorrência real:
// `runTransaction` relê o documento se outra escrita colidiu enquanto a
// transação estava em voo, e tenta de novo automaticamente (até o limite
// padrão do SDK). Duas requisições simultâneas para a mesma chave, em
// instâncias diferentes, nunca consomem o mesmo token duas vezes — uma delas
// é serializada atrás da outra pelo próprio Firestore.
//
// O núcleo do algoritmo (`calcularProximoBalde`) é uma função pura, igual à de
// `rateLimit.ts`, deliberadamente extraída para ser testável sem Firestore: o
// corpo da transação é apenas leitura → cálculo puro → escrita.
//
// Graceful degradation: se o Admin SDK não estiver configurado (ou a escrita
// falhar por qualquer motivo operacional), a função cai para o limitador em
// memória de `rateLimit.ts` em vez de deixar a requisição passar sem nenhum
// controle — um limite imperfeito (por processo) é preferível a nenhum limite.
// Essa queda é registrada em log, não é silenciosa.

import { Timestamp, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import { firestoreAdmin } from "./firebaseAdmin";
import {
  consumirLimite as consumirLimiteLocal,
  LIMITE_PADRAO,
  type ConfiguracaoLimite,
  type ResultadoLimite,
} from "./rateLimit";

/**
 * Coleção dedicada, fora do espaço de nomes de dados de negócio.
 * Bloqueada por completo nas regras do Firestore (`allow read, write: if false`)
 * — só o Admin SDK, que ignora as regras, lê e escreve aqui.
 */
const COLECAO = "_rateLimits";

/** Teto de idade de um balde antes de ser elegível para limpeza oportunista. */
const TTL_MS = 24 * 60 * 60 * 1000;

interface DocumentoBalde {
  tokens: number;
  ultimoAbastecimentoMs: number;
  expiraEm: Timestamp;
}

/**
 * Calcula o novo estado do balde e o resultado da checagem — puro, sem I/O.
 * Compartilhado estruturalmente com a lógica de `rateLimit.ts`, mas mantido
 * como função independente para que a transação do Firestore e o limitador em
 * memória possam evoluir sem ficarem acoplados um ao outro.
 */
export function calcularProximoBalde(
  estadoAnterior: { tokens: number; ultimoAbastecimentoMs: number } | null,
  agoraMs: number,
  configuracao: ConfiguracaoLimite
): { tokens: number; ultimoAbastecimentoMs: number; resultado: ResultadoLimite } {
  let tokens: number;

  if (!estadoAnterior) {
    tokens = configuracao.capacidade;
  } else {
    const decorridoS = Math.max(0, agoraMs - estadoAnterior.ultimoAbastecimentoMs) / 1000;
    tokens = Math.min(configuracao.capacidade, estadoAnterior.tokens + decorridoS * configuracao.taxaPorSegundo);
  }

  if (tokens < 1) {
    const faltante = 1 - tokens;
    return {
      tokens,
      ultimoAbastecimentoMs: agoraMs,
      resultado: {
        permitido: false,
        tentarEmSegundos: Math.ceil(faltante / configuracao.taxaPorSegundo),
        restantes: 0,
      },
    };
  }

  const tokensRestantes = tokens - 1;
  return {
    tokens: tokensRestantes,
    ultimoAbastecimentoMs: agoraMs,
    resultado: { permitido: true, tentarEmSegundos: 0, restantes: Math.floor(tokensRestantes) },
  };
}

/**
 * Corpo da transação, extraído como função independente para ser exercitado em
 * teste com um objeto `Transaction` falso — sem depender de um Firestore real
 * nem do emulador.
 */
export async function executarTransacaoDeBalde(
  tx: Pick<Transaction, "get" | "set">,
  ref: DocumentReference,
  agoraMs: number,
  configuracao: ConfiguracaoLimite
): Promise<ResultadoLimite> {
  const snap = await tx.get(ref);
  const dados = snap.exists ? (snap.data() as DocumentoBalde) : null;

  const { tokens, ultimoAbastecimentoMs, resultado } = calcularProximoBalde(
    dados ? { tokens: dados.tokens, ultimoAbastecimentoMs: dados.ultimoAbastecimentoMs } : null,
    agoraMs,
    configuracao
  );

  tx.set(ref, {
    tokens,
    ultimoAbastecimentoMs,
    expiraEm: Timestamp.fromMillis(agoraMs + TTL_MS),
  } satisfies DocumentoBalde);

  return resultado;
}

/** Normaliza a chave para um id de documento válido (sem `/`). */
function idDoDocumento(chave: string): string {
  return chave.replace(/\//g, "_");
}

/**
 * Consome um token distribuído para a chave informada.
 *
 * Cai para o limitador em memória (`rateLimit.ts`) quando o Admin SDK não está
 * disponível ou a transação falha por qualquer motivo operacional — nunca
 * deixa uma requisição passar sem checagem alguma, e nunca propaga uma
 * exceção de infraestrutura para o chamador da API.
 */
/**
 * Probabilidade, por chamada, de disparar a limpeza oportunista de baldes
 * expirados. Em média, uma a cada mil requisições — baixo suficiente para não
 * pesar no caminho crítico, frequente suficiente para a coleção não crescer
 * sem controle sob tráfego real.
 */
const PROBABILIDADE_LIMPEZA = 0.001;

export async function consumirLimiteDistribuido(
  chave: string,
  configuracao: ConfiguracaoLimite = LIMITE_PADRAO
): Promise<ResultadoLimite> {
  try {
    const db = firestoreAdmin();
    const ref = db.collection(COLECAO).doc(idDoDocumento(chave));
    const resultado = await db.runTransaction((tx) =>
      executarTransacaoDeBalde(tx, ref, Date.now(), configuracao)
    );

    // Fire-and-forget: nunca atrasa a resposta, e uma falha na limpeza não é
    // motivo para tratar a checagem de limite (já resolvida acima) como erro.
    if (Math.random() < PROBABILIDADE_LIMPEZA) {
      limparBaldesExpirados().catch((erro) =>
        console.warn("[rate-limit] limpeza oportunista de baldes expirados falhou:", erro)
      );
    }

    return resultado;
  } catch (erro) {
    console.warn(
      `[rate-limit] Admin SDK indisponível — usando limite em memória (por instância) para "${chave}": ` +
        `${erro instanceof Error ? erro.message : String(erro)}`
    );
    return consumirLimiteLocal(chave, configuracao);
  }
}

/**
 * Remove baldes expirados em lote. Não é necessária para a correção do
 * limitador (um balde vencido simplesmente volta à capacidade cheia no
 * próximo acesso), apenas para conter o crescimento da coleção. Chamada
 * oportunisticamente, nunca no caminho crítico de uma requisição comum.
 */
export async function limparBaldesExpirados(limiteDocs = 500): Promise<number> {
  const db = firestoreAdmin();
  const agora = Timestamp.now();
  const consulta = db.collection(COLECAO).where("expiraEm", "<=", agora).limit(limiteDocs);
  const snapshot = await consulta.get();
  if (snapshot.empty) return 0;

  const lote = db.batch();
  snapshot.docs.forEach((documento) => lote.delete(documento.ref));
  await lote.commit();
  return snapshot.size;
}

