// POST /api/flows/execute — dispara uma execução real de fluxo.
//
// Este é o elo que faltava entre dois sistemas que já existiam isoladamente:
// o Motor de Guardrails (`@/lib/guardrails`) e o painel de ROI
// (`BusinessROIWidget` → `@/lib/roi` → `onSnapshot` em `flowRuns`). Antes
// desta rota, nada produzia um `FlowRun` com `metrica` real — o painel estava
// corretamente plugado, só não existia produtor de dados do outro lado.
//
// O que esta rota faz, de ponta a ponta:
//   1. autentica e limita taxa (via `comGuarda`, limitador distribuído);
//   2. confirma que o chamador pertence ao workspace do fluxo (ver
//      `executarFluxo` em `@/lib/server/orchestrator` — crucial, pois a
//      escrita final usa o Admin SDK e por isso NÃO passa pelas regras do
//      Firestore, que seriam o portão nesse caso);
//   3. sanitiza o payload (guardrails), chama um modelo real da Anthropic,
//      valida a saída (guardrails), mede tokens e custo reais;
//   4. abre um ticket de transbordo se o guardrail exigir revisão humana;
//   5. persiste o `FlowRun` com `metrica` real — e é esse documento que o
//      painel de ROI, já assinado via `onSnapshot`, exibe como métrica
//      financeira atualizada e não-zerada.
//
// Graceful degradation: sem `ANTHROPIC_API_KEY` ou sem o Admin SDK
// configurado, a rota responde 503 com uma mensagem acionável — nunca deixa
// a exceção subir como um 500 genérico, e nunca derruba o processo.

import { diagnosticoOrquestrador } from "@/lib/server/env";
import { diagnosticoAdmin } from "@/lib/server/firebaseAdmin";
import {
  ErroApi,
  comGuarda,
  corpoJson,
  exigirIdentificador,
  exigirTexto,
  respostaJson,
} from "@/lib/server/http";
import { executarFluxoReal } from "@/lib/server/orchestratorAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Execução real de LLM é cara e lenta — limite bem mais apertado que o padrão. */
const LIMITE_EXECUCAO = { capacidade: 5, taxaPorSegundo: 0.05 };

const MAX_PAYLOAD = 32 * 1024;

interface CorpoExecutarFluxo {
  flowId?: unknown;
  payload?: unknown;
}

export const POST = comGuarda(
  async ({ requisicao, usuario }) => {
    const diagAdmin = diagnosticoAdmin();
    if (!diagAdmin.pronto) {
      throw new ErroApi(
        503,
        `Motor de orquestração indisponível — Admin SDK não configurado: ${diagAdmin.motivo}.`,
        "orquestrador_admin_indisponivel"
      );
    }

    const diagOrq = diagnosticoOrquestrador();
    if (!diagOrq.pronto) {
      throw new ErroApi(
        503,
        `Motor de orquestração indisponível. Variáveis ausentes: ${diagOrq.faltando.join(", ")}.`,
        "orquestrador_nao_configurado"
      );
    }

    const corpo = await corpoJson<CorpoExecutarFluxo>(requisicao, MAX_PAYLOAD);
    const flowId = exigirIdentificador(corpo.flowId, "flowId");
    const payload = exigirTexto(corpo.payload, "payload", { max: MAX_PAYLOAD, min: 1 });

    const resultado = await executarFluxoReal(flowId, payload, { uid: usuario.uid });

    return respostaJson({
      runId: resultado.run.id,
      status: resultado.run.status,
      bloqueado: resultado.bloqueado,
      transbordo: resultado.transbordo,
      ticketsAbertos: resultado.ticketsAbertos.map((t) => t.id),
      metrica: resultado.run.metrica,
    });
  },
  { limite: LIMITE_EXECUCAO, escopoLimite: "flows-execute", maxBytesCorpo: MAX_PAYLOAD }
);
