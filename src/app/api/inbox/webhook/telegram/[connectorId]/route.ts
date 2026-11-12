// POST /api/inbox/webhook/telegram/[connectorId] — ingestão de mensagens do
// Telegram Bot API.
//
// Diferente de WhatsApp/Meta (assinatura HMAC sobre o corpo) e de Twilio
// (assinatura HMAC sobre a URL+parâmetros), o Telegram autentica a chamada
// de webhook por um SEGREDO FIXO no header `X-Telegram-Bot-Api-Secret-Token`
// — configurado manualmente pelo implementador na chamada `setWebhook` da
// API do Telegram, fora do AgentFlow (mesmo padrão documentado na tela de
// Canais & Integrações para Meta/Twilio). Comparação em tempo constante
// (`comparacaoSegura`) para não vazar, pelo tempo de execução, quantos
// caracteres iniciais do segredo coincidem.
//
// O id do conector já está na própria URL (`[connectorId]`) — diferente dos
// demais canais, não há campo de roteamento a buscar por `where`: o conector
// é lido direto por id (ver `resolverConectorTelegram` em
// `@/lib/server/telegramBotAdmin`).
//
// DELIBERADAMENTE NÃO usa `comGuarda`: o Telegram nunca envia um ID token do
// Firebase — ele autentica pelo segredo de webhook acima.
//
// Updates que não são mensagem de texto de cliente (`edited_message`,
// `channel_post`, updates sem `message.text`) são ignorados com 200 — nunca
// um erro, senão o Telegram desativa o webhook após falhas repetidas.

import { comparacaoSegura } from "@/lib/crypto/encoding";
import {
  obterTokenTelegram,
  registrarMensagemTelegramAdmin,
  resolverConectorTelegram,
} from "@/lib/server/telegramBotAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES_CORPO = 16 * 1024;

const CABECALHOS_SEGUROS: Record<string, string> = {
  "cache-control": "no-store, no-cache, must-revalidate, private",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function respostaJson(dados: unknown, status: number): Response {
  return new Response(JSON.stringify(dados), { status, headers: CABECALHOS_SEGUROS });
}

interface UpdateTelegram {
  message?: {
    chat?: { id?: number | string };
    from?: { first_name?: string; username?: string };
    text?: string;
    message_id?: number;
  };
  // Tipos de update que existem no protocolo do Telegram mas não
  // representam mensagem de texto de cliente — presentes só para que o
  // parse nunca falhe neles; o corpo do handler os ignora com 200.
  edited_message?: unknown;
  channel_post?: unknown;
}

export async function POST(
  requisicao: Request,
  { params }: { params: Promise<{ connectorId: string }> }
): Promise<Response> {
  try {
    const { connectorId } = await params;

    const declarado = requisicao.headers.get("content-length");
    if (declarado && Number(declarado) > MAX_BYTES_CORPO) {
      return respostaJson({ erro: { codigo: "corpo_grande", mensagem: "Corpo excede o limite." } }, 413);
    }

    const conector = await resolverConectorTelegram(connectorId);
    if (!conector) {
      // Nunca revela se o id existe com outro tipo/configuração — mesma
      // resposta genérica para "não existe" e "não está pronto".
      return respostaJson(
        { erro: { codigo: "conector_nao_encontrado", mensagem: "Conector do Telegram não encontrado ou incompleto." } },
        404
      );
    }

    const segredoRecebido = requisicao.headers.get("x-telegram-bot-api-secret-token");
    if (!segredoRecebido) {
      return respostaJson({ erro: { codigo: "assinatura_invalida", mensagem: "Segredo de webhook inválido." } }, 401);
    }

    let webhookSecret: string;
    try {
      webhookSecret = await obterTokenTelegram(conector.webhookSecretCredentialId, conector.workspaceId);
    } catch (erro) {
      // Credencial do cofre ausente/corrompida/revogada — mesma resposta
      // genérica de "segredo inválido", nunca um 500 que confirme ao chamador
      // que o conector existe e só o segredo está com problema.
      console.error("[inbox/webhook/telegram] falha ao decifrar segredo de webhook:", erro);
      return respostaJson({ erro: { codigo: "assinatura_invalida", mensagem: "Segredo de webhook inválido." } }, 401);
    }

    if (!comparacaoSegura(segredoRecebido, webhookSecret)) {
      return respostaJson({ erro: { codigo: "assinatura_invalida", mensagem: "Segredo de webhook inválido." } }, 401);
    }

    const corpoBruto = await requisicao.text();
    if (corpoBruto.length > MAX_BYTES_CORPO) {
      return respostaJson({ erro: { codigo: "corpo_grande", mensagem: "Corpo excede o limite." } }, 413);
    }

    let update: UpdateTelegram;
    try {
      update = JSON.parse(corpoBruto) as UpdateTelegram;
    } catch {
      return respostaJson({ erro: { codigo: "json_invalido", mensagem: "Corpo do webhook não é JSON válido." } }, 400);
    }

    const mensagem = update.message;
    const chatId = mensagem?.chat?.id;
    const texto = mensagem?.text;
    if (chatId === undefined || chatId === null || !texto) {
      // `edited_message`, `channel_post`, ou qualquer update sem
      // `message.text` — não é mensagem de texto de cliente, ignorado com
      // 200 (nunca erro, ver cabeçalho do arquivo).
      return respostaJson({ ignorado: true }, 200);
    }

    const remetenteNome = mensagem?.from?.first_name ?? mensagem?.from?.username ?? "";

    const resultado = await registrarMensagemTelegramAdmin({
      workspaceId: conector.workspaceId,
      chatId: String(chatId),
      remetenteNome,
      texto,
      idExterno: mensagem?.message_id !== undefined ? String(mensagem.message_id) : undefined,
    });

    return respostaJson({ ingerido: true, conversationId: resultado.conversationId }, 200);
  } catch (erro) {
    console.error("[inbox/webhook/telegram] erro não tratado:", erro);
    return respostaJson({ erro: { codigo: "erro_interno", mensagem: "Erro interno ao processar o webhook." } }, 500);
  }
}
