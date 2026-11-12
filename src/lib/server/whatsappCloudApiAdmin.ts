// Pipeline de ingestão e envio do WhatsApp Cloud API (Meta) — SERVER-ONLY, Admin SDK.
//
// Mesmo racional do Web Widget (`@/lib/server/inboxWidgetAdmin`): reaproveita
// as peças PURAS do pipeline autenticado (Shield-Layer, Radar de Sentimento)
// para que uma mensagem de WhatsApp receba exatamente a mesma proteção —
// mascaramento de PII, cálculo de frustração, Circuit Breaker — que qualquer
// outro canal.
//
// Corte de escopo deliberado desta primeira versão (mesmo em que já é
// honesto no widget): os handoffs com Resumo Executivo específicos de
// vertical (Imobiliário, Clínicas, Advocacia, gavetas dos EUA) ficam de fora
// — nenhum deles se aplica a Salão de Beleza/Barbearia, o primeiro caso real
// deste canal, e adicioná-los aqui replicaria ~300 linhas sem uso imediato.
// Quando um nicho com handoff dedicado precisar de WhatsApp, a peça certa é
// extrair aquele bloco para uma função compartilhada entre os dois arquivos,
// não duplicá-lo de novo.
//
// Mapeamento número↔workspace: resolvido pelo `metaPhoneNumberId` gravado no
// conector "WhatsApp Business (Cloud API)" (ver `connectors/page.tsx`) — é o
// Phone Number ID que a Meta inclui em TODO webhook real
// (`value.metadata.phone_number_id`), não o número em si (que pode ter mais
// de uma formatação).

import type { Conversation, ConversationMessage, MessageSender } from "@/types";
import { interceptarMensagem } from "@/lib/guardrails/piiVault";
import { selarSegredo } from "@/lib/crypto/envelope";
import { LIMIAR_FRUSTRACAO_CRITICA, calcularFrustration } from "@/lib/sentiment/radar";
import { fetchComTimeout } from "@/lib/fetchComTimeout";
import { registrarInteracaoEpisodica } from "./episodicMemory";
import { firestoreAdmin } from "./firebaseAdmin";
import { abrirTransbordoAdmin } from "./hitlStore";

const COLECAO_CONVERSAS = "conversations";
const SUBCOLECAO_MENSAGENS = "mensagens";
const COLECAO_VAULT_MENSAGENS = "messageVaults";
const COLECAO_CONECTORES = "connectors";

export const TIPO_CONECTOR_WHATSAPP = "WhatsApp Business (Cloud API)";

/** Prazo máximo para a chamada real ao provedor — nunca deixar a function serverless pendurada esperando uma resposta que pode nunca chegar. */
const TIMEOUT_ENVIO_MS = 10_000;

const SLA_RESPOSTA_SEGUNDOS = { p1: 60, p2: 180, p3: 600, p4: 1800 } as const;

function novoId(prefixo: string): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefixo}_${aleatorio}`;
}

export interface ConectorWhatsapp {
  workspaceId: string;
  metaPhoneNumberId: string;
}

/**
 * Resolve qual workspace é dono de um `phone_number_id` — a ÚNICA forma de
 * um webhook anônimo do Meta (sem nenhuma sessão Firebase) saber a quem a
 * mensagem pertence. Sem conector cadastrado com este id, devolve `null` —
 * a rota traduz isso em "ingestão recusada", nunca grava às cegas.
 */
export async function resolverConectorPorPhoneNumberId(phoneNumberId: string): Promise<ConectorWhatsapp | null> {
  const snap = await firestoreAdmin()
    .collection(COLECAO_CONECTORES)
    .where("tipo", "==", TIPO_CONECTOR_WHATSAPP)
    .where("metaPhoneNumberId", "==", phoneNumberId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const dados = snap.docs[0].data() as { workspaceId: string; metaPhoneNumberId: string };
  return { workspaceId: dados.workspaceId, metaPhoneNumberId: dados.metaPhoneNumberId };
}

/** Mesmo conector, pelo workspace — usado pela rota de ENVIO, que já sabe o workspace via sessão autenticada. */
export async function resolverPhoneNumberIdDoWorkspace(workspaceId: string): Promise<string | null> {
  const snap = await firestoreAdmin()
    .collection(COLECAO_CONECTORES)
    .where("workspaceId", "==", workspaceId)
    .where("tipo", "==", TIPO_CONECTOR_WHATSAPP)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const metaPhoneNumberId = (snap.docs[0].data() as { metaPhoneNumberId?: unknown }).metaPhoneNumberId;
  return typeof metaPhoneNumberId === "string" && metaPhoneNumberId.length > 0 ? metaPhoneNumberId : null;
}

/**
 * Id determinístico por workspace+telefone — substitui a antiga query
 * "existe?" seguida de `create` separado, que tinha uma corrida real: duas
 * mensagens quase simultâneas do MESMO número (dois webhooks em paralelo)
 * viam ambas "não existe" e criavam DUAS conversas para o mesmo cliente.
 */
function chaveConversaWhatsapp(workspaceId: string, telefoneCliente: string): string {
  return `conv_whatsapp_${workspaceId}_${telefoneCliente}`;
}

/**
 * Id determinístico da mensagem a partir do id externo do WhatsApp Cloud API
 * (`messages[].id`) — raiz da idempotência: um retry do mesmo webhook (Meta
 * reenviando por timeout/cold start) cai no mesmo documento e nunca duplica
 * a mensagem nem reaciona o pipeline de frustração/SLA.
 */
function idMensagemWhatsapp(idExterno: string | undefined): string {
  if (!idExterno) return novoId("msg");
  return `msg_ext_${idExterno.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200)}`;
}

function construirConversaWhatsapp(
  workspaceId: string,
  telefoneCliente: string,
  nomeCliente: string,
  id: string
): Conversation {
  const { textoMascarado: identificadorMascarado } = interceptarMensagem(telefoneCliente);
  const agora = new Date().toISOString();
  return {
    id,
    workspaceId,
    canal: "whatsapp",
    participante: { nome: nomeCliente || "Cliente WhatsApp", identificadorMascarado },
    assunto: "Contato via WhatsApp",
    status: "aberta",
    prioridade: "p3",
    atribuidoTipo: "nenhum",
    frustrationIndex: 0,
    frustrationTendencia: "estavel",
    circuitBreakerAtivo: false,
    whatsappTelefone: telefoneCliente,
    ultimaMensagemPreview: "",
    ultimaMensagemEm: agora,
    criadaEm: agora,
    totalMensagens: 0,
    totalMensagensCliente: 0,
  };
}

interface ResultadoIngestaoWhatsapp {
  conversa: Conversation;
  messageId: string;
  duplicado: boolean;
}

/** Mesmo papel de `ingerirMensagemTelegramTx` (`@/lib/server/telegramBotAdmin`): encontra-ou-cria a conversa e grava a mensagem (ou detecta que já foi gravada) numa única transação atômica. */
async function ingerirMensagemWhatsappTx(
  database: ReturnType<typeof firestoreAdmin>,
  entrada: Pick<RegistrarMensagemWhatsappInput, "workspaceId" | "telefoneCliente" | "nomeCliente" | "idExterno">,
  mensagemSemId: Omit<ConversationMessage, "id" | "conversationId">,
  messageId: string
): Promise<ResultadoIngestaoWhatsapp> {
  const convId = chaveConversaWhatsapp(entrada.workspaceId, entrada.telefoneCliente);
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
          conversaExistente ??
          construirConversaWhatsapp(entrada.workspaceId, entrada.telefoneCliente, entrada.nomeCliente, convId),
        messageId,
        duplicado: true,
      };
    }

    const conversa =
      conversaExistente ??
      construirConversaWhatsapp(entrada.workspaceId, entrada.telefoneCliente, entrada.nomeCliente, convId);
    if (!conversaExistente) tx.set(convRef, conversa);
    tx.set(msgRef, { ...mensagemSemId, id: messageId, conversationId: conversa.id });
    return { conversa, messageId, duplicado: false };
  });
}

export interface RegistrarMensagemWhatsappInput {
  workspaceId: string;
  telefoneCliente: string;
  nomeCliente: string;
  texto: string;
  idExterno?: string;
}

export interface RegistrarMensagemWhatsappResultado {
  conversationId: string;
  messageId: string;
  circuitBreakerAtivo: boolean;
}

/** Ingesta uma mensagem do WhatsApp — ponta real de `POST /api/inbox/webhook` para este provedor. */
export async function registrarMensagemWhatsappAdmin(
  entrada: RegistrarMensagemWhatsappInput
): Promise<RegistrarMensagemWhatsappResultado> {
  const database = firestoreAdmin();
  const agora = new Date();
  const messageId = idMensagemWhatsapp(entrada.idExterno);
  const convId = chaveConversaWhatsapp(entrada.workspaceId, entrada.telefoneCliente);

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
      console.error("[inbox/whatsapp] falha ao selar o original — mensagem segue mascarada:", erro);
    }
  }

  const { conversa, duplicado } = await ingerirMensagemWhatsappTx(
    database,
    entrada,
    {
      workspaceId: entrada.workspaceId,
      canal: "whatsapp",
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
    console.error("[inbox/whatsapp] falha ao buscar histórico recente:", erro);
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
        clienteId: entrada.telefoneCliente,
        canal: "whatsapp",
        conversationId: conversa.id,
        assunto: conversa.assunto,
        resumoCurto: textoMascarado,
        desfechoConversao: conversa.desfechoConversao ?? null,
      },
      agora
    );
  } catch (erro) {
    console.error("[inbox/whatsapp] falha ao indexar memória episódica:", erro);
  }

  if (circuitBreakerDisparadoAgora) {
    try {
      const ticket = await abrirTransbordoAdmin({
        solicitacao: {
          traceId: `whatsapp_${messageId}`,
          politicaId: "padrao",
          severidade: "critica",
          veredito: "transbordo",
          violacoes: [
            {
              regra: "frustracao-critica",
              severidade: "critica",
              mensagem: `Índice de frustração em ${frustration.indice}/100 (WhatsApp).`,
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
        clienteId: entrada.telefoneCliente,
      });
      await refConversa.update({ slaTicketId: ticket.id });
    } catch (erro) {
      console.error("[inbox/whatsapp] falha ao abrir P1 de frustração crítica:", erro);
    }
  }

  return { conversationId: conversa.id, messageId, circuitBreakerAtivo: frustration.circuitBreakerAtivado };
}

export interface EnviarMensagemWhatsappInput {
  metaPhoneNumberId: string;
  telefoneDestino: string;
  texto: string;
}

export class ErroEnvioWhatsapp extends Error {
  constructor(detalhe: string) {
    super(detalhe);
    this.name = "ErroEnvioWhatsapp";
  }
}

/**
 * Envia uma mensagem de texto via WhatsApp Cloud API (resposta do
 * atendente). Exige `WHATSAPP_ACCESS_TOKEN` (token permanente do Meta for
 * Developers) — sem ele, a rota que chama esta função devolve um erro
 * acionável em vez de fingir que enviou.
 *
 * Fora do escopo desta v1, deliberadamente: a janela de 24h de atendimento
 * (fora dela, o Meta só aceita Message Templates pré-aprovados, não texto
 * livre) e envio de mídia. Uma tentativa fora da janela falha com o erro que
 * o próprio Meta devolve — não é mascarado nem reinterpretado aqui.
 */
export async function enviarMensagemWhatsappCloudApi(entrada: EnviarMensagemWhatsappInput): Promise<void> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new ErroEnvioWhatsapp(
      "WhatsApp não configurado — defina WHATSAPP_ACCESS_TOKEN com o token permanente do Meta for Developers."
    );
  }

  let resposta: Response;
  try {
    resposta = await fetchComTimeout(
      `https://graph.facebook.com/v21.0/${entrada.metaPhoneNumberId}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: entrada.telefoneDestino,
          type: "text",
          text: { body: entrada.texto },
        }),
      },
      "Timeout ou falha de rede ao chamar o WhatsApp Cloud API.",
      TIMEOUT_ENVIO_MS
    );
  } catch (erro) {
    // Sem isto, uma Meta que aceita a conexão mas nunca responde deixaria a
    // function serverless pendurada até o timeout da PLATAFORMA (muito mais
    // longo), consumindo compute e mantendo o spinner "enviando…" no cliente
    // por todo esse tempo.
    console.error("[whatsapp/send] falha de rede/timeout ao chamar a Meta:", erro);
    throw new ErroEnvioWhatsapp("Não foi possível falar com o WhatsApp (rede instável ou tempo limite excedido) — tente novamente.");
  }

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => "");
    console.error(`[whatsapp/send] Meta recusou o envio (${resposta.status}):`, corpo);
    throw new ErroEnvioWhatsapp(
      "O WhatsApp recusou o envio — verifique se a janela de 24h de atendimento ainda está aberta para este contato."
    );
  }
}
