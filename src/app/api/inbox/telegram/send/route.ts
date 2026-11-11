// POST /api/inbox/telegram/send — envia a resposta do atendente de volta por
// Telegram real (Telegram Bot API).
//
// Mesmo padrão de `sms/send/route.ts`: não persiste a mensagem (isso
// continua sendo feito pelo cliente, via `enviarMensagemOperador`) — esta
// rota só cuida da entrega externa de verdade. Diferente de WhatsApp/SMS
// (token global em variável de ambiente), o token do bot do Telegram é
// decifrado do Cofre Zero-Trust a cada envio (ver `enviarMensagemTelegram`
// em `@/lib/server/telegramBotAdmin`). O `conversationId` é resolvido
// contra o workspace do usuário autenticado antes de qualquer chamada ao
// Telegram — nunca confia num `chatId` vindo direto do corpo da requisição.

import { firestoreAdmin } from "@/lib/server/firebaseAdmin";
import { lerWorkspaceIdDoUsuarioAdmin } from "@/lib/server/orchestratorAdmin";
import {
  enviarMensagemTelegram,
  ErroEnvioTelegram,
  resolverConectorTelegramDoWorkspace,
} from "@/lib/server/telegramBotAdmin";
import { ErroApi, comGuarda, corpoJson, exigirIdentificador, exigirTexto, respostaJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CorpoEnvio {
  conversationId?: unknown;
  texto?: unknown;
}

const LIMITE_ENVIO = { capacidade: 30, taxaPorSegundo: 0.5 };

export const POST = comGuarda(
  async ({ requisicao, usuario }) => {
    const corpo = await corpoJson<CorpoEnvio>(requisicao);
    const conversationId = exigirIdentificador(corpo.conversationId, "conversationId");
    const texto = exigirTexto(corpo.texto, "texto", { max: 4096, min: 1 });

    const workspaceId = await lerWorkspaceIdDoUsuarioAdmin(usuario.uid);
    if (!workspaceId) {
      throw new ErroApi(403, "Usuário sem workspace associado.", "workspace_nao_encontrado");
    }

    const conversaSnap = await firestoreAdmin().collection("conversations").doc(conversationId).get();
    if (!conversaSnap.exists) {
      throw new ErroApi(404, "Conversa não encontrada.", "conversa_nao_encontrada");
    }
    const dadosConversa = conversaSnap.data() as { workspaceId?: string; telegramChatId?: string; canal?: string };
    if (dadosConversa.workspaceId !== workspaceId) {
      // Mesma conversa, workspace diferente do usuário autenticado — nunca
      // revela se a conversa existe em outro workspace, devolve 404 igual ao
      // caso "não encontrada".
      throw new ErroApi(404, "Conversa não encontrada.", "conversa_nao_encontrada");
    }
    if (dadosConversa.canal !== "telegram" || !dadosConversa.telegramChatId) {
      throw new ErroApi(400, "Esta conversa não é um contato de Telegram.", "canal_invalido");
    }

    const conector = await resolverConectorTelegramDoWorkspace(workspaceId);
    if (!conector) {
      throw new ErroApi(
        400,
        "Nenhum conector de Telegram Bot API cadastrado neste workspace — vá em Canais & Integrações.",
        "conector_nao_encontrado"
      );
    }

    try {
      await enviarMensagemTelegram({
        credentialId: conector.credentialId,
        workspaceId,
        chatId: dadosConversa.telegramChatId,
        texto,
      });
    } catch (erro) {
      if (erro instanceof ErroEnvioTelegram) {
        throw new ErroApi(502, erro.message, "falha_envio_telegram");
      }
      throw erro;
    }

    return respostaJson({ enviado: true });
  },
  { limite: LIMITE_ENVIO, escopoLimite: "telegram-send", maxBytesCorpo: 8 * 1024 }
);
