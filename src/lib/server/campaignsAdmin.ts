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

import type { Campaign, CampaignRecipient, Canal, OptOutEntry } from "@/types";
import { abrirSegredo, montarAad } from "@/lib/crypto/envelope";
import { processarEnviosDevidos, type EnviarMensagem } from "@/lib/campaigns/stochasticEngine";
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

export interface ProcessarTickResultado {
  campanhasProcessadas: number;
  enviosRealizados: number;
  enviosBloqueados: number;
  enviosFalhos: number;
  campanhasConcluidas: number;
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

    const destinatarios = destinatariosSnap.docs.map((d) => ({ ...(d.data() as CampaignRecipient), id: d.id }));
    if (destinatarios.length === 0) continue;

    const resultado = await processarEnviosDevidos({
      campanha: { mensagemTemplate: campanha.mensagemTemplate, workspaceId },
      destinatarios,
      optOuts,
      enviar: criarExecutorReal(campanha.id, workspaceId, campanha.canal, enviarCanal),
      agora,
    });

    const lote = db.batch();
    for (const destinatario of resultado.destinatariosAtualizados) {
      lote.set(
        db.collection(COLECAO_CAMPANHAS).doc(campanha.id).collection(SUBCOLECAO_DESTINATARIOS).doc(destinatario.id),
        destinatario
      );
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
  }

  return {
    campanhasProcessadas: campanhasSnap.size,
    enviosRealizados,
    enviosBloqueados,
    enviosFalhos,
    campanhasConcluidas,
  };
}
