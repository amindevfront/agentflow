// Pipeline de ingestão e envio do Telegram Bot API — SERVER-ONLY, Admin SDK.
//
// Mesmo racional do WhatsApp Cloud API/SMS Twilio/Meta Messaging: reaproveita
// as peças PURAS do pipeline autenticado (Shield-Layer, Radar de Sentimento,
// Circuit Breaker) para que uma mensagem de Telegram receba exatamente a
// mesma proteção que qualquer outro canal.
//
// DIFERENÇA ESTRUTURAL em relação a WhatsApp/Instagram/Facebook: naqueles,
// um único app/segredo GLOBAL (variável de ambiente) é compartilhado por
// todos os workspaces, roteado por um identificador público gravado em claro
// no conector. No Telegram não existe esse conceito de "um app gerencia
// vários bots" — cada bot tem o PRÓPRIO token. Gravá-lo em claro no documento
// do conector reintroduziria a mesma falha real já corrigida uma vez neste
// projeto para `Flow.apiTokenCredentialId` (ver o comentário naquele campo,
// em `@/types`): por isso o token do Telegram passa pelo Cofre Zero-Trust
// (`@/lib/credentials` no cliente, `obterTokenTelegram` abaixo no servidor) —
// só o id da credencial selada (`telegramBotTokenCredentialId`) vive no
// documento do conector, nunca o segredo.
//
// Mapeamento conversa↔conector: diferente dos demais canais (resolvidos por
// um campo de roteamento buscado por `where`), o id do conector Telegram já
// está na própria URL do webhook (`/api/inbox/webhook/telegram/[connectorId]`)
// — não há ambiguidade a resolver, só uma leitura direta por id.

import type { Conversation, ConversationMessage, MessageSender } from "@/types";
import type { CredentialMetadata, SealedSecret } from "@/types";
import { interceptarMensagem } from "@/lib/guardrails/piiVault";
import { selarSegredo } from "@/lib/crypto/envelope";
import { LIMIAR_FRUSTRACAO_CRITICA, calcularFrustration } from "@/lib/sentiment/radar";
import { fetchComTimeout } from "@/lib/fetchComTimeout";
import { abrirCredencial } from "./vault";
import { registrarInteracaoEpisodica } from "./episodicMemory";
import { firestoreAdmin } from "./firebaseAdmin";
import { abrirTransbordoAdmin } from "./hitlStore";

const COLECAO_CONVERSAS = "conversations";
const SUBCOLECAO_MENSAGENS = "mensagens";
const COLECAO_VAULT_MENSAGENS = "messageVaults";
const COLECAO_CONECTORES = "connectors";
const COLECAO_CREDENCIAIS_META = "credentials";
const COLECAO_CREDENCIAIS_SEGREDOS = "credentialSecrets";

export const TIPO_CONECTOR_TELEGRAM = "Telegram Bot API";

const SLA_RESPOSTA_SEGUNDOS = { p1: 60, p2: 180, p3: 600, p4: 1800 } as const;

/** Prazo máximo para a chamada real ao Telegram — nunca deixar a function serverless pendurada esperando uma resposta que pode nunca chegar. */
const TIMEOUT_ENVIO_MS = 10_000;

function novoId(prefixo: string): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefixo}_${aleatorio}`;
}

function idSegredoCredencial(credentialId: string, versao: number): string {
  return `${credentialId}__v${versao}`;
}

export interface ConectorTelegram {
  workspaceId: string;
  credentialId: string;
  webhookSecretCredentialId: string;
}

/**
 * Lê o conector Telegram diretamente pelo id — o id JÁ está na URL do
 * webhook (`/api/inbox/webhook/telegram/[connectorId]`), então não há campo
 * de roteamento a buscar por `where`, diferente dos demais canais. Devolve
 * `null` quando o conector não existe, não é do tipo Telegram, ou não tem a
 * credencial/segredo configurados — a rota traduz isso em "ingestão
 * recusada", nunca grava às cegas.
 */
export async function resolverConectorTelegram(connectorId: string): Promise<ConectorTelegram | null> {
  const snap = await firestoreAdmin().collection(COLECAO_CONECTORES).doc(connectorId).get();
  if (!snap.exists) return null;

  const dados = snap.data() as {
    workspaceId?: unknown;
    tipo?: unknown;
    telegramBotTokenCredentialId?: unknown;
    telegramWebhookSecretCredentialId?: unknown;
  };
  if (dados.tipo !== TIPO_CONECTOR_TELEGRAM) return null;
  if (typeof dados.workspaceId !== "string" || dados.workspaceId.length === 0) return null;
  if (typeof dados.telegramBotTokenCredentialId !== "string" || dados.telegramBotTokenCredentialId.length === 0) {
    return null;
  }
  if (
    typeof dados.telegramWebhookSecretCredentialId !== "string" ||
    dados.telegramWebhookSecretCredentialId.length === 0
  ) {
    return null;
  }

  return {
    workspaceId: dados.workspaceId,
    credentialId: dados.telegramBotTokenCredentialId,
    webhookSecretCredentialId: dados.telegramWebhookSecretCredentialId,
  };
}

/** Mesmo conector, pelo workspace — usado pela rota de ENVIO, que já sabe o workspace via sessão autenticada. */
export async function resolverConectorTelegramDoWorkspace(
  workspaceId: string
): Promise<{ connectorId: string; credentialId: string } | null> {
  const snap = await firestoreAdmin()
    .collection(COLECAO_CONECTORES)
    .where("workspaceId", "==", workspaceId)
    .where("tipo", "==", TIPO_CONECTOR_TELEGRAM)
    .limit(1)
    .get();
  if (snap.empty) return null;

  const dados = snap.docs[0].data() as { telegramBotTokenCredentialId?: unknown };
  if (typeof dados.telegramBotTokenCredentialId !== "string" || dados.telegramBotTokenCredentialId.length === 0) {
    return null;
  }
  return { connectorId: snap.docs[0].id, credentialId: dados.telegramBotTokenCredentialId };
}

interface DocumentoSegredoCredencial {
  envelope: SealedSecret;
}

/**
 * Decifra o token do bot do Telegram a partir do Cofre Zero-Trust.
 *
 * Lança um erro claro (nunca devolve um valor inerte) quando a credencial
 * não existe, pertence a outro workspace, ou está revogada/expirada — essas
 * são todas condições em que enviar/processar com um token errado seria
 * pior do que falhar explicitamente.
 */
export async function obterTokenTelegram(credentialId: string, workspaceId: string): Promise<string> {
  const database = firestoreAdmin();

  const metaSnap = await database.collection(COLECAO_CREDENCIAIS_META).doc(credentialId).get();
  if (!metaSnap.exists) {
    throw new Error(`Credencial "${credentialId}" do bot do Telegram não encontrada.`);
  }
  const metadados = metaSnap.data() as CredentialMetadata;
  if (metadados.workspaceId !== workspaceId) {
    throw new Error("Credencial do bot do Telegram pertence a outro workspace.");
  }
  if (metadados.status === "revogada") {
    throw new Error("Credencial do bot do Telegram foi revogada — gere/rotacione o token no Cofre.");
  }
  if (metadados.expiraEm && new Date(metadados.expiraEm).getTime() < Date.now()) {
    throw new Error("Credencial do bot do Telegram expirou — rotacione o token no Cofre.");
  }

  const segredoSnap = await database
    .collection(COLECAO_CREDENCIAIS_SEGREDOS)
    .doc(idSegredoCredencial(credentialId, metadados.versao))
    .get();
  if (!segredoSnap.exists) {
    throw new Error(`Envelope da credencial "${credentialId}" (versão ${metadados.versao}) não encontrado.`);
  }
  const documento = segredoSnap.data() as DocumentoSegredoCredencial;

  return abrirCredencial(documento.envelope, { workspaceId, credentialId, versao: metadados.versao });
}

/**
 * Id determinístico da conversa por workspace+chatId — substitui a antiga
 * dupla "query por existente, senão cria com id aleatório", que tinha uma
 * corrida real: duas mensagens do mesmo chat quase simultâneas (dois
 * webhooks em paralelo) viam ambas "não existe" e criavam DUAS conversas
 * para o mesmo cliente. Com id determinístico, a dedupe vira uma leitura
 * direta por id DENTRO da transação (ver `ingerirMensagemTelegramTx`), onde
 * o Firestore garante serializabilidade: se duas transações concorrentes
 * tentam criar o mesmo documento, só uma comita — a outra é
 * automaticamente repetida pelo SDK e, na repetição, já encontra a conversa
 * criada pela primeira.
 */
function chaveConversaTelegram(workspaceId: string, chatId: string): string {
  return `conv_telegram_${workspaceId}_${chatId}`;
}

/**
 * Id determinístico da mensagem a partir do `message_id` do Telegram — raiz
 * da idempotência de ingestão: se o Telegram reenviar o MESMO update (timeout
 * de resposta, cold start), a segunda chamada cai no mesmo id de documento em
 * vez de gravar a mensagem (e disparar todo o pipeline de frustração/SLA/
 * transbordo) uma segunda vez. Sem `idExterno`, não há como deduplicar — cai
 * para um id aleatório (não deveria ocorrer: o Telegram sempre envia
 * `message_id` em `message`).
 */
function idMensagemTelegram(idExterno: string | undefined): string {
  if (!idExterno) return novoId("msg");
  return `msg_ext_${idExterno.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200)}`;
}

function construirConversaTelegram(workspaceId: string, chatId: string, remetenteNome: string, id: string): Conversation {
  const { textoMascarado: identificadorMascarado } = interceptarMensagem(chatId);
  const agora = new Date().toISOString();
  return {
    id,
    workspaceId,
    canal: "telegram",
    participante: { nome: remetenteNome || "Cliente Telegram", identificadorMascarado },
    assunto: "Contato via Telegram",
    status: "aberta",
    prioridade: "p3",
    atribuidoTipo: "nenhum",
    frustrationIndex: 0,
    frustrationTendencia: "estavel",
    circuitBreakerAtivo: false,
    telegramChatId: chatId,
    ultimaMensagemPreview: "",
    ultimaMensagemEm: agora,
    criadaEm: agora,
    totalMensagens: 0,
    totalMensagensCliente: 0,
  };
}

interface ResultadoIngestaoTelegram {
  conversa: Conversation;
  messageId: string;
  duplicado: boolean;
}

/**
 * Transação atômica: encontra-ou-cria a conversa e grava a mensagem (ou
 * detecta que já foi gravada) numa única operação serializável. Nenhuma
 * escrita acontece fora desta função para estes dois documentos — é isso
 * que elimina as duas corridas (conversa duplicada / mensagem duplicada)
 * descritas nos comentários de `chaveConversaTelegram`/`idMensagemTelegram`.
 */
async function ingerirMensagemTelegramTx(
  database: ReturnType<typeof firestoreAdmin>,
  entrada: Pick<RegistrarMensagemTelegramInput, "workspaceId" | "chatId" | "remetenteNome" | "idExterno">,
  mensagemSemId: Omit<ConversationMessage, "id" | "conversationId">,
  messageId: string
): Promise<ResultadoIngestaoTelegram> {
  const convId = chaveConversaTelegram(entrada.workspaceId, entrada.chatId);
  const convRef = database.collection(COLECAO_CONVERSAS).doc(convId);
  const temDedup = Boolean(entrada.idExterno);

  return database.runTransaction(async (tx) => {
    const convSnap = await tx.get(convRef);
    const msgRef = convRef.collection(SUBCOLECAO_MENSAGENS).doc(messageId);
    const msgSnap = temDedup ? await tx.get(msgRef) : null;

    const conversaExistente = convSnap.exists ? { ...(convSnap.data() as Conversation), id: convId } : null;

    if (msgSnap?.exists) {
      return {
        conversa: conversaExistente ?? construirConversaTelegram(entrada.workspaceId, entrada.chatId, entrada.remetenteNome, convId),
        messageId,
        duplicado: true,
      };
    }

    const conversa = conversaExistente ?? construirConversaTelegram(entrada.workspaceId, entrada.chatId, entrada.remetenteNome, convId);
    if (!conversaExistente) tx.set(convRef, conversa);
    tx.set(msgRef, { ...mensagemSemId, id: messageId, conversationId: conversa.id });
    return { conversa, messageId, duplicado: false };
  });
}

export interface RegistrarMensagemTelegramInput {
  workspaceId: string;
  chatId: string;
  remetenteNome: string;
  texto: string;
  idExterno?: string;
}

export interface RegistrarMensagemTelegramResultado {
  conversationId: string;
  messageId: string;
  circuitBreakerAtivo: boolean;
}

/** Ingesta uma mensagem do Telegram — ponta real de `POST /api/inbox/webhook/telegram/[connectorId]`. */
export async function registrarMensagemTelegramAdmin(
  entrada: RegistrarMensagemTelegramInput
): Promise<RegistrarMensagemTelegramResultado> {
  const database = firestoreAdmin();
  const agora = new Date();
  const messageId = idMensagemTelegram(entrada.idExterno);
  const convId = chaveConversaTelegram(entrada.workspaceId, entrada.chatId);

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
      console.error("[inbox/telegram] falha ao selar o original — mensagem segue mascarada:", erro);
    }
  }

  const { conversa, duplicado } = await ingerirMensagemTelegramTx(
    database,
    entrada,
    {
      workspaceId: entrada.workspaceId,
      canal: "telegram",
      remetente: "cliente",
      texto: textoMascarado,
      piiDetectada,
      enviadaEm: agora.toISOString(),
      temVersaoOriginalSelada,
    },
    messageId
  );

  if (duplicado) {
    // Mesmo `message_id` já processado nesta conversa (retry do webhook) —
    // idempotente: nenhum efeito colateral (frustração/SLA/transbordo/
    // memória episódica) roda uma segunda vez para o mesmo evento.
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
    console.error("[inbox/telegram] falha ao buscar histórico recente:", erro);
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
        clienteId: entrada.chatId,
        canal: "telegram",
        conversationId: conversa.id,
        assunto: conversa.assunto,
        resumoCurto: textoMascarado,
        desfechoConversao: conversa.desfechoConversao ?? null,
      },
      agora
    );
  } catch (erro) {
    console.error("[inbox/telegram] falha ao indexar memória episódica:", erro);
  }

  if (circuitBreakerDisparadoAgora) {
    try {
      const ticket = await abrirTransbordoAdmin({
        solicitacao: {
          traceId: `telegram_${messageId}`,
          politicaId: "padrao",
          severidade: "critica",
          veredito: "transbordo",
          violacoes: [
            {
              regra: "frustracao-critica",
              severidade: "critica",
              mensagem: `Índice de frustração em ${frustration.indice}/100 (Telegram).`,
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
        clienteId: entrada.chatId,
      });
      await refConversa.update({ slaTicketId: ticket.id });
    } catch (erro) {
      console.error("[inbox/telegram] falha ao abrir P1 de frustração crítica:", erro);
    }
  }

  return { conversationId: conversa.id, messageId, circuitBreakerAtivo: frustration.circuitBreakerAtivado };
}

export interface EnviarMensagemTelegramInput {
  credentialId: string;
  workspaceId: string;
  chatId: string;
  texto: string;
}

export class ErroEnvioTelegram extends Error {
  constructor(detalhe: string) {
    super(detalhe);
    this.name = "ErroEnvioTelegram";
  }
}

/**
 * Envia uma mensagem de texto via Telegram Bot API (resposta do atendente).
 * Decifra o token do bot a partir do Cofre Zero-Trust (`obterTokenTelegram`)
 * — nunca há um token global de ambiente para este canal, diferente de
 * WhatsApp/Meta/Twilio.
 */
export async function enviarMensagemTelegram(entrada: EnviarMensagemTelegramInput): Promise<void> {
  let token: string;
  try {
    token = await obterTokenTelegram(entrada.credentialId, entrada.workspaceId);
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : "Falha ao decifrar o token do bot do Telegram.";
    throw new ErroEnvioTelegram(mensagem);
  }

  let resposta: Response;
  try {
    resposta = await fetchComTimeout(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: entrada.chatId, text: entrada.texto }),
      },
      "Timeout ou falha de rede ao chamar o Telegram Bot API.",
      TIMEOUT_ENVIO_MS
    );
  } catch (erro) {
    console.error("[telegram/send] falha de rede/timeout:", erro);
    throw new ErroEnvioTelegram("Não foi possível falar com o Telegram (rede instável ou tempo limite excedido) — tente novamente.");
  }

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => "");
    console.error(`[telegram/send] Telegram recusou o envio (${resposta.status}):`, corpo);
    throw new ErroEnvioTelegram("O Telegram recusou o envio — verifique se o bot ainda tem permissão de conversar com este chat.");
  }
}
