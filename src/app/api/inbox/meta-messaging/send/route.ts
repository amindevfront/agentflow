// POST /api/inbox/meta-messaging/send — envia a resposta do atendente de
// volta pelo Instagram Direct ou Facebook Messenger reais (Meta Graph API).
//
// Mesmo padrão de `whatsapp/send/route.ts`: não persiste a mensagem (isso
// continua sendo feito pelo cliente, via `enviarMensagemOperador`) — esta
// rota só cuida da entrega externa de verdade, que exige um token
// server-only (`META_PAGE_ACCESS_TOKEN`). O `conversationId` é resolvido
// contra o workspace do usuário autenticado antes de qualquer chamada ao
// Meta — nunca confia num `destinatarioId` vindo direto do corpo da
// requisição.

import { firestoreAdmin } from "@/lib/server/firebaseAdmin";
import { lerWorkspaceIdDoUsuarioAdmin } from "@/lib/server/orchestratorAdmin";
import {
  enviarMensagemMetaMessaging,
  ErroEnvioMetaMessaging,
  resolverPageIdDoWorkspace,
  type CanalMetaMessaging,
} from "@/lib/server/metaMessagingAdmin";
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
    const dadosConversa = conversaSnap.data() as { workspaceId?: string; metaSenderId?: string; canal?: string };
    if (dadosConversa.workspaceId !== workspaceId) {
      // Mesma conversa, workspace diferente do usuário autenticado — nunca
      // revela se a conversa existe em outro workspace, devolve 404 igual ao
      // caso "não encontrada".
      throw new ErroApi(404, "Conversa não encontrada.", "conversa_nao_encontrada");
    }
    if ((dadosConversa.canal !== "instagram" && dadosConversa.canal !== "facebook") || !dadosConversa.metaSenderId) {
      throw new ErroApi(400, "Esta conversa não é um contato de Instagram/Facebook.", "canal_invalido");
    }
    const canal = dadosConversa.canal as CanalMetaMessaging;

    const metaPageId = await resolverPageIdDoWorkspace(workspaceId, canal);
    if (!metaPageId) {
      throw new ErroApi(
        400,
        `Nenhum conector de ${canal === "instagram" ? "Instagram Direct" : "Facebook Messenger"} (Meta Graph API) cadastrado neste workspace — vá em Canais & Integrações.`,
        "conector_nao_encontrado"
      );
    }

    try {
      await enviarMensagemMetaMessaging({
        metaPageId,
        destinatarioId: dadosConversa.metaSenderId,
        texto,
      });
    } catch (erro) {
      if (erro instanceof ErroEnvioMetaMessaging) {
        throw new ErroApi(502, erro.message, "falha_envio_meta_messaging");
      }
      throw erro;
    }

    return respostaJson({ enviado: true });
  },
  { limite: LIMITE_ENVIO, escopoLimite: "meta-messaging-send", maxBytesCorpo: 8 * 1024 }
);
