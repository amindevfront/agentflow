// SAC Shield — Blindagem de Reputação de Canal (anti-banimento), lado servidor.
//
// SERVER-ONLY.
//
// Composição de três mecanismos já existentes, nenhum reinventado:
//
//   - `./distributedRateLimit` decide se o canal (por workspace) está sob um
//     pico de volume anômalo — reaproveita o token bucket distribuído em
//     vez de um segundo contador em memória, que seria bypassável entre
//     instâncias (Fluid Compute) exatamente como o comentário daquele
//     módulo documenta.
//   - `./externalApiBreaker` (`DisjuntorChamadaExterna`) isola a conexão com
//     o provedor externo do canal quando ela começa a falhar — um disjuntor
//     por `workspaceId:canal`, nunca um único disjuntor global (um canal
//     instável não deve bloquear os demais).
//   - `@/lib/channelReputationShield` combina os dois sinais acima com o
//     conteúdo da mensagem (léxico de risco de spam) em um veredito único.
//
// Quando o veredito é "não envie agora", a mensagem NUNCA é descartada
// silenciosamente: ela é selada na fila `channelReputationQueue` (Admin SDK)
// para reenvio automático por `drenarFilaReputacaoCanal`, e a contenção é
// registrada na trilha de auditoria (severidade crítica) — rastreabilidade
// forense do item 3 do SAC Shield aplicada também aqui, não só no handoff.

import type { Transaction } from "firebase-admin/firestore";
import type {
  AuditEventBody,
  AvaliacaoRiscoDisparoCanal,
  Canal,
  ItemFilaReputacaoCanal,
  ResultadoDrenagemFilaReputacao,
  ResultadoEnvioBlindado,
  StatusItemFilaReputacao,
} from "@/types";
import { JITTER_CONFIG_PADRAO } from "@/types";
import { avaliarRiscoDisparoCanal } from "@/lib/channelReputationShield";
import { executarTransacaoDeSelo } from "./auditChainStore";
import type { ConfiguracaoLimite } from "./rateLimit";
import { consumirLimiteDistribuido } from "./distributedRateLimit";
import { chaveAuditoria } from "./env";
import { DisjuntorChamadaExterna, ErroDisjuntorAberto } from "./externalApiBreaker";
import { firestoreAdmin } from "./firebaseAdmin";

const COLECAO_FILA = "channelReputationQueue";

/** Tentativas antes de descartar definitivamente um item da fila — evita retenção indefinida de uma mensagem irrecuperável. */
export const MAX_TENTATIVAS_FILA_REPUTACAO = 5;

function novoIdFila(): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `sacq_${aleatorio}`;
}

const disjuntoresPorChave = new Map<string, DisjuntorChamadaExterna>();

/** Um disjuntor por `workspaceId:canal` — um canal instável nunca bloqueia os demais. */
export function disjuntorDoCanal(workspaceId: string, canal: Canal): DisjuntorChamadaExterna {
  const chave = `${workspaceId}:${canal}`;
  let disjuntor = disjuntoresPorChave.get(chave);
  if (!disjuntor) {
    disjuntor = new DisjuntorChamadaExterna(`canal:${chave}`, { limiarFalhas: 5, resfriamentoMs: 60_000 });
    disjuntoresPorChave.set(chave, disjuntor);
  }
  return disjuntor;
}

/** Usado apenas em teste, para isolar casos entre si — mesmo papel de `resetarAdminParaTeste`. */
export function _resetarDisjuntoresDeCanalParaTeste(): void {
  disjuntoresPorChave.clear();
}

/**
 * Converte o teto anti-ban já usado pelas campanhas
 * (`JITTER_CONFIG_PADRAO.taxaMaximaPorMinuto`) em configuração de token
 * bucket — mesmo teto, não um segundo número mantido à parte.
 */
export function limiteVolumeCanal(): ConfiguracaoLimite {
  const taxaPorMinuto = JITTER_CONFIG_PADRAO.taxaMaximaPorMinuto;
  return { capacidade: taxaPorMinuto, taxaPorSegundo: taxaPorMinuto / 60 };
}

/**
 * Corpo da transação de enfileiramento — recebe `tx`/`db` como o subconjunto
 * que usa (mesmo desenho de `executarTransacaoDeSelo`), testável com um
 * dublê de Firestore. Persiste o item da fila e sela a entrada de auditoria
 * na MESMA transação: a contenção de um disparo e o registro forense
 * avançam juntos ou nenhum avança.
 */
export async function executarTransacaoEnfileiramento(
  tx: Pick<Transaction, "get" | "set">,
  db: Pick<ReturnType<typeof firestoreAdmin>, "collection">,
  entrada: {
    item: ItemFilaReputacaoCanal;
    workspaceId: string;
    chaveHmac: Uint8Array;
  }
): Promise<ItemFilaReputacaoCanal> {
  const refItem = db.collection(COLECAO_FILA).doc(entrada.item.id);
  tx.set(refItem, entrada.item);

  const corpo: AuditEventBody = {
    tipo: "sacshield.canal.disparo-contido",
    resultado: "negado",
    workspaceId: entrada.workspaceId,
    ator: "sistema",
    recurso: `${COLECAO_FILA}/${entrada.item.id}`,
    severidade: entrada.item.nivel === "critico" ? "critica" : "alta",
    detalhes: {
      canal: entrada.item.canal,
      destinoHash: entrada.item.destinoHash,
      nivel: entrada.item.nivel,
      motivos: entrada.item.motivos.join("; ") || "sem motivo detalhado",
    },
    ocorridoEm: entrada.item.criadoEm,
  };
  await executarTransacaoDeSelo(tx, db, entrada.workspaceId, corpo, entrada.chaveHmac);

  return entrada.item;
}

async function enfileirarMensagemContida(input: {
  workspaceId: string;
  canal: Canal;
  destinoHash: string;
  mensagem: string;
  avaliacao: AvaliacaoRiscoDisparoCanal;
  chaveHmac: Uint8Array;
  origemReferencia?: string | null;
  agora?: Date;
}): Promise<ItemFilaReputacaoCanal> {
  const db = firestoreAdmin();
  const agora = input.agora ?? new Date();

  const item: ItemFilaReputacaoCanal = {
    id: novoIdFila(),
    workspaceId: input.workspaceId,
    canal: input.canal,
    destinoHash: input.destinoHash,
    mensagem: input.mensagem,
    motivos: input.avaliacao.motivos,
    nivel: input.avaliacao.nivel,
    status: "pendente",
    tentativas: 0,
    criadoEm: agora.toISOString(),
    ultimaTentativaEm: null,
    origemReferencia: input.origemReferencia ?? null,
  };

  const persistido = await db.runTransaction((tx) =>
    executarTransacaoEnfileiramento(tx, db, { item, workspaceId: input.workspaceId, chaveHmac: input.chaveHmac })
  );

  console.error(
    `[sac-shield:CRITICO] disparo ao canal "${input.canal}" (workspace ${input.workspaceId}) contido e ` +
      `enfileirado — ${input.avaliacao.motivos.join("; ") || "sem motivo detalhado"}.`
  );

  return persistido;
}

export interface EntradaEnvioBlindado {
  workspaceId: string;
  canal: Canal;
  destinoHash: string;
  mensagem: string;
  enviar: () => Promise<boolean>;
  /** Referência de volta à origem do disparo — ver `ItemFilaReputacaoCanal.origemReferencia`. */
  origemReferencia?: string | null;
  /** Injetável em teste; em produção é sempre `chaveAuditoria()`. */
  chaveHmac?: Uint8Array;
}

/**
 * Avalia o risco de reputação do canal e, se permitido, executa o envio real
 * sob o disjuntor do canal. Se não permitido (ou se o disjuntor abrir
 * exatamente durante a tentativa — corrida genuína sob concorrência real),
 * a mensagem é enfileirada para reenvio em vez de falhar silenciosamente.
 */
export async function avaliarEEnviarComBlindagem(entrada: EntradaEnvioBlindado): Promise<ResultadoEnvioBlindado> {
  const disjuntor = disjuntorDoCanal(entrada.workspaceId, entrada.canal);
  const chaveLimite = `sac-shield:canal:${entrada.workspaceId}:${entrada.canal}`;
  const limite = await consumirLimiteDistribuido(chaveLimite, limiteVolumeCanal());

  const avaliacao = avaliarRiscoDisparoCanal({
    texto: entrada.mensagem,
    limiteDeVolumeExcedido: !limite.permitido,
    disjuntorAberto: disjuntor.estadoAtual() === "aberto",
  });

  if (!avaliacao.permitido) {
    const chaveHmac = entrada.chaveHmac ?? (await chaveAuditoria());
    await enfileirarMensagemContida({
      workspaceId: entrada.workspaceId,
      canal: entrada.canal,
      destinoHash: entrada.destinoHash,
      mensagem: entrada.mensagem,
      avaliacao,
      chaveHmac,
      origemReferencia: entrada.origemReferencia,
    });
    return { enviado: false, enfileirado: true, avaliacao };
  }

  try {
    const sucesso = await disjuntor.executar(entrada.enviar);
    return { enviado: sucesso, enfileirado: false, avaliacao };
  } catch (erro) {
    if (!(erro instanceof ErroDisjuntorAberto)) throw erro;

    // O disjuntor abriu ENTRE a checagem acima e esta tentativa — mesmo
    // tratamento do caminho "não permitido": enfileira em vez de perder a
    // mensagem ou propagar uma falha que o chamador trataria como
    // definitiva.
    const avaliacaoAtualizada: AvaliacaoRiscoDisparoCanal = {
      ...avaliacao,
      nivel: "critico",
      permitido: false,
      motivos: [...avaliacao.motivos, "disjuntor abriu durante a tentativa de envio"],
    };
    const chaveHmac = entrada.chaveHmac ?? (await chaveAuditoria());
    await enfileirarMensagemContida({
      workspaceId: entrada.workspaceId,
      canal: entrada.canal,
      destinoHash: entrada.destinoHash,
      mensagem: entrada.mensagem,
      avaliacao: avaliacaoAtualizada,
      chaveHmac,
      origemReferencia: entrada.origemReferencia,
    });
    return { enviado: false, enfileirado: true, avaliacao: avaliacaoAtualizada };
  }
}

/**
 * Decide o próximo estado de um item da fila após uma tentativa de reenvio —
 * função pura, diretamente testável. Esgotar `MAX_TENTATIVAS_FILA_REPUTACAO`
 * sem sucesso descarta o item (ele já não é recuperável automaticamente);
 * qualquer tentativa anterior a essa apenas incrementa o contador e
 * permanece "pendente" para a próxima drenagem.
 */
export function decidirProximoEstadoFila(
  tentativasAtuais: number,
  resultado: "enviado" | "contido"
): { status: StatusItemFilaReputacao; tentativas: number } {
  const tentativas = tentativasAtuais + 1;
  if (resultado === "enviado") return { status: "reenviado", tentativas };
  if (tentativas >= MAX_TENTATIVAS_FILA_REPUTACAO) return { status: "descartado", tentativas };
  return { status: "pendente", tentativas };
}

/**
 * Resolve o destino real do item (`destinoHash` é irreversível por desenho)
 * a partir de `origemReferencia` e tenta o reenvio de fato — cada origem
 * sabe o próprio significado da referência (ex.: `reenviarItemFilaReputacaoDeCampanha`
 * em `@/lib/server/campaignsAdmin`, que a interpreta como
 * `${campaignId}__${recipientId}` e decifra o envelope do destinatário).
 */
export type ResolverEReenviarItemFila = (item: ItemFilaReputacaoCanal) => Promise<boolean>;

/**
 * Drena a fila de reputação do workspace: para cada item pendente, reavalia
 * o risco do zero (o disjuntor e o limite de volume podem ter mudado desde o
 * enfileiramento) e tenta reenviar os que agora passam, via `resolverEReenviar`
 * injetado pelo chamador. Chamada repetidamente (ex.: ao final de
 * `/api/campaigns/tick`, mesmo padrão de `processarTickCampanhas`) — nunca a
 * fila inteira de uma vez além de `limite`, para que uma fila grande não
 * trave a requisição.
 */
export async function drenarFilaReputacaoCanal(
  workspaceId: string,
  resolverEReenviar: ResolverEReenviarItemFila,
  limite = 50
): Promise<ResultadoDrenagemFilaReputacao> {
  const db = firestoreAdmin();
  const snapshot = await db
    .collection(COLECAO_FILA)
    .where("workspaceId", "==", workspaceId)
    .where("status", "==", "pendente")
    .limit(limite)
    .get();

  let processados = 0;
  let reenviados = 0;
  let descartados = 0;

  for (const documento of snapshot.docs) {
    const item = documento.data() as ItemFilaReputacaoCanal;
    processados += 1;

    const disjuntor = disjuntorDoCanal(item.workspaceId, item.canal);
    const chaveLimite = `sac-shield:canal:${item.workspaceId}:${item.canal}`;
    const limiteResultado = await consumirLimiteDistribuido(chaveLimite, limiteVolumeCanal());
    const avaliacao = avaliarRiscoDisparoCanal({
      texto: item.mensagem,
      limiteDeVolumeExcedido: !limiteResultado.permitido,
      disjuntorAberto: disjuntor.estadoAtual() === "aberto",
    });

    let sucesso = false;
    if (avaliacao.permitido) {
      try {
        sucesso = await disjuntor.executar(() => resolverEReenviar(item));
      } catch {
        sucesso = false;
      }
    }

    const proximo = decidirProximoEstadoFila(item.tentativas, sucesso ? "enviado" : "contido");
    await documento.ref.update({
      status: proximo.status,
      tentativas: proximo.tentativas,
      ultimaTentativaEm: new Date().toISOString(),
    });

    if (proximo.status === "reenviado") reenviados += 1;
    if (proximo.status === "descartado") descartados += 1;
  }

  const pendentesSnapshot = await db
    .collection(COLECAO_FILA)
    .where("workspaceId", "==", workspaceId)
    .where("status", "==", "pendente")
    .get();

  return { processados, reenviados, descartados, aindaPendentes: pendentesSnapshot.size };
}
