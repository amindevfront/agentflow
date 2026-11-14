// POST /api/ar-recovery/tick — processa o monitor autônomo do AR Recovery
// Engine: envia follow-up de cobrança humanizado (dentro do limite de
// tentativas automáticas) ou escala para um ticket HITL.
//
// Chamada repetidamente por um scheduler externo (Cloud Scheduler/cron) —
// NUNCA pelo navegador do operador. Mesmo padrão de autorização de
// `/api/sac-shield/tick`: processar cobrança é ação de maior risco
// (comunicação com terceiro/devedor), então exige administrador do
// workspace, não apenas uma sessão válida qualquer.

import { diagnosticoAdmin, firestoreAdmin } from "@/lib/server/firebaseAdmin";
import { processarTickArRecoveryEngine } from "@/lib/server/arRecoveryEngine";
import { ErroApi, comGuarda, corpoJson, exigirIdentificador, respostaJson } from "@/lib/server/http";
import { obterIdsModulosAtivos } from "@/modules/registry";
import type { Workspace } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mesmo teto de `/api/sac-shield/tick`/`/api/campaigns/tick` — ticks são previsíveis e pouco frequentes. */
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
        `AR Recovery Engine indisponível — Admin SDK não configurado: ${diagAdmin.motivo}.`,
        "ar_recovery_admin_indisponivel"
      );
    }

    const corpo = await corpoJson<CorpoTick>(requisicao);
    const workspaceId = exigirIdentificador(corpo.workspaceId, "workspaceId");

    // Checagem explícita de papel: esta rota usa o Admin SDK para persistir
    // (ignora `firestore.rules`), então a autorização real tem de acontecer
    // em código — mesmo raciocínio de `/api/sac-shield/tick`.
    const usuarioSnap = await firestoreAdmin().collection("users").doc(usuario.uid).get();
    const dadosUsuario = usuarioSnap.exists ? (usuarioSnap.data() as { workspaceId?: unknown; papel?: unknown }) : null;
    const ehAdminDoWorkspace = dadosUsuario?.workspaceId === workspaceId && dadosUsuario?.papel === "admin";
    if (!ehAdminDoWorkspace) {
      throw new ErroApi(403, "Apenas administradores do workspace podem processar o AR Recovery Engine.", "papel_insuficiente");
    }

    // Um scheduler externo (Cloud Scheduler/cron) não sabe, por si só, que o
    // workspace desligou esta gaveta em Configurações — nada no código
    // desregistra o job externo quando isso acontece. Sem esta checagem, um
    // documento pendente que ficou esquecido na coleção continuaria
    // recebendo cobrança/escalonamento/crédito de ROI indefinidamente,
    // mesmo com a gaveta oficialmente desativada. Degrada para um resultado
    // zerado (nunca um erro — "módulo desligado" é um estado normal, não uma
    // falha) em vez de processar silenciosamente.
    const workspaceSnap = await firestoreAdmin().collection("workspaces").doc(workspaceId).get();
    const modulosAtivos = obterIdsModulosAtivos(
      workspaceSnap.exists ? (workspaceSnap.data() as Pick<Workspace, "setor" | "modulosAtivos">) : null
    );
    if (!modulosAtivos.includes("ar-recovery-engine")) {
      return respostaJson({ documentosVerificados: 0, cobrancasEnviadas: 0, escalonamentosAbertos: 0 });
    }

    const resultado = await processarTickArRecoveryEngine(workspaceId);
    return respostaJson(resultado);
  },
  { limite: LIMITE_TICK, escopoLimite: "ar-recovery-tick", maxBytesCorpo: 4 * 1024 }
);
