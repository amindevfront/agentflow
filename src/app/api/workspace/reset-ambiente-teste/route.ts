// POST /api/workspace/reset-ambiente-teste — apaga conversas e fluxos de
// PRÁTICA do workspace do chamador, antes do go-live com um cliente real.
//
// Autorização: só administradores do PRÓPRIO workspace podem acionar esta
// rota. Deliberadamente, `workspaceId` NUNCA vem do corpo da requisição —
// mesmo raciocínio documentado em `/api/audit/seal`: esta rota usa o Admin
// SDK para apagar documentos (ignora `firestore.rules`), então um
// `workspaceId` vindo do cliente permitiria a qualquer usuário autenticado
// de QUALQUER workspace zerar conversas/fluxos de outro tenant só
// declarando o id. O workspace é sempre resolvido a partir do próprio
// usuário autenticado (`users/{uid}`), o que também torna o isolamento
// multi-tenant estrutural, não uma checagem a mais que alguém possa
// esquecer de adicionar depois.
//
// Ação destrutiva e rara: limite de taxa bem mais apertado que o padrão,
// mesma classe de `LIMITE_COFRE`.

import { diagnosticoAdmin, firestoreAdmin } from "@/lib/server/firebaseAdmin";
import { diagnosticoCripto } from "@/lib/server/env";
import { autorizarResetAmbienteTeste, resetarAmbienteDeTeste } from "@/lib/server/testEnvironmentResetAdmin";
import { ErroApi, comGuarda, respostaJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ação rara, cara e destrutiva — mesmo teto de `LIMITE_COFRE`. */
const LIMITE_RESET = { capacidade: 10, taxaPorSegundo: 0.1 };

export const POST = comGuarda(
  async ({ usuario }) => {
    const diagAdmin = diagnosticoAdmin();
    if (!diagAdmin.pronto) {
      throw new ErroApi(
        503,
        `Reset de ambiente indisponível — Admin SDK não configurado: ${diagAdmin.motivo}.`,
        "reset_admin_indisponivel"
      );
    }

    const diagnosticoKek = diagnosticoCripto();
    if (!diagnosticoKek.pronto) {
      throw new ErroApi(
        503,
        `Reset de ambiente indisponível — trilha de auditoria não configurada: ${diagnosticoKek.faltando.join(", ")}.`,
        "auditoria_nao_configurada"
      );
    }

    // Checagem explícita de papel + resolução do workspace a partir do
    // próprio usuário autenticado — mesmo padrão de `/api/campaigns/tick` e
    // `/api/audit/seal` combinados: a autorização real tem de acontecer em
    // código (o Admin SDK ignora `firestore.rules`), e o workspace nunca
    // chega por parâmetro do cliente.
    const usuarioSnap = await firestoreAdmin().collection("users").doc(usuario.uid).get();
    const dadosUsuario = usuarioSnap.exists
      ? (usuarioSnap.data() as { workspaceId?: unknown; papel?: unknown })
      : null;

    const autorizacao = autorizarResetAmbienteTeste(dadosUsuario);
    if (!autorizacao.autorizado || !autorizacao.workspaceId) {
      throw new ErroApi(
        403,
        autorizacao.motivo ?? "Não autorizado.",
        autorizacao.workspaceId ? "papel_insuficiente" : "workspace_nao_encontrado"
      );
    }

    try {
      const resultado = await resetarAmbienteDeTeste(autorizacao.workspaceId, {
        uid: usuario.uid,
        email: usuario.email,
      });
      return respostaJson({
        conversasExcluidas: resultado.conversasExcluidas,
        mensagensExcluidas: resultado.mensagensExcluidas,
        fluxosExcluidos: resultado.fluxosExcluidos,
        execucoesExcluidas: resultado.execucoesExcluidas,
        entradaAuditoriaId: resultado.entradaAuditoria.id,
      });
    } catch (erro) {
      console.error("[workspace/reset-ambiente-teste] falha ao resetar ambiente:", erro);
      throw new ErroApi(500, "Não foi possível resetar o ambiente de testes.", "falha_reset");
    }
  },
  { limite: LIMITE_RESET, escopoLimite: "workspace-reset-ambiente-teste", maxBytesCorpo: 1024 }
);
