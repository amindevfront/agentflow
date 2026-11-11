// POST /api/team/revoke-invite — cancela um convite ainda pendente
// (Configurações → Equipe, exclusivo de admin). Mesmo raciocínio de
// `/api/team/remove-member`: workspace do ator vem sempre do token, nunca do
// corpo; `revogarConvite` confirma que o convite pertence a esse workspace.

import { diagnosticoAdmin, firestoreAdmin } from "@/lib/server/firebaseAdmin";
import { diagnosticoCripto } from "@/lib/server/env";
import { autorizarAcaoDeEquipe, revogarConvite, ErroAcaoEquipe } from "@/lib/server/teamAdmin";
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

    const corpo = await corpoJson<{ inviteId?: unknown }>(requisicao);
    const inviteId = exigirIdentificador(corpo.inviteId, "inviteId");

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
      const resultado = await revogarConvite(autorizacao.workspaceId, inviteId, {
        uid: usuario.uid,
        email: usuario.email,
      });
      return respostaJson({
        inviteIdRevogado: resultado.inviteIdRevogado,
        entradaAuditoriaId: resultado.entradaAuditoria.id,
      });
    } catch (erro) {
      if (erro instanceof ErroAcaoEquipe) {
        throw new ErroApi(409, erro.message, erro.codigo);
      }
      console.error("[team/revoke-invite] falha ao revogar convite:", erro);
      throw new ErroApi(500, "Não foi possível revogar este convite agora.", "falha_revogar_convite");
    }
  },
  { limite: LIMITE_EQUIPE, escopoLimite: "team-revoke-invite", maxBytesCorpo: 1024 }
);
