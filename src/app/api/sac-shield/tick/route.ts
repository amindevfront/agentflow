// POST /api/sac-shield/tick — cronometra o SLA regulatório de transbordo
// humano e aplica o fallback seguro aos casos vencidos.
//
// Chamada repetidamente por um scheduler externo (Cloud Scheduler, cron) —
// NUNCA pelo navegador do operador. Mesmo padrão de autorização de
// `/api/campaigns/tick`: aplicar um fallback que congela o bot e expira um
// ticket é uma ação de maior risco (afeta o atendimento ativo de um
// cliente), então exige que o chamador seja administrador do workspace, não
// apenas uma sessão válida qualquer.

import { diagnosticoAdmin, firestoreAdmin } from "@/lib/server/firebaseAdmin";
import { processarTickSacShieldSla } from "@/lib/server/sacShieldHandoffMonitor";
import { ErroApi, comGuarda, corpoJson, exigirIdentificador, respostaJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ticks são previsíveis e pouco frequentes — mesmo teto de `/api/campaigns/tick`. */
const LIMITE_TICK = { capacidade: 10, taxaPorSegundo: 0.2 };

interface CorpoTick {
  workspaceId?: unknown;
}

export const POST = comGuarda(
  async ({ requisicao, usuario }) => {
    const diagAdmin = diagnosticoAdmin();
    if (!diagAdmin.pronto) {
      throw new ErroApi(
        503,
        `SAC Shield indisponível — Admin SDK não configurado: ${diagAdmin.motivo}.`,
        "sac_shield_admin_indisponivel"
      );
    }

    const corpo = await corpoJson<CorpoTick>(requisicao);
    const workspaceId = exigirIdentificador(corpo.workspaceId, "workspaceId");

    // Checagem explícita de papel: esta rota usa o Admin SDK para persistir
    // (ignora `firestore.rules`), então a autorização real tem de acontecer
    // em código — mesmo raciocínio de `/api/campaigns/tick`.
    const usuarioSnap = await firestoreAdmin().collection("users").doc(usuario.uid).get();
    const dadosUsuario = usuarioSnap.exists ? (usuarioSnap.data() as { workspaceId?: unknown; papel?: unknown }) : null;
    const ehAdminDoWorkspace = dadosUsuario?.workspaceId === workspaceId && dadosUsuario?.papel === "admin";
    if (!ehAdminDoWorkspace) {
      throw new ErroApi(403, "Apenas administradores do workspace podem processar o SAC Shield.", "papel_insuficiente");
    }

    const resultado = await processarTickSacShieldSla(workspaceId);
    return respostaJson(resultado);
  },
  { limite: LIMITE_TICK, escopoLimite: "sac-shield-tick", maxBytesCorpo: 4 * 1024 }
);
