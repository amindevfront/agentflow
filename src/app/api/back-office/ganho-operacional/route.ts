// POST /api/back-office/ganho-operacional — credita o ganho operacional
// (horas economizadas) de uma gaveta de back-office como um `FlowRun`
// concluído (ver `@/lib/server/backOfficeRoi`).
//
// `workspaceId` NUNCA vem do corpo da requisição: resolvido a partir do
// usuário autenticado (mesmo padrão de `/api/roi-dashboard`) — impede um
// usuário de um workspace creditar ganho operacional em outro. Os MINUTOS
// economizados também nunca vêm do cliente: são uma tabela fixa no servidor
// (`MINUTOS_ECONOMIZADOS_POR_ORIGEM`) — só `origem`/`descricao` (rótulo de
// exibição) são informados pelo chamador.
//
// `origem` é restrita a `ORIGENS_BACK_OFFICE_CREDITAVEIS_PELO_CLIENTE`, NÃO
// a todas as chaves de `MINUTOS_ECONOMIZADOS_POR_ORIGEM`: AR Recovery Engine
// e Spot Driver Onboarding têm tick próprio (Admin SDK, só acessível a
// admin do workspace) que já credita automaticamente depois de validar
// estado real — aceitar essas origens aqui deixaria QUALQUER membro
// autenticado (não precisa ser admin) fabricar "horas economizadas" dessas
// duas gavetas sem nenhuma cobrança/triagem real ter acontecido.

import { lerWorkspaceIdDoUsuarioAdmin } from "@/lib/server/orchestratorAdmin";
import {
  type OrigemBackOffice,
  ORIGENS_BACK_OFFICE_CREDITAVEIS_PELO_CLIENTE,
  registrarGanhoOperacionalAdmin,
} from "@/lib/server/backOfficeRoi";
import { ErroApi, comGuarda, corpoJson, respostaJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGENS_VALIDAS = new Set<OrigemBackOffice>(ORIGENS_BACK_OFFICE_CREDITAVEIS_PELO_CLIENTE);

interface CorpoGanhoOperacional {
  origem?: unknown;
  descricao?: unknown;
}

export const POST = comGuarda(
  async ({ requisicao, usuario }) => {
    const workspaceId = await lerWorkspaceIdDoUsuarioAdmin(usuario.uid);
    if (!workspaceId) {
      throw new ErroApi(403, "Usuário sem workspace associado.", "workspace_nao_encontrado");
    }

    const corpo = await corpoJson<CorpoGanhoOperacional>(requisicao);
    if (typeof corpo.origem !== "string" || !ORIGENS_VALIDAS.has(corpo.origem as OrigemBackOffice)) {
      throw new ErroApi(400, "Campo 'origem' inválido ou ausente.", "origem_invalida");
    }
    const descricao = typeof corpo.descricao === "string" && corpo.descricao.trim() ? corpo.descricao.trim() : "Operação concluída";

    const run = await registrarGanhoOperacionalAdmin({
      workspaceId,
      origem: corpo.origem as OrigemBackOffice,
      descricao,
    });

    return respostaJson({ runId: run.id, minutosEconomizados: run.metrica?.minutosManuaisEvitados ?? 0 });
  },
  { escopoLimite: "back-office-ganho-operacional", limite: { capacidade: 60, taxaPorSegundo: 1 }, maxBytesCorpo: 2 * 1024 }
);
