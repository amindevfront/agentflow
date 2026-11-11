// POST /api/team/remove-member — remove um membro da equipe do workspace do
// chamador (Configurações → Equipe, exclusivo de admin).
//
// Mesmo raciocínio de `/api/workspace/reset-ambiente-teste`: o Admin SDK
// ignora `firestore.rules` (que já negam este delete a qualquer cliente de
// propósito), então o workspace do ATOR é sempre resolvido a partir do
// próprio token, nunca do corpo da requisição — só o `uid` do ALVO vem do
// corpo, e `removerMembro` confirma que ele pertence ao mesmo workspace
// antes de tocar em qualquer dado.

import { diagnosticoAdmin, firestoreAdmin } from "@/lib/server/firebaseAdmin";
import { diagnosticoCripto } from "@/lib/server/env";
import { autorizarAcaoDeEquipe, removerMembro, ErroAcaoEquipe } from "@/lib/server/teamAdmin";
import { ErroApi, comGuarda, corpoJson, exigirIdentificador, respostaJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMITE_EQUIPE = { capacidade: 20, taxaPorSegundo: 0.5 };

export const POST = comGuarda(
  async ({ usuario, requisicao }) => {
    const diagAdmin = diagnosticoAdmin();
    if (!diagAdmin.pronto) {
      throw new ErroApi(503, `Indisponível — Admin SDK não configurado: ${diagAdmin.motivo}.`, "admin_indisponivel");
    }
    const diagnosticoKek = diagnosticoCripto();
    if (!diagnosticoKek.pronto) {
      throw new ErroApi(
        503,
        `Indisponível — trilha de auditoria não configurada: ${diagnosticoKek.faltando.join(", ")}.`,
        "auditoria_nao_configurada"
      );
    }

    const corpo = await corpoJson<{ uid?: unknown }>(requisicao);
    const targetUid = exigirIdentificador(corpo.uid, "uid");

    const usuarioSnap = await firestoreAdmin().collection("users").doc(usuario.uid).get();
    const dadosUsuario = usuarioSnap.exists
      ? (usuarioSnap.data() as { workspaceId?: unknown; papel?: unknown })
      : null;

    const autorizacao = autorizarAcaoDeEquipe(dadosUsuario);
    if (!autorizacao.autorizado || !autorizacao.workspaceId) {
      throw new ErroApi(
        403,
        autorizacao.motivo ?? "Não autorizado.",
        autorizacao.workspaceId ? "papel_insuficiente" : "workspace_nao_encontrado"
      );
    }

    try {
      const resultado = await removerMembro(autorizacao.workspaceId, targetUid, {
        uid: usuario.uid,
        email: usuario.email,
      });
      return respostaJson({ uidRemovido: resultado.uidRemovido, entradaAuditoriaId: resultado.entradaAuditoria.id });
    } catch (erro) {
      if (erro instanceof ErroAcaoEquipe) {
        throw new ErroApi(409, erro.message, erro.codigo);
      }
      console.error("[team/remove-member] falha ao remover membro:", erro);
      throw new ErroApi(500, "Não foi possível remover este membro agora.", "falha_remover_membro");
    }
  },
  { limite: LIMITE_EQUIPE, escopoLimite: "team-remove-member", maxBytesCorpo: 1024 }
);
