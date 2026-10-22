// Persistência atômica da trilha de auditoria — servidor.
//
// SERVER-ONLY.
//
// Corrige uma corrida real da versão anterior: o cliente lia a última entrada
// (`orderBy(seq, desc).limit(1)`), pedia o selo ao servidor e então escrevia o
// documento ele mesmo, com um laço de "releia e tente de novo" em caso de
// colisão. Entre dois clientes (ou duas abas do mesmo operador) competindo
// pela mesma posição, a janela entre "ler a última entrada" e "escrever a
// própria" não era atômica — apenas otimista, com retry. Sob carga, dois
// selos poderiam computar o mesmo `seq` e um deles girar em round-trips extras
// até a rede resolver a disputa, ou falhar depois de `MAX_TENTATIVAS_SEQ`.
//
// A correção: ler o ponteiro da cadeia, selar e escrever a nova entrada
// acontecem agora dentro de UMA transação do Admin SDK. O Firestore garante
// que, se dois selos concorrentes tentarem avançar o mesmo ponteiro, um deles
// é serializado atrás do outro e relido automaticamente — nunca há dois
// vencedores para a mesma posição, e nunca há necessidade de retry no cliente.
//
// Isso também simplifica o modelo de segurança: o cliente não escreve mais em
// `auditLogs` (a coleção passa a negar toda escrita direta nas regras do
// Firestore), então a validação de forma do documento que antes vivia nas
// regras (casamento de `entryId` com `seq`) deixa de ser necessária ali — a
// única parte que confecciona a entrada agora é este módulo.
//
// O ponteiro fica em `auditChainHead/{workspaceId}`, um único documento por
// workspace. Ler+escrever um documento nomeado dentro da transação é mais
// simples e mais barato do que rodar uma consulta `orderBy().limit(1)` dentro
// da transação (o Firestore suporta ambos, mas o ponteiro dedicado evita
// qualquer ambiguidade sobre "qual é realmente a última entrada" em caso de
// índice desatualizado ou leitura em réplica).

import type { Transaction } from "firebase-admin/firestore";
import type { AuditEntry, AuditEventBody } from "@/types";
import { selarEntradaAuditoria } from "@/lib/crypto/auditChain";
import { firestoreAdmin } from "./firebaseAdmin";

const COLECAO_ENTRADAS = "auditLogs";
const COLECAO_PONTEIRO = "auditChainHead";

interface PonteiroCadeia {
  seq: number;
  chainHash: string;
  atualizadoEm: string;
}

/**
 * Corpo da transação, independente do Firestore real: recebe um objeto que
 * implementa apenas `get`/`set` (o subconjunto de `Transaction` que usa),
 * o que permite testá-lo com um dublê de teste sem Firestore nem emulador.
 */
export async function executarTransacaoDeSelo(
  tx: Pick<Transaction, "get" | "set">,
  db: Pick<ReturnType<typeof firestoreAdmin>, "collection">,
  workspaceId: string,
  corpo: AuditEventBody,
  chaveHmac: Uint8Array
): Promise<AuditEntry> {
  const refPonteiro = db.collection(COLECAO_PONTEIRO).doc(workspaceId);
  const snapPonteiro = await tx.get(refPonteiro);
  const ponteiro = snapPonteiro.exists ? (snapPonteiro.data() as PonteiroCadeia) : null;

  const entrada = await selarEntradaAuditoria({
    corpo,
    anterior: ponteiro ? { seq: ponteiro.seq, chainHash: ponteiro.chainHash } : null,
    chaveHmac,
  });

  const refEntrada = db.collection(COLECAO_ENTRADAS).doc(entrada.id);
  tx.set(refEntrada, entrada);
  tx.set(refPonteiro, {
    seq: entrada.seq,
    chainHash: entrada.chainHash,
    atualizadoEm: entrada.seladoEm,
  } satisfies PonteiroCadeia);

  return entrada;
}

/**
 * Sela e persiste uma entrada de auditoria atomicamente.
 *
 * Chamada exclusivamente por `/api/audit/seal`. O cliente não participa mais
 * da escrita — ele só recebe a entrada já persistida de volta (e a vê de novo,
 * em tempo real, via `onSnapshot` na coleção `auditLogs`).
 */
export async function selarEPersistirEntrada(
  workspaceId: string,
  corpo: AuditEventBody,
  chaveHmac: Uint8Array
): Promise<AuditEntry> {
  const db = firestoreAdmin();
  return db.runTransaction((tx) => executarTransacaoDeSelo(tx, db, workspaceId, corpo, chaveHmac));
}
