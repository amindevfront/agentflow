// Pipeline de ingestão e envio do Instagram Direct / Facebook Messenger
// (Meta Graph API) — SERVER-ONLY, Admin SDK.
//
// Mesmo racional do WhatsApp Cloud API (`@/lib/server/whatsappCloudApiAdmin`)
// e do SMS/Twilio (`@/lib/server/twilioSmsAdmin`): reaproveita as peças PURAS
// do pipeline autenticado (Shield-Layer, Radar de Sentimento, Circuit
// Breaker) para que uma mensagem de Instagram/Facebook receba exatamente a
// mesma proteção que qualquer outro canal.
//
// Diferente do WhatsApp (um conector por `phone_number_id`), este módulo é
// PARAMETRIZADO por canal (`"instagram" | "facebook"`): os dois produtos
// compartilham o mesmo Meta App, o mesmo segredo de assinatura de webhook
// (`META_WEBHOOK_SECRET`, já usado pelo WhatsApp) e o mesmo token de envio
// (`META_PAGE_ACCESS_TOKEN`) — só o tipo de conector e o campo de roteamento
// (`metaPageId`) mudam por canal.
//
// Corte de escopo deliberado, idêntico ao do WhatsApp/SMS: handoffs com
// Resumo Executivo específicos de vertical ficam de fora desta v1.
//
// Mapeamento sender↔workspace: resolvido pelo `metaPageId` gravado no
// conector ("Instagram Direct (Meta Graph API)" / "Facebook Messenger (Meta
// Graph API)") — é o `recipient.id` que a Meta inclui em TODO webhook real
// de mensagem (`entry[].messaging[].recipient.id`), não o id do remetente
// (que identifica o cliente, não o workspace).

import type { Conversation, ConversationMessage, MessageSender } from "@/types";
import { interceptarMensagem } from "@/lib/guardrails/piiVault";
import { selarSegredo } from "@/lib/crypto/envelope";
import { LIMIAR_FRUSTRACAO_CRITICA, calcularFrustration } from "@/lib/sentiment/radar";
import { fetchComTimeout } from "@/lib/fetchComTimeout";
import { registrarInteracaoEpisodica } from "./episodicMemory";
import { firestoreAdmin } from "./firebaseAdmin";
import { abrirTransbordoAdmin } from "./hitlStore";

/** Prazo máximo para a chamada real à Meta — nunca deixar a function serverless pendurada esperando uma resposta que pode nunca chegar. */
const TIMEOUT_ENVIO_MS = 10_000;

const COLECAO_CONVERSAS = "conversations";
const SUBCOLECAO_MENSAGENS = "mensagens";
const COLECAO_VAULT_MENSAGENS = "messageVaults";
const COLECAO_CONECTORES = "connectors";

export type CanalMetaMessaging = "instagram" | "facebook";

export const TIPO_CONECTOR_INSTAGRAM = "Instagram Direct (Meta Graph API)";
export const TIPO_CONECTOR_FACEBOOK = "Facebook Messenger (Meta Graph API)";

function tipoConectorPorCanal(canal: CanalMetaMessaging): string {
  return canal === "instagram" ? TIPO_CONECTOR_INSTAGRAM : TIPO_CONECTOR_FACEBOOK;
}

function nomeClientePadrao(canal: CanalMetaMessaging): string {
  return canal === "instagram" ? "Cliente Instagram" : "Cliente Facebook";
}

const SLA_RESPOSTA_SEGUNDOS = { p1: 60, p2: 180, p3: 600, p4: 1800 } as const;

function novoId(prefixo: string): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefixo}_${aleatorio}`;
}

export interface ConectorMetaMessaging {
  workspaceId: string;
  metaPageId: string;
}

/**
 * Resolve qual workspace é dono de um `pageId` (`recipient.id` do webhook) —
 * a ÚNICA forma de um webhook anônimo do Meta (sem nenhuma sessão Firebase)
 * saber a quem a mensagem pertence. Sem conector cadastrado com este id para
 * este canal específico, devolve `null` — a rota traduz isso em "ingestão
 * recusada", nunca grava às cegas.
 */
export async function resolverConectorPorPageId(
  pageId: string,
  canal: CanalMetaMessaging
): Promise<ConectorMetaMessaging | null> {
  const snap = await firestoreAdmin()
    .collection(COLECAO_CONECTORES)
    .where("tipo", "==", tipoConectorPorCanal(canal))
    .where("metaPageId", "==", pageId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const dados = snap.docs[0].data() as { workspaceId: string; metaPageId: string };
  return { workspaceId: dados.workspaceId, metaPageId: dados.metaPageId };
}

/** Mesmo conector, pelo workspace — usado pela rota de ENVIO, que já sabe o workspace via sessão autenticada. */
export async function resolverPageIdDoWorkspace(
  workspaceId: string,
  canal: CanalMetaMessaging
): Promise<string | null> {
  const snap = await firestoreAdmin()
    .collection(COLECAO_CONECTORES)
    .where("workspaceId", "==", workspaceId)
    .where("tipo", "==", tipoConectorPorCanal(canal))
    .limit(1)
    .get();
  if (snap.empty) return null;
  const metaPageId = (snap.docs[0].data() as { metaPageId?: unknown }).metaPageId;
  return typeof metaPageId === "string" && metaPageId.length > 0 ? metaPageId : null;
}

/**
 * Id determinístico por workspace+canal+remetente — substitui a antiga
 * query "existe?" seguida de `create` separado, que tinha uma corrida real:
 * duas mensagens quase simultâneas do MESMO remetente (dois webhooks em
 * paralelo) viam ambas "não existe" e criavam DUAS conversas para o mesmo
 * cliente. `canal` entra na chave porque o mesmo id numérico da Meta não
 * tem significado cruzado entre Instagram e Facebook.
 */
function chaveConversaMeta(workspaceId: string, canal: CanalMetaMessaging, remetenteId: string): string {
  return `conv_meta_${workspaceId}_${canal}_${remetenteId}`;
}

/**
 * Id determinístico da mensagem a partir do id externo da Meta
 * (`messaging[].message.mid`) — raiz da idempotência: um retry do mesmo
 * webhook (Meta reenviando por timeout/cold start) cai no mesmo documento e
 * nunca duplica a mensagem nem reaciona o pipeline de frustração/SLA.
 */
function idMensagemMeta(idExterno: string | undefined): string {
  if (!idExterno) return novoId("msg");
  return `msg_ext_${idExterno.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200)}`;
}

function construirConversaMeta(
  workspaceId: string,
  canal: CanalMetaMessaging,
  remetenteId: string,
  id: string
): Conversation {
  const { textoMascarado: identificadorMascarado } = interceptarMensagem(remetenteId);
  const agora = new Date().toISOString();
  return {
    id,
    workspaceId,
    canal,
    participante: { nome: nomeClientePadrao(canal), identificadorMascarado },
    assunto: canal === "instagram" ? "Contato via Instagram" : "Contato via Facebook Messenger",
    status: "aberta",
    prioridade: "p3",
    atribuidoTipo: "nenhum",
    frustrationIndex: 0,
    frustrationTendencia: "estavel",
    circuitBreakerAtivo: false,
    metaSenderId: remetenteId,
    ultimaMensagemPreview: "",
    ultimaMensagemEm: agora,
    criadaEm: agora,
    totalMensagens: 0,
    totalMensagensCliente: 0,
  };
}

interface ResultadoIngestaoMeta {
  conversa: Conversation;
  messageId: string;
  duplicado: boolean;
}

/** Mesmo papel de `ingerirMensagemTelegramTx` (`@/lib/server/telegramBotAdmin`): encontra-ou-cria a conversa e grava a mensagem (ou detecta que já foi gravada) numa única transação atômica. */
async function ingerirMensagemMetaTx(
  database: ReturnType<typeof firestoreAdmin>,
  entrada: Pick<RegistrarMensagemMetaInput, "workspaceId" | "canal" | "remetenteId" | "idExterno">,
  mensagemSemId: Omit<ConversationMessage, "id" | "conversationId">,
  messageId: string
): Promise<ResultadoIngestaoMeta> {
  const convId = chaveConversaMeta(entrada.workspaceId, entrada.canal, entrada.remetenteId);
  const convRef = database.collection(COLECAO_CONVERSAS).doc(convId);
  const temDedup = Boolean(entrada.idExterno);

  return database.runTransaction(async (tx) => {
    const convSnap = await tx.get(convRef);
    const msgRef = convRef.collection(SUBCOLECAO_MENSAGENS).doc(messageId);
    const msgSnap = temDedup ? await tx.get(msgRef) : null;

    const conversaExistente = convSnap.exists ? { ...(convSnap.data() as Conversation), id: convId } : null;

    if (msgSnap?.exists) {
      return {
        conversa:
          conversaExistente ?? construirConversaMeta(entrada.workspaceId, entrada.canal, entrada.remetenteId, convId),
        messageId,
        duplicado: true,
      };
    }

    const conversa =
      conversaExistente ?? construirConversaMeta(entrada.workspaceId, entrada.canal, entrada.remetenteId, convId);
    if (!conversaExistente) tx.set(convRef, conversa);
    tx.set(msgRef, { ...mensagemSemId, id: messageId, conversationId: conversa.id });
    return { conversa, messageId, duplicado: false };
  });
}

export interface RegistrarMensagemMetaInput {
  workspaceId: string;
  canal: CanalMetaMessaging;
  remetenteId: string;
  texto: string;
  idExterno?: string;
}

export interface RegistrarMensagemMetaResultado {
  conversationId: string;
  messageId: string;
  circuitBreakerAtivo: boolean;
}

/** Ingesta uma mensagem do Instagram Direct/Facebook Messenger — ponta real de `POST /api/inbox/webhook` para estes provedores. */
export async function registrarMensagemMetaAdmin(
  entrada: RegistrarMensagemMetaInput
): Promise<RegistrarMensagemMetaResultado> {
  const database = firestoreAdmin();
  const agora = new Date();
  const messageId = idMensagemMeta(entrada.idExterno);
  const convId = chaveConversaMeta(entrada.workspaceId, entrada.canal, entrada.remetenteId);

  const { textoMascarado, piiDetectada, temPii } = interceptarMensagem(entrada.texto);

  let temVersaoOriginalSelada = false;
  if (temPii) {
    try {
      const envelope = await selarSegredo({
        plaintext: entrada.texto,
        workspaceId: entrada.workspaceId,
        recursoId: `${convId}__${messageId}`,
        versao: 1,
        proposito: "mensagem-chat",
      });
      await database
        .collection(COLECAO_VAULT_MENSAGENS)
        .doc(`${convId}__${messageId}`)
        .set({ conversationId: convId, messageId, workspaceId: entrada.workspaceId, envelope, criadoEm: agora.toISOString() });
      temVersaoOriginalSelada = true;
    } catch (erro) {
      console.error(`[inbox/${entrada.canal}] falha ao selar o original — mensagem segue mascarada:`, erro);
    }
  }

  const { conversa, duplicado } = await ingerirMensagemMetaTx(
    database,
    entrada,
    {
      workspaceId: entrada.workspaceId,
      canal: entrada.canal,
      remetente: "cliente",
      texto: textoMascarado,
      piiDetectada,
      enviadaEm: agora.toISOString(),
      temVersaoOriginalSelada,
    },
    messageId
  );

  if (duplicado) {
    return { conversationId: conversa.id, messageId, circuitBreakerAtivo: conversa.circuitBreakerAtivo };
  }

  const refConversa = database.collection(COLECAO_CONVERSAS).doc(conversa.id);

  let mensagensClienteRecentes: string[] = [];
  try {
    const historicoSnap = await refConversa
      .collection(SUBCOLECAO_MENSAGENS)
      .where("remetente", "==", "cliente")
      .orderBy("enviadaEm", "desc")
      .limit(5)
      .get();
    mensagensClienteRecentes = historicoSnap.docs.map((d) => (d.data() as ConversationMessage).texto).reverse();
  } catch (erro) {
    console.error(`[inbox/${entrada.canal}] falha ao buscar histórico recente:`, erro);
    mensagensClienteRecentes = [textoMascarado];
  }

  const latenciaRespostaSegundos =
    conversa.ultimaMensagemRemetente === "cliente"
      ? (agora.getTime() - new Date(conversa.ultimaMensagemEm).getTime()) / 1000
      : undefined;
  const slaSegundos = SLA_RESPOSTA_SEGUNDOS[conversa.prioridade] ?? SLA_RESPOSTA_SEGUNDOS.p3;
  const frustration = calcularFrustration(
    { mensagensCliente: mensagensClienteRecentes, latenciaRespostaSegundos, slaRespostaSegundos: slaSegundos },
    LIMIAR_FRUSTRACAO_CRITICA
  );
  const circuitBreakerDisparadoAgora = frustration.circuitBreakerAtivado && !conversa.circuitBreakerAtivo;
  const congelarBot = circuitBreakerDisparadoAgora && conversa.atribuidoTipo === "agente";

  await refConversa.update({
    ultimaMensagemPreview: textoMascarado.slice(0, 160),
    ultimaMensagemEm: agora.toISOString(),
    ultimaMensagemRemetente: "cliente" satisfies MessageSender,
    totalMensagens: conversa.totalMensagens + 1,
    totalMensagensCliente: conversa.totalMensagensCliente + 1,
    frustrationIndex: frustration.indice,
    frustrationTendencia: frustration.tendencia,
    circuitBreakerAtivo: frustration.circuitBreakerAtivado,
    status: conversa.status === "resolvida" ? "aberta" : conversa.status,
    ...(congelarBot ? { atribuidoTipo: "nenhum", atribuidoId: null, atribuidoNome: null } : {}),
  });

  try {
    await registrarInteracaoEpisodica(
      {
        workspaceId: entrada.workspaceId,
        clienteId: entrada.remetenteId,
        canal: entrada.canal,
        conversationId: conversa.id,
        assunto: conversa.assunto,
        resumoCurto: textoMascarado,
        desfechoConversao: conversa.desfechoConversao ?? null,
      },
      agora
    );
  } catch (erro) {
    console.error(`[inbox/${entrada.canal}] falha ao indexar memória episódica:`, erro);
  }

  if (circuitBreakerDisparadoAgora) {
    try {
      const ticket = await abrirTransbordoAdmin({
        solicitacao: {
          traceId: `${entrada.canal}_${messageId}`,
          politicaId: "padrao",
          severidade: "critica",
          veredito: "transbordo",
          violacoes: [
            {
              regra: "frustracao-critica",
              severidade: "critica",
              mensagem: `Índice de frustração em ${frustration.indice}/100 (${entrada.canal === "instagram" ? "Instagram" : "Facebook"}).`,
              score: frustration.indice / 100,
              limite: LIMIAR_FRUSTRACAO_CRITICA / 100,
            },
          ],
          payloadMascarado: textoMascarado,
        },
        flowId: conversa.id,
        flowNome: conversa.assunto,
        conversationId: conversa.id,
        motivoForcado: "frustracao-critica",
        workspaceId: entrada.workspaceId,
        criadoPor: "sistema",
        clienteId: entrada.remetenteId,
      });
      await refConversa.update({ slaTicketId: ticket.id });
    } catch (erro) {
      console.error(`[inbox/${entrada.canal}] falha ao abrir P1 de frustração crítica:`, erro);
    }
  }

  return { conversationId: conversa.id, messageId, circuitBreakerAtivo: frustration.circuitBreakerAtivado };
}

export interface EnviarMensagemMetaMessagingInput {
  /**
   * Page ID do workspace (já resolvido pela rota de envio) — não é usado na
   * URL/corpo da chamada real (o endpoint `me/messages` resolve a página a
   * partir do próprio token), mas mantido na interface para consistência com
   * o restante do pipeline (log/erro) e para suportar, no futuro, tokens por
   * página em vez de um único token global.
   */
  metaPageId: string;
  destinatarioId: string;
  texto: string;
}

export class ErroEnvioMetaMessaging extends Error {
  constructor(detalhe: string) {
    super(detalhe);
    this.name = "ErroEnvioMetaMessaging";
  }
}

/**
 * Envia uma mensagem de texto via Meta Graph API Send API (Instagram
 * Direct/Facebook Messenger — resposta do atendente). Exige
 * `META_PAGE_ACCESS_TOKEN` (token permanente do Meta for Developers, GLOBAL —
 * mesmo app/papel de `WHATSAPP_ACCESS_TOKEN`) — sem ele, a rota que chama
 * esta função devolve um erro acionável em vez de fingir que enviou.
 *
 * Usa `Authorization: Bearer` (mesmo estilo do WhatsApp Cloud API) em vez de
 * `?access_token=` na URL — a Graph API aceita as duas formas.
 */
export async function enviarMensagemMetaMessaging(entrada: EnviarMensagemMetaMessagingInput): Promise<void> {
  const token = process.env.META_PAGE_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new ErroEnvioMetaMessaging(
      "Instagram/Facebook não configurado — defina META_PAGE_ACCESS_TOKEN com o token permanente do Meta for Developers."
    );
  }

  let resposta: Response;
  try {
    resposta = await fetchComTimeout(
      `https://graph.facebook.com/v21.0/me/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          recipient: { id: entrada.destinatarioId },
          message: { text: entrada.texto },
        }),
      },
      "Timeout ou falha de rede ao chamar a Meta Graph API.",
      TIMEOUT_ENVIO_MS
    );
  } catch (erro) {
    console.error(`[meta-messaging/send] falha de rede/timeout (page=${entrada.metaPageId}):`, erro);
    throw new ErroEnvioMetaMessaging(
      "Não foi possível falar com o Instagram/Facebook (rede instável ou tempo limite excedido) — tente novamente."
    );
  }

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => "");
    console.error(`[meta-messaging/send] Meta recusou o envio (${resposta.status}, page=${entrada.metaPageId}):`, corpo);
    throw new ErroEnvioMetaMessaging(
      "O Instagram/Facebook recusou o envio — verifique se a janela de atendimento ainda está aberta para este contato."
    );
  }
}
