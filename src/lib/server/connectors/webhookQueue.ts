// AgentFlow Connect Hub — Resiliência de Fila (Retry Inteligente).
//
// SERVER-ONLY.
//
// Composição de mecanismos já existentes, nenhum reinventado — mesmo
// racional do cabeçalho de `@/lib/server/channelReputationShieldAdmin`:
//
//   - `@/lib/server/externalApiBreaker` (`DisjuntorChamadaExterna`) isola o
//     webhook de um workspace instável dos demais — um disjuntor por
//     `workspaceId`, nunca um único disjuntor global.
//   - `./webhookDispatcher` assina e envia o payload (já mascarado) — este
//     módulo só decide QUANDO tentar e o que fazer se falhar.
//   - `@/lib/server/auditChainStore` sela a trilha de auditoria (LGPD:
//     todo egresso de dados a terceiros é auditável), na MESMA transação
//     que persiste/atualiza a entrega — exatamente o padrão de
//     `executarTransacaoEnfileiramento`.
//
// Quando a entrega falha, ela NUNCA é descartada silenciosamente: fica
// registrada em `connectHubDeliveries` para retry com backoff exponencial,
// até `MAX_TENTATIVAS_CONNECT_HUB` — mesmo princípio de
// `channelReputationQueue`/`MAX_TENTATIVAS_FILA_REPUTACAO`. A primeira
// tentativa e as tentativas de retry atualizam o MESMO documento de
// entrega (nunca um documento novo por tentativa) — `tentativas` é o
// histórico de uma entrega, não uma contagem de entregas distintas.

import type { Transaction } from "firebase-admin/firestore";
import type { AuditEventBody, ConnectHubDelivery, ConnectHubDeliveryStatus, ConnectHubPayload } from "@/types";
import { executarTransacaoDeSelo } from "./../auditChainStore";
import { chaveAuditoria } from "./../env";
import { firestoreAdmin } from "./../firebaseAdmin";
import { DisjuntorChamadaExterna, ErroDisjuntorAberto } from "./../externalApiBreaker";
import { lerSegredoCredencialAdmin } from "./credentialReader";
import {
  despacharPayloadConnectHub,
  executorEnvioFetch,
  type ExecutorEnvioWebhook,
} from "./webhookDispatcher";

const COLECAO_ENTREGAS = "connectHubDeliveries";
const COLECAO_WORKSPACES = "workspaces";

/** Tentativas antes de descartar definitivamente uma entrega — evita retenção indefinida de um webhook permanentemente inativo. */
export const MAX_TENTATIVAS_CONNECT_HUB = 6;

/** Teto do backoff exponencial — nunca esperar mais que isso entre tentativas, mesmo depois de muitas falhas. */
const BACKOFF_MAXIMO_MS = 30 * 60_000;

/** Base do backoff exponencial — primeira retentativa em ~30s. */
const BACKOFF_BASE_MS = 30_000;

function novoIdEntrega(): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `cnct_${aleatorio}`;
}

/**
 * Backoff exponencial com teto — função pura, diretamente testável.
 * `tentativas` é o número de tentativas JÁ realizadas (0 antes da primeira).
 */
export function calcularBackoffMs(tentativas: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** tentativas, BACKOFF_MAXIMO_MS);
}

export interface ProximoEstadoEntrega {
  status: ConnectHubDeliveryStatus;
  tentativas: number;
  proximaTentativaEm: string | null;
}

/**
 * Decide o próximo estado de uma entrega após uma tentativa — função pura,
 * mesmo desenho de `decidirProximoEstadoFila`
 * (`@/lib/server/channelReputationShieldAdmin`). Esgotar
 * `MAX_TENTATIVAS_CONNECT_HUB` sem sucesso descarta a entrega.
 */
export function decidirProximoEstadoEntrega(
  tentativasAtuais: number,
  sucesso: boolean,
  agora: Date = new Date()
): ProximoEstadoEntrega {
  const tentativas = tentativasAtuais + 1;
  if (sucesso) return { status: "entregue", tentativas, proximaTentativaEm: null };
  if (tentativas >= MAX_TENTATIVAS_CONNECT_HUB) {
    return { status: "descartado", tentativas, proximaTentativaEm: null };
  }
  const proximaTentativaEm = new Date(agora.getTime() + calcularBackoffMs(tentativas)).toISOString();
  return { status: "falhou", tentativas, proximaTentativaEm };
}

const disjuntoresPorWorkspace = new Map<string, DisjuntorChamadaExterna>();

/** Um disjuntor por workspace — um webhook de cliente instável nunca afeta o Connect Hub de outro workspace. */
export function disjuntorDoWebhook(workspaceId: string): DisjuntorChamadaExterna {
  let disjuntor = disjuntoresPorWorkspace.get(workspaceId);
  if (!disjuntor) {
    disjuntor = new DisjuntorChamadaExterna(`connect-hub:${workspaceId}`, {
      limiarFalhas: 3,
      resfriamentoMs: 60_000,
    });
    disjuntoresPorWorkspace.set(workspaceId, disjuntor);
  }
  return disjuntor;
}

/** Usado apenas em teste, para isolar casos entre si — mesmo papel de `_resetarDisjuntoresDeCanalParaTeste`. */
export function _resetarDisjuntoresConnectHubParaTeste(): void {
  disjuntoresPorWorkspace.clear();
}

interface ConfigConnectHub {
  webhookUrl: string;
  secretCredentialId: string;
}

/** Lê `Workspace.connectHub`. `null` quando ausente, malformado, ou a leitura falhar — nunca lança. */
async function resolverConfigConnectHub(workspaceId: string): Promise<ConfigConnectHub | null> {
  try {
    const db = firestoreAdmin();
    const workspaceSnap = await db.collection(COLECAO_WORKSPACES).doc(workspaceId).get();
    const connectHub = workspaceSnap.exists
      ? (workspaceSnap.data() as { connectHub?: { webhookUrl?: unknown; secretCredentialId?: unknown } | null })
          .connectHub
      : null;
    if (connectHub && typeof connectHub.webhookUrl === "string" && typeof connectHub.secretCredentialId === "string") {
      return { webhookUrl: connectHub.webhookUrl, secretCredentialId: connectHub.secretCredentialId };
    }
    return null;
  } catch (erro) {
    console.error(`[connect-hub] falha ao ler a configuração do workspace ${workspaceId}:`, erro);
    return null;
  }
}

interface ResultadoTentativaEnvio {
  /** `false` quando o workspace não tem Connect Hub configurado, ou o segredo está inacessível — nunca uma falha de rede, só "nada a tentar". */
  configurado: boolean;
  entregue: boolean;
  webhookUrl: string | null;
}

/**
 * Resolve a configuração vigente do workspace, decifra o segredo e tenta o
 * envio uma única vez, sob o disjuntor do workspace. Único ponto que de
 * fato toca a rede — usado tanto pelo primeiro despacho quanto por cada
 * tentativa de retry da drenagem, para que ambos sempre usem a
 * configuração MAIS RECENTE do workspace (se o cliente trocou a URL ou
 * rotacionou o segredo entre tentativas, o retry já usa o valor vigente).
 */
async function tentarEnviarSobDisjuntor(
  workspaceId: string,
  payload: ConnectHubPayload,
  executor: ExecutorEnvioWebhook
): Promise<ResultadoTentativaEnvio> {
  const config = await resolverConfigConnectHub(workspaceId);
  if (!config) return { configurado: false, entregue: false, webhookUrl: null };

  const segredoWebhook = await lerSegredoCredencialAdmin(workspaceId, config.secretCredentialId);
  if (!segredoWebhook) {
    console.error(
      `[connect-hub] workspace ${workspaceId} tem Connect Hub configurado, mas o segredo da credencial ${config.secretCredentialId} está inacessível — tentativa abortada.`
    );
    return { configurado: true, entregue: false, webhookUrl: config.webhookUrl };
  }

  const disjuntor = disjuntorDoWebhook(workspaceId);
  try {
    const resultado = await disjuntor.executar(() =>
      despacharPayloadConnectHub({ payload, webhookUrl: config.webhookUrl, segredoWebhook, executor })
    );
    return { configurado: true, entregue: resultado.entregue, webhookUrl: config.webhookUrl };
  } catch (erro) {
    if (!(erro instanceof ErroDisjuntorAberto)) {
      console.error(`[connect-hub] falha ao despachar evento ao workspace ${workspaceId}:`, erro);
    }
    return { configurado: true, entregue: false, webhookUrl: config.webhookUrl };
  }
}

/**
 * Corpo da transação de registro — recebe `tx`/`db` como o subconjunto que
 * usa (mesmo desenho de `executarTransacaoEnfileiramento`), testável com um
 * dublê de Firestore. Persiste/atualiza a entrega e sela a entrada de
 * auditoria na MESMA transação: o registro do envio (ou da falha) e a
 * trilha forense avançam juntos ou nenhum avança.
 */
export async function executarTransacaoRegistroEntrega(
  tx: Pick<Transaction, "get" | "set">,
  db: Pick<ReturnType<typeof firestoreAdmin>, "collection">,
  entrada: {
    delivery: ConnectHubDelivery;
    sucesso: boolean;
    chaveHmac: Uint8Array;
  }
): Promise<ConnectHubDelivery> {
  const refEntrega = db.collection(COLECAO_ENTREGAS).doc(entrada.delivery.id);
  tx.set(refEntrega, entrada.delivery);

  const corpo: AuditEventBody = {
    tipo: "connecthub.webhook.despachado",
    resultado: entrada.sucesso ? "sucesso" : "falha",
    workspaceId: entrada.delivery.workspaceId,
    ator: "sistema",
    recurso: `${COLECAO_ENTREGAS}/${entrada.delivery.id}`,
    traceId: entrada.delivery.payload.traceId,
    severidade: entrada.sucesso ? "info" : "media",
    detalhes: {
      evento: entrada.delivery.payload.evento,
      status: entrada.delivery.status,
      tentativas: entrada.delivery.tentativas,
    },
    ocorridoEm: entrada.delivery.ultimaTentativaEm ?? entrada.delivery.criadoEm,
  };
  await executarTransacaoDeSelo(tx, db, entrada.delivery.workspaceId, corpo, entrada.chaveHmac);

  return entrada.delivery;
}

async function registrarEntrega(
  delivery: ConnectHubDelivery,
  sucesso: boolean,
  chaveHmac: Uint8Array
): Promise<void> {
  const db = firestoreAdmin();
  await db.runTransaction((tx) => executarTransacaoRegistroEntrega(tx, db, { delivery, sucesso, chaveHmac }));
}

export interface DespacharEventoAdminInput {
  workspaceId: string;
  payload: ConnectHubPayload;
  /** Injetável em teste; em produção é sempre o `fetch` real. */
  executor?: ExecutorEnvioWebhook;
  /** Injetável em teste; em produção é sempre `chaveAuditoria()`. */
  chaveHmac?: Uint8Array;
  agora?: Date;
}

export interface ResultadoDespachoInterno {
  configurado: boolean;
  entregue: boolean;
  enfileirado: boolean;
  deliveryId?: string;
}

/**
 * Despacha um evento do Connect Hub ao webhook configurado do workspace —
 * a PRIMEIRA tentativa de uma entrega nova. Fluxo: resolve a configuração e
 * o segredo, envia sob o disjuntor do workspace, e persiste o resultado
 * (sucesso ou falha, sempre com entrada de auditoria). Best-effort por
 * desenho: nunca lança — a ausência de configuração, uma credencial
 * inacessível ou uma falha de rede todas resultam em `configurado: false`
 * ou `entregue: false`, nunca numa exceção que o chamador precisa tratar.
 */
export async function despacharEventoConnectHubAdmin(
  input: DespacharEventoAdminInput
): Promise<ResultadoDespachoInterno> {
  const agora = input.agora ?? new Date();
  const executor = input.executor ?? executorEnvioFetch;

  const tentativa = await tentarEnviarSobDisjuntor(input.workspaceId, input.payload, executor);
  if (!tentativa.configurado) {
    return { configurado: false, entregue: false, enfileirado: false };
  }

  const chaveHmac = input.chaveHmac ?? (await chaveAuditoria());
  const proximo = decidirProximoEstadoEntrega(0, tentativa.entregue, agora);
  const delivery: ConnectHubDelivery = {
    id: novoIdEntrega(),
    workspaceId: input.workspaceId,
    webhookUrl: tentativa.webhookUrl ?? "",
    payload: input.payload,
    // A assinatura em si não é recalculada aqui para o registro — o que
    // importa para auditoria é QUE o payload foi assinado e despachado, não
    // reter uma segunda cópia da assinatura fora do envio real.
    assinatura: "",
    status: proximo.status,
    tentativas: proximo.tentativas,
    criadoEm: agora.toISOString(),
    ultimaTentativaEm: agora.toISOString(),
    proximaTentativaEm: proximo.proximaTentativaEm,
  };

  try {
    await registrarEntrega(delivery, tentativa.entregue, chaveHmac);
  } catch (erro) {
    console.error(`[connect-hub] falha ao registrar a entrega ${delivery.id} na fila/auditoria:`, erro);
  }

  return {
    configurado: true,
    entregue: tentativa.entregue,
    enfileirado: !tentativa.entregue,
    deliveryId: delivery.id,
  };
}

/**
 * Drena a fila de retry do workspace: para cada entrega pendente (`falhou`)
 * cuja `proximaTentativaEm` já passou, tenta reenviar sob a configuração
 * MAIS RECENTE do workspace e atualiza o MESMO documento de entrega (nunca
 * cria um novo). Chamada repetidamente por um scheduler externo — mesmo
 * padrão de `drenarFilaReputacaoCanal`/`processarTickCampanhas`.
 */
export async function drenarFilaConnectHub(
  workspaceId: string,
  opcoes: { executor?: ExecutorEnvioWebhook; chaveHmac?: Uint8Array; agora?: Date; limite?: number } = {}
): Promise<{ processados: number; entregues: number; descartados: number; aindaPendentes: number }> {
  const db = firestoreAdmin();
  const agora = opcoes.agora ?? new Date();
  const executor = opcoes.executor ?? executorEnvioFetch;
  const limite = opcoes.limite ?? 50;
  const chaveHmac = opcoes.chaveHmac ?? (await chaveAuditoria());

  const snapshot = await db
    .collection(COLECAO_ENTREGAS)
    .where("workspaceId", "==", workspaceId)
    .where("status", "==", "falhou")
    .limit(limite)
    .get();

  let processados = 0;
  let entregues = 0;
  let descartados = 0;

  for (const documento of snapshot.docs) {
    const delivery = documento.data() as ConnectHubDelivery;
    if (delivery.proximaTentativaEm && new Date(delivery.proximaTentativaEm).getTime() > agora.getTime()) {
      continue; // Ainda não chegou a hora desta entrega — backoff respeitado.
    }
    processados += 1;

    const tentativa = await tentarEnviarSobDisjuntor(delivery.workspaceId, delivery.payload, executor);
    const proximo = decidirProximoEstadoEntrega(delivery.tentativas, tentativa.entregue, agora);

    const deliveryAtualizada: ConnectHubDelivery = {
      ...delivery,
      status: proximo.status,
      tentativas: proximo.tentativas,
      ultimaTentativaEm: agora.toISOString(),
      proximaTentativaEm: proximo.proximaTentativaEm,
    };

    try {
      await registrarEntrega(deliveryAtualizada, tentativa.entregue, chaveHmac);
    } catch (erro) {
      console.error(`[connect-hub] falha ao atualizar a entrega ${delivery.id} na drenagem:`, erro);
    }

    if (proximo.status === "entregue") entregues += 1;
    if (proximo.status === "descartado") descartados += 1;
  }

  const pendentesSnapshot = await db
    .collection(COLECAO_ENTREGAS)
    .where("workspaceId", "==", workspaceId)
    .where("status", "==", "falhou")
    .get();

  return { processados, entregues, descartados, aindaPendentes: pendentesSnapshot.size };
}
