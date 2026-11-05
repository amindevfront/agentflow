// POST /api/sac-shield/evidence-package — exporta o Pacote de Evidência de
// Conformidade de um período.
//
// Exportar a trilha de auditoria inteira de um período é uma ação sensível
// (expõe o histórico operacional completo do workspace, inclusive violações
// e decisões de transbordo) — mesma autorização de administrador exigida
// por `/api/campaigns/tick` e `/api/sac-shield/tick`.

import { diagnosticoAdmin, firestoreAdmin } from "@/lib/server/firebaseAdmin";
import { ErroApi, comGuarda, corpoJson, exigirIdentificador, respostaJson } from "@/lib/server/http";
import { gerarPacoteEvidenciaConformidade } from "@/lib/server/sacShieldEvidencePackage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Exportação de evidência é rara e pesada — limite bem mais apertado que um tick comum. */
const LIMITE_EXPORTACAO = { capacidade: 5, taxaPorSegundo: 0.05 };

/** Teto de abrangência de um único pacote — evita uma consulta não limitada sobre anos de histórico. */
const MAX_DIAS_PERIODO = 366;

interface CorpoEvidencia {
  workspaceId?: unknown;
  periodoInicio?: unknown;
  periodoFim?: unknown;
}

function exigirData(valor: unknown, campo: string): Date {
  if (typeof valor !== "string") {
    throw new ErroApi(400, `Campo "${campo}" deve ser uma data ISO 8601.`, "campo_invalido");
  }
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) {
    throw new ErroApi(400, `Campo "${campo}" não é uma data válida.`, "campo_invalido");
  }
  return data;
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

    const corpo = await corpoJson<CorpoEvidencia>(requisicao);
    const workspaceId = exigirIdentificador(corpo.workspaceId, "workspaceId");
    const periodoInicio = exigirData(corpo.periodoInicio, "periodoInicio");
    const periodoFim = exigirData(corpo.periodoFim, "periodoFim");

    if (periodoFim.getTime() < periodoInicio.getTime()) {
      throw new ErroApi(400, '"periodoFim" não pode ser anterior a "periodoInicio".', "periodo_invalido");
    }
    const diasNoPeriodo = (periodoFim.getTime() - periodoInicio.getTime()) / (24 * 60 * 60 * 1000);
    if (diasNoPeriodo > MAX_DIAS_PERIODO) {
      throw new ErroApi(400, `O período não pode exceder ${MAX_DIAS_PERIODO} dias.`, "periodo_invalido");
    }

    const usuarioSnap = await firestoreAdmin().collection("users").doc(usuario.uid).get();
    const dadosUsuario = usuarioSnap.exists ? (usuarioSnap.data() as { workspaceId?: unknown; papel?: unknown }) : null;
    const ehAdminDoWorkspace = dadosUsuario?.workspaceId === workspaceId && dadosUsuario?.papel === "admin";
    if (!ehAdminDoWorkspace) {
      throw new ErroApi(
        403,
        "Apenas administradores do workspace podem exportar o Pacote de Evidência de Conformidade.",
        "papel_insuficiente"
      );
    }

    const pacote = await gerarPacoteEvidenciaConformidade({ workspaceId, periodoInicio, periodoFim });
    return respostaJson(pacote);
  },
  { limite: LIMITE_EXPORTACAO, escopoLimite: "sac-shield-evidence", maxBytesCorpo: 4 * 1024 }
);
