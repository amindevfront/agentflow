// Pipeline de ingestão e envio do SMS via Twilio (Canais Globais —
// EUA/UK/Europa) — SERVER-ONLY, Admin SDK.
//
// Mesmo racional do WhatsApp Cloud API (`@/lib/server/whatsappCloudApiAdmin`):
// reaproveita as peças PURAS do pipeline autenticado (Shield-Layer, Radar de
// Sentimento, Circuit Breaker) para que uma mensagem de SMS receba
// exatamente a mesma proteção que qualquer outro canal — mascaramento de
// PII, cálculo de frustração, transbordo automático em frustração crítica.
//
// Corte de escopo deliberado, idêntico ao do WhatsApp: handoffs com Resumo
// Executivo específicos de vertical ficam de fora desta v1.
//
// Mapeamento número↔workspace: resolvido pelo `twilioPhoneNumber` gravado no
// conector "SMS / Twilio Gateway" (ver `connectors/page.tsx`) — é o número
// `To` que a Twilio inclui em TODO webhook de SMS recebido.

import type { Conversation, ConversationMessage, MessageSender } from "@/types";
import { interceptarMensagem } from "@/lib/guardrails/piiVault";
import { selarSegredo } from "@/lib/crypto/envelope";
import { LIMIAR_FRUSTRACAO_CRITICA, calcularFrustration } from "@/lib/sentiment/radar";
import { registrarInteracaoEpisodica } from "./episodicMemory";
import { firestoreAdmin } from "./firebaseAdmin";
import { abrirTransbordoAdmin } from "./hitlStore";

const COLECAO_CONVERSAS = "conversations";
const SUBCOLECAO_MENSAGENS = "mensagens";
const COLECAO_VAULT_MENSAGENS = "messageVaults";
const COLECAO_CONECTORES = "connectors";

export const TIPO_CONECTOR_SMS = "SMS / Twilio Gateway";

const SLA_RESPOSTA_SEGUNDOS = { p1: 60, p2: 180, p3: 600, p4: 1800 } as const;

function novoId(prefixo: string): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefixo}_${aleatorio}`;
}

export interface ConectorSms {
  workspaceId: string;
  twilioPhoneNumber: string;
}

/**
 * Resolve qual workspace é dono de um número Twilio (`To`) — a ÚNICA forma
 * de um webhook anônimo da Twilio (sem nenhuma sessão Firebase) saber a quem
 * a mensagem pertence. Sem conector cadastrado com este número, devolve
 * `null` — a rota traduz isso em "ingestão recusada", nunca grava às cegas.
 */
export async function resolverConectorPorNumeroTwilio(numero: string): Promise<ConectorSms | null> {
  const snap = await firestoreAdmin()
    .collection(COLECAO_CONECTORES)
    .where("tipo", "==", TIPO_CONECTOR_SMS)
    .where("twilioPhoneNumber", "==", numero)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const dados = snap.docs[0].data() as { workspaceId: string; twilioPhoneNumber: string };
  return { workspaceId: dados.workspaceId, twilioPhoneNumber: dados.twilioPhoneNumber };
}

/** Mesmo conector, pelo workspace — usado pela rota de ENVIO, que já sabe o workspace via sessão autenticada. */
export async function resolverNumeroTwilioDoWorkspace(workspaceId: string): Promise<string | null> {
  const snap = await firestoreAdmin()
    .collection(COLECAO_CONECTORES)
    .where("workspaceId", "==", workspaceId)
    .where("tipo", "==", TIPO_CONECTOR_SMS)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const twilioPhoneNumber = (snap.docs[0].data() as { twilioPhoneNumber?: unknown }).twilioPhoneNumber;
  return typeof twilioPhoneNumber === "string" && twilioPhoneNumber.length > 0 ? twilioPhoneNumber : null;
}

async function encontrarOuCriarConversaSms(workspaceId: string, telefoneCliente: string): Promise<Conversation> {
  const colecao = firestoreAdmin().collection(COLECAO_CONVERSAS);
  const existente = await colecao
    .where("workspaceId", "==", workspaceId)
    .where("smsTelefone", "==", telefoneCliente)
    .limit(1)
    .get();

  if (!existente.empty) {
    const doc = existente.docs[0];
    return { ...(doc.data() as Conversation), id: doc.id };
  }

  const { textoMascarado: identificadorMascarado } = interceptarMensagem(telefoneCliente);
  const agora = new Date().toISOString();
  const conversa: Conversation = {
    id: novoId("conv"),
    workspaceId,
    canal: "sms",
    participante: { nome: "Cliente SMS", identificadorMascarado },
    assunto: "Contato via SMS",
    status: "aberta",
    prioridade: "p3",
    atribuidoTipo: "nenhum",
    frustrationIndex: 0,
    frustrationTendencia: "estavel",
    circuitBreakerAtivo: false,
    smsTelefone: telefoneCliente,
    ultimaMensagemPreview: "",
    ultimaMensagemEm: agora,
    criadaEm: agora,
    totalMensagens: 0,
    totalMensagensCliente: 0,
  };
  await colecao.doc(conversa.id).set(conversa);
  return conversa;
}

export interface RegistrarMensagemSmsInput {
  workspaceId: string;
  telefoneCliente: string;
  texto: string;
  idExterno?: string;
}

export interface RegistrarMensagemSmsResultado {
  conversationId: string;
  messageId: string;
  circuitBreakerAtivo: boolean;
}

/** Ingesta uma mensagem de SMS — ponta real de `POST /api/inbox/webhook/twilio`. */
export async function registrarMensagemSmsAdmin(
  entrada: RegistrarMensagemSmsInput
): Promise<RegistrarMensagemSmsResultado> {
  const database = firestoreAdmin();
  const conversa = await encontrarOuCriarConversaSms(entrada.workspaceId, entrada.telefoneCliente);
  const refConversa = database.collection(COLECAO_CONVERSAS).doc(conversa.id);

  const { textoMascarado, piiDetectada, temPii } = interceptarMensagem(entrada.texto);
  const agora = new Date();
  const messageId = novoId("msg");

  let temVersaoOriginalSelada = false;
  if (temPii) {
    try {
      const envelope = await selarSegredo({
        plaintext: entrada.texto,
        workspaceId: entrada.workspaceId,
        recursoId: `${conversa.id}__${messageId}`,
        versao: 1,
        proposito: "mensagem-chat",
      });
      await database
        .collection(COLECAO_VAULT_MENSAGENS)
        .doc(`${conversa.id}__${messageId}`)
        .set({ conversationId: conversa.id, messageId, workspaceId: entrada.workspaceId, envelope, criadoEm: agora.toISOString() });
      temVersaoOriginalSelada = true;
    } catch (erro) {
      console.error("[inbox/sms] falha ao selar o original — mensagem segue mascarada:", erro);
    }
  }

  const mensagem: ConversationMessage = {
    id: messageId,
    conversationId: conversa.id,
    workspaceId: entrada.workspaceId,
    canal: "sms",
    remetente: "cliente",
    texto: textoMascarado,
    piiDetectada,
    enviadaEm: agora.toISOString(),
    temVersaoOriginalSelada,
  };
  await refConversa.collection(SUBCOLECAO_MENSAGENS).doc(messageId).set(mensagem);

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
    console.error("[inbox/sms] falha ao buscar histórico recente:", erro);
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
        canal: "sms",
        conversationId: conversa.id,
        assunto: conversa.assunto,
        resumoCurto: textoMascarado,
        desfechoConversao: conversa.desfechoConversao ?? null,
      },
      agora
    );
  } catch (erro) {
    console.error("[inbox/sms] falha ao indexar memória episódica:", erro);
  }

  if (circuitBreakerDisparadoAgora) {
    try {
      const ticket = await abrirTransbordoAdmin({
        solicitacao: {
          traceId: `sms_${messageId}`,
          politicaId: "padrao",
          severidade: "critica",
          veredito: "transbordo",
          violacoes: [
            {
              regra: "frustracao-critica",
              severidade: "critica",
              mensagem: `Índice de frustração em ${frustration.indice}/100 (SMS).`,
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
      console.error("[inbox/sms] falha ao abrir P1 de frustração crítica:", erro);
    }
  }

  return { conversationId: conversa.id, messageId, circuitBreakerAtivo: frustration.circuitBreakerAtivado };
}

export interface EnviarMensagemSmsInput {
  telefoneDestino: string;
  texto: string;
}

export class ErroEnvioSms extends Error {
  constructor(detalhe: string) {
    super(detalhe);
    this.name = "ErroEnvioSms";
  }
}

/**
 * Envia um SMS via Twilio REST API (resposta do atendente). Exige
 * `TWILIO_ACCOUNT_SID` e `TWILIO_AUTH_TOKEN` — sem eles, a rota que chama
 * esta função devolve um erro acionável em vez de fingir que enviou. O
 * número de origem é sempre `TWILIO_PHONE_NUMBER` (o número Twilio da conta,
 * não o do conector individual — Twilio autentica pela conta, não por
 * número, diferente do Meta).
 */
export async function enviarMensagemSmsTwilio(entrada: EnviarMensagemSmsInput): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const numeroOrigem = process.env.TWILIO_PHONE_NUMBER?.trim();
  if (!accountSid || !authToken || !numeroOrigem) {
    throw new ErroEnvioSms(
      "SMS não configurado — defina TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN e TWILIO_PHONE_NUMBER."
    );
  }

  const corpo = new URLSearchParams({ From: numeroOrigem, To: entrada.telefoneDestino, Body: entrada.texto });
  const resposta = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
    },
    body: corpo.toString(),
  });

  if (!resposta.ok) {
    const corpoErro = await resposta.text().catch(() => "");
    console.error(`[sms/send] Twilio recusou o envio (${resposta.status}):`, corpoErro);
    throw new ErroEnvioSms("A Twilio recusou o envio — verifique o número de destino e o saldo da conta.");
  }
}
