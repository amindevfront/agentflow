// POST /api/campaigns/tick — processa os envios de campanha vencidos.
//
// Chamada repetidamente por um scheduler externo (Cloud Scheduler, cron) —
// NUNCA pelo navegador do operador. Cada chamada processa apenas o que já
// venceu no momento (ver `processarTickCampanhas` → `processarEnviosDevidos`),
// nunca uma campanha inteira de uma vez — uma campanha com jitter de horas
// não pode travar uma requisição HTTP.
//
// Autorização: exige autenticação (como toda rota desta API) e, adicional-
// mente, que o chamador seja administrador do workspace — disparo em massa é
// uma ação de maior risco e não deveria ser acionável por qualquer sessão
// válida, só pelo scheduler autenticado com credenciais de um admin.

import { diagnosticoAdmin, firestoreAdmin } from "@/lib/server/firebaseAdmin";
import { processarTickCampanhas } from "@/lib/server/campaignsAdmin";
import { ErroApi, comGuarda, corpoJson, exigirIdentificador, respostaJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ticks são previsíveis e pouco frequentes — limite moderado, não apertado. */
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
        `Processamento de campanhas indisponível — Admin SDK não configurado: ${diagAdmin.motivo}.`,
        "campanhas_admin_indisponivel"
      );
    }

    const corpo = await corpoJson<CorpoTick>(requisicao);
    const workspaceId = exigirIdentificador(corpo.workspaceId, "workspaceId");

    // Checagem explícita de papel: esta rota usa o Admin SDK para persistir
    // (ignora `firestore.rules`), então a autorização real tem de acontecer
    // em código, não no banco — o mesmo raciocínio de `executarFluxo` para a
    // verificação de posse de workspace.
    const usuarioSnap = await firestoreAdmin().collection("users").doc(usuario.uid).get();
    const dadosUsuario = usuarioSnap.exists ? (usuarioSnap.data() as { workspaceId?: unknown; papel?: unknown }) : null;
    const ehAdminDoWorkspace = dadosUsuario?.workspaceId === workspaceId && dadosUsuario?.papel === "admin";
    if (!ehAdminDoWorkspace) {
      throw new ErroApi(403, "Apenas administradores do workspace podem processar campanhas.", "papel_insuficiente");
    }

    const resultado = await processarTickCampanhas(workspaceId);
    return respostaJson(resultado);
  },
  { limite: LIMITE_TICK, escopoLimite: "campaigns-tick", maxBytesCorpo: 4 * 1024 }
);
