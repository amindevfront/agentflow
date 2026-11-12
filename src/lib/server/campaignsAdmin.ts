// Motor de campanhas — processamento real do tick (Admin SDK).
//
// SERVER-ONLY.
//
// Chamado repetidamente por `/api/campaigns/tick` (que um scheduler externo —
// Cloud Scheduler, cron — invoca periodicamente). Cada chamada processa
// apenas os envios cujo horário já chegou, em todas as campanhas agendadas do
// workspace, via Admin SDK — a mesma razão de privilégio de
// `orchestratorAdmin.ts`: escrever em `campaigns/*/destinatarios` com status
// "enviado"/"falhou" é uma transição que as regras do Firestore negam a um
// cliente comum (ver `firestore.rules`).
//
// O envio real a um canal de mensageria (WhatsApp Business Cloud API, etc.)
// entra por injeção (`EnviarCanalReal`) — `enviarCanalPadrao` é o
// comportamento de produção: sem credenciais do canal configuradas, ele
// nunca finge sucesso, falha de forma controlada e visível (o destinatário
// fica "falhou" com o motivo exato), igual ao padrão já usado para
// `ANTHROPIC_API_KEY` ausente no motor de orquestração.

import type { Campaign, CampaignRecipient, Canal, ItemFilaReputacaoCanal, OptOutEntry, ResultadoDrenagemFilaReputacao } from "@/types";
import { abrirSegredo, montarAad } from "@/lib/crypto/envelope";
import { processarEnviosDevidos, type EnviarMensagem } from "@/lib/campaigns/stochasticEngine";
import { avaliarEEnviarComBlindagem, drenarFilaReputacaoCanal } from "./channelReputationShieldAdmin";
import { firestoreAdmin } from "./firebaseAdmin";

const COLECAO_CAMPANHAS = "campaigns";
const SUBCOLECAO_DESTINATARIOS = "destinatarios";
const COLECAO_VAULT_DESTINATARIOS = "recipientVaults";
const COLECAO_OPT_OUTS = "optOuts";

/** Variáveis de ambiente que, por canal, indicam um provedor real configurado. */
const VARIAVEL_POR_CANAL: Record<Canal, string> = {
  whatsapp: "WHATSAPP_CLOUD_API_TOKEN",
  instagram: "META_GRAPH_API_TOKEN",
  facebook: "META_GRAPH_API_TOKEN",
  webchat: "", // webchat não tem provedor externo — a entrega é interna ao app
  email: "EMAIL_PROVIDER_API_KEY",
  sms: "TWILIO_AUTH_TOKEN",
  // Telegram não tem UMA variável global: o token é por-bot, vaultado por
  // conector (ver `@/lib/server/telegramBotAdmin`) — mesmo motivo de
  // `webchat` não ter uma única variável que "indique provedor configurado".
  telegram: "",
};

export type EnviarCanalReal = (
  canal: Canal,
  destinoEmClaro: string,
  mensagem: string
) => Promise<boolean>;

/**
 * Comportamento de produção: sem a credencial do canal configurada, falha de
 * forma controlada e explícita — nunca finge um envio que não aconteceu.
 * Credenciais reais, quando configuradas, tornam esta função o ponto de
 * integração com o provedor real (substituível via injeção em teste).
 */
export const enviarCanalPadrao: EnviarCanalReal = async (canal) => {
  const variavel = VARIAVEL_POR_CANAL[canal];
  if (!variavel || !process.env[variavel]?.trim()) {
    throw new Error(
      `Canal "${canal}" sem provedor configurado (variável ${variavel || "N/D"}). ` +
        "Integração real pendente de credenciais."
    );
  }
  // Nenhum provedor real está integrado nesta versão — mesmo com a variável
  // presente, o envio real ainda não tem para onde ir. Falha explícita, não
  // um sucesso fictício.
  throw new Error(`Integração real do canal "${canal}" ainda não implementada.`);
};

/**
 * Codifica a referência de volta ao destinatário original — ver
 * `ItemFilaReputacaoCanal.origemReferencia`. JSON em vez de concatenação com
 * separador: `campaignId`/`recipientId` são ids gerados pelo próprio
 * AgentFlow e não têm garantia de nunca conter o separador escolhido, então
 * concatenar e tentar `split` de volta seria uma fonte de bug sutil sob um
 * id adversarial ou apenas incomum.
 */
function codificarOrigemReferencia(campaignId: string, recipientId: string): string {
  return JSON.stringify({ campaignId, recipientId });
}

function decodificarOrigemReferencia(origemReferencia: string): { campaignId: string; recipientId: string } | null {
  try {
    const dados = JSON.parse(origemReferencia) as { campaignId?: unknown; recipientId?: unknown };
    if (typeof dados.campaignId !== "string" || typeof dados.recipientId !== "string") return null;
    return { campaignId: dados.campaignId, recipientId: dados.recipientId };
  } catch {
    return null;
  }
}

/**
 * Envolve o executor de envio de uma campanha com a Blindagem de Reputação
 * de Canal do SAC Shield (`./channelReputationShieldAdmin`): todo disparo
 * passa pelo disjuntor do canal e pelo limite distribuído de volume antes de
 * tocar o provedor real. Um disparo de risco (pico de volume, conteúdo com
 * termo de risco de spam, ou canal instável) nunca é simplesmente tentado —
 * é contido e enfileirado para reenvio automático (`origemReferencia`
 * carrega como encontrar o destinatário de novo, já que `destinoHash` é
 * irreversível por desenho); o destinatário da campanha fica "falhou" com o
 * motivo explícito nesta execução (nunca finge sucesso), mas a mensagem em
 * si sobrevive na fila `channelReputationQueue` para a próxima drenagem
 * (`processarFilaReputacaoCampanhas`).
 */
function comBlindagemDeReputacao(
  executor: EnviarMensagem,
  workspaceId: string,
  campaignId: string,
  canal: Canal
): EnviarMensagem {
  return async (recipient, mensagem) => {
    const resultado = await avaliarEEnviarComBlindagem({
      workspaceId,
      canal,
      destinoHash: recipient.destinoHash,
      mensagem,
      origemReferencia: codificarOrigemReferencia(campaignId, recipient.id),
      enviar: () => executor(recipient, mensagem),
    });

    if (resultado.enfileirado) {
      throw new Error(
        "Disparo contido pela Blindagem de Reputação de Canal (SAC Shield) — enfileirado para reenvio automático: " +
          `${resultado.avaliacao.motivos.join("; ") || "sem motivo detalhado"}.`
      );
    }

    return resultado.enviado;
  };
}

/** Decifra o destino real de um destinatário a partir do seu envelope selado. */
async function abrirDestinoReal(campaignId: string, recipientId: string, workspaceId: string): Promise<string> {
  const db = firestoreAdmin();
  const snap = await db.collection(COLECAO_VAULT_DESTINATARIOS).doc(`${campaignId}__${recipientId}`).get();
  if (!snap.exists) {
    throw new Error(`Envelope do destinatário ${recipientId} não encontrado.`);
  }
  const dados = snap.data() as { envelope: Parameters<typeof abrirSegredo>[0] };
  const aad = montarAad({
    workspaceId,
    recursoId: `${campaignId}__${recipientId}`,
    versao: 1,
    proposito: "destinatario-campanha",
  });
  return abrirSegredo(dados.envelope, aad);
}

function criarExecutorReal(
  campaignId: string,
  workspaceId: string,
  canal: Canal,
  enviarCanal: EnviarCanalReal
): EnviarMensagem {
  return async (recipient, mensagem) => {
    // O valor decifrado existe só na variável local desta chamada — strings
    // em JS são imutáveis (não há como "zerar" a memória como se faz com um
    // Uint8Array), então a proteção real é de escopo: nada aqui o anexa a um
    // objeto de vida mais longa, a um log ou a um erro propagado.
    const destinoReal = await abrirDestinoReal(campaignId, recipient.id, workspaceId);
    return enviarCanal(canal, destinoReal, mensagem);
  };
}

/**
 * Resolve o destino real de um item da fila de reputação originado de uma
 * campanha e tenta o reenvio de fato — a implementação de
 * `ResolverEReenviarItemFila` específica de campanhas, injetada em
 * `drenarFilaReputacaoCanal` por `processarFilaReputacaoCampanhas`.
 */
export async function reenviarItemFilaReputacaoDeCampanha(
  item: ItemFilaReputacaoCanal,
  workspaceId: string,
  enviarCanal: EnviarCanalReal = enviarCanalPadrao
): Promise<boolean> {
  if (!item.origemReferencia) return false;
  const referencia = decodificarOrigemReferencia(item.origemReferencia);
  if (!referencia) return false;

  const destinoReal = await abrirDestinoReal(referencia.campaignId, referencia.recipientId, workspaceId);
  return enviarCanal(item.canal, destinoReal, item.mensagem);
}

/**
 * Drena a fila de reputação do workspace para os itens originados de
 * campanhas — chamada ao final de `processarTickCampanhas`, mesmo ciclo de
 * vida de `/api/campaigns/tick`: o mesmo tick que dispara os envios devidos
 * também dá às mensagens contidas na execução anterior uma nova chance.
 */
export async function processarFilaReputacaoCampanhas(
  workspaceId: string,
  enviarCanal: EnviarCanalReal = enviarCanalPadrao
): Promise<ResultadoDrenagemFilaReputacao> {
  return drenarFilaReputacaoCanal(workspaceId, (item) =>
    reenviarItemFilaReputacaoDeCampanha(item, workspaceId, enviarCanal)
  );
}

export interface ProcessarTickResultado {
  campanhasProcessadas: number;
  enviosRealizados: number;
  enviosBloqueados: number;
  enviosFalhos: number;
  campanhasConcluidas: number;
  reputacaoCanal: ResultadoDrenagemFilaReputacao;
}

/**
 * Processa um tick de campanhas: para cada campanha agendada/em execução do
 * workspace, envia o que já venceu e persiste o resultado via Admin SDK.
 */
export async function processarTickCampanhas(
  workspaceId: string,
  enviarCanal: EnviarCanalReal = enviarCanalPadrao
): Promise<ProcessarTickResultado> {
  const db = firestoreAdmin();
  const agora = new Date();

  const campanhasSnap = await db
    .collection(COLECAO_CAMPANHAS)
    .where("workspaceId", "==", workspaceId)
    .where("status", "in", ["agendada", "em-execucao"])
    .get();

  const optOutsSnap = await db.collection(COLECAO_OPT_OUTS).where("workspaceId", "==", workspaceId).get();
  const optOuts: Pick<OptOutEntry, "destinoHash">[] = optOutsSnap.docs.map(
    (d) => ({ destinoHash: (d.data() as OptOutEntry).destinoHash })
  );

  let enviosRealizados = 0;
  let enviosBloqueados = 0;
  let enviosFalhos = 0;
  let campanhasConcluidas = 0;

  for (const campanhaDoc of campanhasSnap.docs) {
    const campanha = campanhaDoc.data() as Campaign;

    const destinatariosSnap = await db
      .collection(COLECAO_CAMPANHAS)
      .doc(campanha.id)
      .collection(SUBCOLECAO_DESTINATARIOS)
      .where("status", "==", "pendente")
      .get();

    const candidatos = destinatariosSnap.docs.map((d) => ({ ...(d.data() as CampaignRecipient), id: d.id }));
    if (candidatos.length === 0) continue;

    // Reivindica cada destinatário numa transação que RELÊ o status atual
    // antes de marcá-lo "enviando" — se dois ticks rodarem em paralelo (cron
    // duplicado/retry da Vercel), ambos leriam "pendente" na varredura acima
    // e, sem esta reivindicação, ambos ENVIARIAM a mesma mensagem real ao
    // mesmo destinatário (o guard interno de `processarEnviosDevidos` só
    // olha o status na CÓPIA em memória de cada execução, que em ambas é
    // "pendente" — não impede o envio duplicado). Só segue para
    // `processarEnviosDevidos` quem esta execução conseguiu reivindicar.
    const refDestinatario = (id: string) =>
      db.collection(COLECAO_CAMPANHAS).doc(campanha.id).collection(SUBCOLECAO_DESTINATARIOS).doc(id);

    const reivindicados: CampaignRecipient[] = [];
    for (const candidato of candidatos) {
      const ref = refDestinatario(candidato.id);
      const reivindicado = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return false;
        const atual = snap.data() as CampaignRecipient;
        if (atual.status !== "pendente") return false;
        tx.update(ref, { status: "enviando" });
        return true;
      });
      if (reivindicado) reivindicados.push(candidato);
    }
    if (reivindicados.length === 0) continue;

    try {
      const executorBlindado = comBlindagemDeReputacao(
        criarExecutorReal(campanha.id, workspaceId, campanha.canal, enviarCanal),
        workspaceId,
        campanha.id,
        campanha.canal
      );

      const resultado = await processarEnviosDevidos({
        campanha: { mensagemTemplate: campanha.mensagemTemplate, workspaceId },
        destinatarios: reivindicados,
        optOuts,
        enviar: executorBlindado,
        agora,
      });

      const lote = db.batch();
      for (const destinatario of resultado.destinatariosAtualizados) {
        lote.set(refDestinatario(destinatario.id), destinatario);
      }

      const totalEnviadosAgora = campanha.totalEnviados + resultado.enviadosNestaExecucao;
      const totalBloqueadosAgora = campanha.totalBloqueados + resultado.bloqueadosNestaExecucao;
      const totalFalhasAgora = campanha.totalFalhas + resultado.falhasNestaExecucao;
      const totalFinalizado = totalEnviadosAgora + totalBloqueadosAgora + totalFalhasAgora;
      const concluida = totalFinalizado >= campanha.totalDestinatarios;

      lote.update(db.collection(COLECAO_CAMPANHAS).doc(campanha.id), {
        status: concluida ? "concluida" : "em-execucao",
        totalEnviados: totalEnviadosAgora,
        totalBloqueados: totalBloqueadosAgora,
        totalFalhas: totalFalhasAgora,
        concluidaEm: concluida ? agora.toISOString() : null,
      });
      await lote.commit();

      enviosRealizados += resultado.enviadosNestaExecucao;
      enviosBloqueados += resultado.bloqueadosNestaExecucao;
      enviosFalhos += resultado.falhasNestaExecucao;
      if (concluida) campanhasConcluidas += 1;
    } catch (erro) {
      // Nunca deixar um destinatário reivindicado ("enviando") travado para
      // sempre por uma falha no meio do processamento desta campanha — devolve
      // para "pendente" para que o próximo tick tente de novo, e segue para as
      // demais campanhas em vez de abortar o tick inteiro.
      console.error(`[campaigns/tick] falha ao processar campanha ${campanha.id}:`, erro);
      const loteDeRollback = db.batch();
      for (const destinatario of reivindicados) {
        loteDeRollback.update(refDestinatario(destinatario.id), { status: "pendente" });
      }
      await loteDeRollback.commit().catch((erroRollback) => {
        console.error(`[campaigns/tick] falha ao reverter reivindicação da campanha ${campanha.id}:`, erroRollback);
      });
    }
  }

  // Mesmo tick também dá uma nova chance às mensagens contidas por risco de
  // reputação em execuções anteriores — o disjuntor ou o pico de volume que
  // as bloqueou podem já ter se normalizado.
  const reputacaoCanal = await processarFilaReputacaoCampanhas(workspaceId, enviarCanal);

  return {
    campanhasProcessadas: campanhasSnap.size,
    enviosRealizados,
    enviosBloqueados,
    enviosFalhos,
    campanhasConcluidas,
    reputacaoCanal,
  };
}
