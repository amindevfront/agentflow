// POST /api/inbox/whatsapp/send — envia a resposta do atendente de volta pelo
// WhatsApp real (WhatsApp Cloud API / Meta).
//
// Não persiste a mensagem: a gravação em Firestore continua sendo feita pelo
// cliente, via `enviarMensagemOperador` (mesmo caminho de qualquer outro
// canal) — esta rota só cuida da entrega externa de verdade, que exige um
// token server-only (`WHATSAPP_ACCESS_TOKEN`). O `conversationId` é
// resolvido contra o workspace do usuário autenticado antes de qualquer
// chamada ao Meta — nunca confia num `telefoneDestino` vindo direto do
// corpo da requisição.

import { firestoreAdmin } from "@/lib/server/firebaseAdmin";
import { lerWorkspaceIdDoUsuarioAdmin } from "@/lib/server/orchestratorAdmin";
import { enviarMensagemWhatsappCloudApi, ErroEnvioWhatsapp, resolverPhoneNumberIdDoWorkspace } from "@/lib/server/whatsappCloudApiAdmin";
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
    const dadosConversa = conversaSnap.data() as { workspaceId?: string; whatsappTelefone?: string; canal?: string };
    if (dadosConversa.workspaceId !== workspaceId) {
      // Mesma conversa, workspace diferente do usuário autenticado — nunca
      // revela se a conversa existe em outro workspace, devolve 404 igual ao
      // caso "não encontrada".
      throw new ErroApi(404, "Conversa não encontrada.", "conversa_nao_encontrada");
    }
    if (dadosConversa.canal !== "whatsapp" || !dadosConversa.whatsappTelefone) {
      throw new ErroApi(400, "Esta conversa não é um contato de WhatsApp.", "canal_invalido");
    }

    const metaPhoneNumberId = await resolverPhoneNumberIdDoWorkspace(workspaceId);
    if (!metaPhoneNumberId) {
      throw new ErroApi(
        400,
        "Nenhum conector de WhatsApp Business (Cloud API) cadastrado neste workspace — vá em Canais & Integrações.",
        "conector_nao_encontrado"
      );
    }

    try {
      await enviarMensagemWhatsappCloudApi({
        metaPhoneNumberId,
        telefoneDestino: dadosConversa.whatsappTelefone,
        texto,
      });
    } catch (erro) {
      if (erro instanceof ErroEnvioWhatsapp) {
        throw new ErroApi(502, erro.message, "falha_envio_whatsapp");
      }
      throw erro;
    }

    return respostaJson({ enviado: true });
  },
  { limite: LIMITE_ENVIO, escopoLimite: "whatsapp-send", maxBytesCorpo: 8 * 1024 }
);
