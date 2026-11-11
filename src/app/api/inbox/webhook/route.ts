// POST /api/inbox/webhook — ingestão de mensagens do WhatsApp Business Cloud
// API, Instagram Messaging e Facebook Messenger (todos Meta Graph API).
//
// Valida a assinatura HMAC do Meta (`X-Hub-Signature-256`) antes de
// qualquer outra coisa, exatamente como a documentação do provedor exige —
// os três produtos compartilham o MESMO Meta App/segredo de assinatura
// (`META_WEBHOOK_SECRET`). Com a assinatura validada, o `object` de topo do
// payload diferencia o provedor:
//   - `"whatsapp_business_account"`: resolve o workspace pelo
//     `phone_number_id` (ver `resolverConectorPorPhoneNumberId` em
//     `@/lib/server/whatsappCloudApiAdmin`);
//   - `"instagram"` / `"page"` (Instagram Direct / Facebook Messenger):
//     resolve o workspace pelo `recipient.id` (Page/IG-ID — ver
//     `resolverConectorPorPageId` em `@/lib/server/metaMessagingAdmin`).
// Em todos os casos, é o único jeito de saber de quem é a mensagem, já que o
// Meta não manda nenhuma credencial por conversa — e todos registram via o
// mesmo pipeline Shield-Layer/Radar de Sentimento/Circuit Breaker que todo
// outro canal já usa. Qualquer outro `object` devolve o diagnóstico de
// "ingestão não implementada para este provedor" em vez de fingir que tratou.
//
// DELIBERADAMENTE NÃO usa `comGuarda`: aquele wrapper exige um ID token do
// Firebase em `Authorization: Bearer`, e um webhook real do Meta nunca envia
// isso — ele autentica por assinatura HMAC no corpo (`X-Hub-Signature-256`).

import { createHmac, timingSafeEqual } from "node:crypto";
import { registrarMensagemWhatsappAdmin, resolverConectorPorPhoneNumberId } from "@/lib/server/whatsappCloudApiAdmin";
import {
  registrarMensagemMetaAdmin,
  resolverConectorPorPageId,
  type CanalMetaMessaging,
} from "@/lib/server/metaMessagingAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VARIAVEL_SEGREDO = "META_WEBHOOK_SECRET";
const MAX_BYTES_CORPO = 64 * 1024;

const CABECALHOS_SEGUROS: Record<string, string> = {
  "cache-control": "no-store, no-cache, must-revalidate, private",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function respostaJson(dados: unknown, status: number): Response {
  return new Response(JSON.stringify(dados), { status, headers: CABECALHOS_SEGUROS });
}

/** Valida a assinatura HMAC-SHA256 que o Meta anexa a cada chamada de webhook real. */
function validarAssinaturaMeta(corpoBruto: string, assinaturaRecebida: string | null, segredo: string): boolean {
  if (!assinaturaRecebida) return false;
  const esperada = `sha256=${createHmac("sha256", segredo).update(corpoBruto).digest("hex")}`;
  const bufferRecebido = Buffer.from(assinaturaRecebida);
  const bufferEsperado = Buffer.from(esperada);
  if (bufferRecebido.length !== bufferEsperado.length) return false;
  return timingSafeEqual(bufferRecebido, bufferEsperado);
}

interface MensagemWhatsappBruta {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
}

interface ValorWebhookWhatsapp {
  metadata?: { phone_number_id?: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  messages?: MensagemWhatsappBruta[];
}

/**
 * Instagram Messaging/Facebook Messenger (Meta Graph API): mesmo app Meta do
 * WhatsApp, payload diferente — `entry[].messaging[]`, não `entry[].changes[]`.
 * `is_echo: true` é o próprio bot/página ecoando a mensagem que ELE mandou —
 * nunca pode ser ingerido como mensagem do cliente, senão o sistema responde
 * a si mesmo em loop.
 */
interface MensagemMetaMessagingBruta {
  sender?: { id?: string };
  recipient?: { id?: string };
  message?: { mid?: string; text?: string; is_echo?: boolean };
}

interface PayloadWebhookMeta {
  object?: string;
  entry?: Array<{
    changes?: Array<{ field?: string; value?: ValorWebhookWhatsapp }>;
    messaging?: MensagemMetaMessagingBruta[];
  }>;
}

export async function POST(requisicao: Request): Promise<Response> {
  try {
    const declarado = requisicao.headers.get("content-length");
    if (declarado && Number(declarado) > MAX_BYTES_CORPO) {
      return respostaJson({ erro: { codigo: "corpo_grande", mensagem: "Corpo excede o limite." } }, 413);
    }

    const segredo = process.env[VARIAVEL_SEGREDO]?.trim();
    if (!segredo) {
      return respostaJson(
        {
          erro: {
            codigo: "webhook_nao_configurado",
            mensagem: `Webhook de canal externo não configurado — defina ${VARIAVEL_SEGREDO} com o segredo do app Meta para ativar a validação de assinatura e a ingestão real.`,
          },
        },
        503
      );
    }

    const corpoBruto = await requisicao.text();
    if (corpoBruto.length > MAX_BYTES_CORPO) {
      return respostaJson({ erro: { codigo: "corpo_grande", mensagem: "Corpo excede o limite." } }, 413);
    }

    const assinatura = requisicao.headers.get("x-hub-signature-256");
    if (!validarAssinaturaMeta(corpoBruto, assinatura, segredo)) {
      return respostaJson({ erro: { codigo: "assinatura_invalida", mensagem: "Assinatura do webhook inválida." } }, 401);
    }

    let payload: PayloadWebhookMeta;
    try {
      payload = JSON.parse(corpoBruto) as PayloadWebhookMeta;
    } catch {
      return respostaJson({ erro: { codigo: "json_invalido", mensagem: "Corpo do webhook não é JSON válido." } }, 400);
    }

    const resultados: Array<{ conversationId: string; messageId: string }> = [];

    if (payload.object === "whatsapp_business_account") {
      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          if (change.field !== "messages") continue;
          const valor = change.value;
          const phoneNumberId = valor?.metadata?.phone_number_id;
          if (!phoneNumberId || !valor?.messages?.length) continue;

          const conector = await resolverConectorPorPhoneNumberId(phoneNumberId);
          if (!conector) {
            console.error(`[inbox/webhook] phone_number_id "${phoneNumberId}" sem conector cadastrado — mensagem descartada.`);
            continue;
          }

          const nomeContato = valor.contacts?.[0]?.profile?.name ?? "";

          for (const mensagem of valor.messages) {
            if (mensagem.type !== "text" || !mensagem.text?.body || !mensagem.from) {
              // Áudio/imagem/documento/figurinha: fora do escopo desta v1 —
              // registrado em log, nunca descartado silenciosamente.
              console.error(`[inbox/webhook] mensagem do tipo "${mensagem.type}" ainda não suportada — ignorada.`);
              continue;
            }
            const resultado = await registrarMensagemWhatsappAdmin({
              workspaceId: conector.workspaceId,
              telefoneCliente: mensagem.from,
              nomeCliente: nomeContato,
              texto: mensagem.text.body,
              idExterno: mensagem.id,
            });
            resultados.push(resultado);
          }
        }
      }
    } else if (payload.object === "instagram" || payload.object === "page") {
      // Instagram Messaging (`"instagram"`) e Facebook Messenger (`"page"`)
      // compartilham o mesmo formato de payload (`entry[].messaging[]`) — só
      // o `object` de topo e o tipo de conector mudam.
      const canal: CanalMetaMessaging = payload.object === "instagram" ? "instagram" : "facebook";
      for (const entry of payload.entry ?? []) {
        for (const evento of entry.messaging ?? []) {
          if (evento.message?.is_echo) {
            // Eco da própria página/bot respondendo — nunca ingerir, senão o
            // sistema acaba respondendo a si mesmo em loop.
            continue;
          }
          const texto = evento.message?.text;
          const remetenteId = evento.sender?.id;
          const pageId = evento.recipient?.id;
          if (!texto || !remetenteId || !pageId) {
            // Eventos sem texto (reações, anexos, read receipts, etc.):
            // fora do escopo desta v1 — registrado em log, nunca descartado
            // silenciosamente.
            console.error(`[inbox/webhook] evento "${canal}" sem mensagem de texto de cliente — ignorado.`);
            continue;
          }

          const conector = await resolverConectorPorPageId(pageId, canal);
          if (!conector) {
            console.error(`[inbox/webhook] pageId "${pageId}" (${canal}) sem conector cadastrado — mensagem descartada.`);
            continue;
          }

          const resultado = await registrarMensagemMetaAdmin({
            workspaceId: conector.workspaceId,
            canal,
            remetenteId,
            texto,
            idExterno: evento.message?.mid,
          });
          resultados.push(resultado);
        }
      }
    } else {
      // Nenhum dos três `object` reconhecidos pela Meta para mensageria.
      return respostaJson(
        { erro: { codigo: "ingestao_nao_implementada", mensagem: "Assinatura validada, mas este provedor ainda não tem ingestão implementada." } },
        501
      );
    }

    return respostaJson({ processadas: resultados.length }, 200);
  } catch (erro) {
    console.error("[inbox/webhook] erro não tratado:", erro);
    return respostaJson({ erro: { codigo: "erro_interno", mensagem: "Erro interno ao processar o webhook." } }, 500);
  }
}

/**
 * Meta chama GET nesta mesma URL durante a configuração do webhook, para
 * verificar posse do endpoint (handshake de `hub.challenge`).
 */
export async function GET(requisicao: Request): Promise<Response> {
  const url = new URL(requisicao.url);
  const modo = url.searchParams.get("hub.mode");
  const challenge = url.searchParams.get("hub.challenge");
  const tokenVerificacao = url.searchParams.get("hub.verify_token");
  const segredo = process.env[VARIAVEL_SEGREDO]?.trim();

  if (modo === "subscribe" && segredo && tokenVerificacao === segredo && challenge) {
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }

  return respostaJson({ erro: { codigo: "verificacao_invalida", mensagem: "Parâmetros de verificação inválidos." } }, 403);
}
