// GET /api/inbox/episodic-memory — Motor de Memória Episódica e Contexto
// Multi-Canal.
//
// Autenticada (ID token do Firebase, via `comGuarda`). Necessária porque o
// nó do grafo (`episodicMemoryNodes/{workspaceId}__{clienteId}`) só existe no
// Admin SDK — nenhuma regra do Firestore libera leitura direta do cliente
// (ver `@/lib/server/episodicMemory`), então qualquer painel que queira
// mostrar o histórico cross-channel de um cliente precisa passar por esta
// rota.
//
// `workspaceId` NUNCA vem da query string: é resolvido a partir do usuário
// autenticado (mesma leitura de `users/{uid}` já usada por
// `executarFluxoReal`, reaproveitada via `lerWorkspaceIdDoUsuarioAdmin`) —
// isso impede um usuário de um workspace ler a memória episódica de outro
// simplesmente trocando o parâmetro na URL.

import { lerWorkspaceIdDoUsuarioAdmin } from "@/lib/server/orchestratorAdmin";
import { formatarResumoUnificado, obterNoClienteEpisodico } from "@/lib/server/episodicMemory";
import { ErroApi, comGuarda, exigirIdentificador, respostaJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = comGuarda(
  async ({ requisicao, usuario }) => {
    const workspaceId = await lerWorkspaceIdDoUsuarioAdmin(usuario.uid);
    if (!workspaceId) {
      throw new ErroApi(403, "Usuário sem workspace associado.", "workspace_nao_encontrado");
    }

    const url = new URL(requisicao.url);
    const clienteId = exigirIdentificador(url.searchParams.get("clienteId"), "clienteId");

    const no = await obterNoClienteEpisodico(workspaceId, clienteId);
    if (!no) {
      return respostaJson({ clienteId, encontrado: false, no: null, resumoTexto: null });
    }

    return respostaJson({ clienteId, encontrado: true, no, resumoTexto: formatarResumoUnificado(no) });
  },
  { escopoLimite: "inbox-episodic-memory", limite: { capacidade: 30, taxaPorSegundo: 0.5 } }
);
