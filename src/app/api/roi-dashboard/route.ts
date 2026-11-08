// GET /api/roi-dashboard — Painel de Oportunidade & Pipeline (C-Level).
//
// Diferente de `/api/inbox/episodic-memory` e do `BusinessROIWidget` (que
// respondem "quanto economizamos"), esta rota expõe `@/lib/server/roiDashboard`
// — a métrica que responde "quanto negócio isso está gerando": atendimentos,
// leads qualificados de madrugada e agendamentos confirmados traduzidos em
// pipeline financeiro estimado por vertical (ver `VALOR_MEDIO_PIPELINE_PADRAO_BRL`).
//
// `workspaceId` NUNCA vem da query string: resolvido a partir do usuário
// autenticado (mesma leitura de `users/{uid}` já usada por
// `/api/inbox/episodic-memory` via `lerWorkspaceIdDoUsuarioAdmin`) — isso
// impede um usuário de um workspace ler o pipeline estimado de outro.
//
// `disponivel: false` é um estado normal, não um erro: workspaces sem
// `setor` configurado, ou cujo nicho ainda não tem protocolo de confirmação
// de agendamento implementado, simplesmente não têm pipeline a mostrar (ver
// nota de "No Invention" em `@/lib/server/roiDashboard`).

import { lerWorkspaceIdDoUsuarioAdmin } from "@/lib/server/orchestratorAdmin";
import { obterMetricasPipelineVerticalAdmin } from "@/lib/server/roiDashboard";
import { ErroApi, comGuarda, respostaJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = comGuarda(
  async ({ usuario }) => {
    const workspaceId = await lerWorkspaceIdDoUsuarioAdmin(usuario.uid);
    if (!workspaceId) {
      throw new ErroApi(403, "Usuário sem workspace associado.", "workspace_nao_encontrado");
    }

    const metricas = await obterMetricasPipelineVerticalAdmin(workspaceId);
    if (!metricas) {
      return respostaJson({ disponivel: false, metricas: null });
    }

    return respostaJson({ disponivel: true, metricas });
  },
  { escopoLimite: "roi-dashboard", limite: { capacidade: 20, taxaPorSegundo: 0.3 } }
);
