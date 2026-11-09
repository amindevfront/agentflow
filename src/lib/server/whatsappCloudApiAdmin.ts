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
import { registrarInteracaoEpisodica } from "./episodicMemory";
import { firestoreAdmin } from "./firebaseAdmin";
import { abrirTransbordoAdmin } from "./hitlStore";

const COLECAO_CONVERSAS = "conversations";
const SUBCOLECAO_MENSAGENS = "mensagens";
const COLECAO_VAULT_MENSAGENS = "messageVaults";
const COLECAO_CONECTORES = "connectors";

export const TIPO_CONECTOR_WHATSAPP = "WhatsApp Business (Cloud API)";

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

async function encontrarOuCriarConversaWhatsapp(
  workspaceId: string,
  telefoneCliente: string,
  nomeCliente: string
): Promise<Conversation> {
  const colecao = firestoreAdmin().collection(COLECAO_CONVERSAS);
  const existente = await colecao
    .where("workspaceId", "==", workspaceId)
    .where("whatsappTelefone", "==", telefoneCliente)
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
  await colecao.doc(conversa.id).set(conversa);
  return conversa;
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
  const conversa = await encontrarOuCriarConversaWhatsapp(entrada.workspaceId, entrada.telefoneCliente, entrada.nomeCliente);
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
      console.error("[inbox/whatsapp] falha ao selar o original — mensagem segue mascarada:", erro);
    }
  }

  const mensagem: ConversationMessage = {
    id: messageId,
    conversationId: conversa.id,
    workspaceId: entrada.workspaceId,
    canal: "whatsapp",
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

  const resposta = await fetch(`https://graph.facebook.com/v21.0/${entrada.metaPhoneNumberId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: entrada.telefoneDestino,
      type: "text",
      text: { body: entrada.texto },
    }),
  });

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => "");
    console.error(`[whatsapp/send] Meta recusou o envio (${resposta.status}):`, corpo);
    throw new ErroEnvioWhatsapp(
      "O WhatsApp recusou o envio — verifique se a janela de 24h de atendimento ainda está aberta para este contato."
    );
  }
}
