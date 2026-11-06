// POST /api/flows/simulate-ab — Simulador de A/B Testing de Prompts e
// Comportamento.
//
// Roda duas ou mais variantes de prompt (`contextoNicho`/`contextoConversao`
// alternativos) em replay contra o histórico REAL mascarado do workspace do
// fluxo, medindo a taxa de conversão simulada de cada uma ANTES de qualquer
// variante subir para produção — ver `@/lib/server/promptSimulator`.
//
// Mesma verificação de posse de `/api/flows/execute` (o chamador precisa
// pertencer ao workspace do fluxo), feita ANTES de gastar qualquer chamada
// real à Anthropic — reaproveita `lerFlowComPosseAdmin`
// (`@/lib/server/orchestratorAdmin`), a mesma checagem, sem duplicá-la.
//
// Limite de taxa deliberadamente apertado: cada chamada desta rota dispara
// N variantes × M conversas de replay em chamadas reais ao modelo — uma
// bateria, não uma interação pontual.

import { diagnosticoOrquestrador } from "@/lib/server/env";
import { diagnosticoAdmin } from "@/lib/server/firebaseAdmin";
import { lerFlowComPosseAdmin } from "@/lib/server/orchestratorAdmin";
import {
  criarClassificadorPorPalavrasChave,
  executarSimulacaoABAdmin,
  type VarianteDePrompt,
} from "@/lib/server/promptSimulator";
import {
  ErroApi,
  comGuarda,
  corpoJson,
  exigirIdentificador,
  exigirTexto,
  respostaJson,
} from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bateria de simulação é cara (N variantes × M conversas de replay, cada uma uma chamada real à Anthropic) — limite bem mais apertado que `/api/flows/execute`. */
const LIMITE_SIMULACAO = { capacidade: 2, taxaPorSegundo: 0.02 };

const MAX_PAYLOAD = 16 * 1024;
const MIN_VARIANTES = 2;
const MAX_VARIANTES = 5;
const MAX_PALAVRAS_CHAVE = 20;

interface CorpoVarianteEntrada {
  id?: unknown;
  rotulo?: unknown;
  contextoNicho?: unknown;
  contextoConversao?: unknown;
}

interface CorpoSimulacaoAB {
  flowId?: unknown;
  variantes?: unknown;
  /** Classificador explícito de conversão (ver `criarClassificadorPorPalavrasChave`) — nunca um "juiz de IA" escondido dentro desta rota. */
  palavrasChaveConversao?: unknown;
}

function campoTextoOpcional(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null) return null;
  return exigirTexto(valor, campo, { max: 2000 });
}

function validarVariantes(valor: unknown): VarianteDePrompt[] {
  if (!Array.isArray(valor) || valor.length < MIN_VARIANTES || valor.length > MAX_VARIANTES) {
    throw new ErroApi(
      400,
      `"variantes" deve ser uma lista com entre ${MIN_VARIANTES} e ${MAX_VARIANTES} itens.`,
      "campo_invalido"
    );
  }

  const idsVistos = new Set<string>();
  return valor.map((item, indice) => {
    const entrada = (item ?? {}) as CorpoVarianteEntrada;
    const id = exigirIdentificador(entrada.id, `variantes[${indice}].id`);
    if (idsVistos.has(id)) {
      throw new ErroApi(400, `"variantes[${indice}].id" duplicado: ${id}.`, "campo_invalido");
    }
    idsVistos.add(id);

    return {
      id,
      rotulo: exigirTexto(entrada.rotulo, `variantes[${indice}].rotulo`, { max: 120 }),
      contextoNicho: campoTextoOpcional(entrada.contextoNicho, `variantes[${indice}].contextoNicho`),
      contextoConversao: campoTextoOpcional(entrada.contextoConversao, `variantes[${indice}].contextoConversao`),
    };
  });
}

function validarPalavrasChave(valor: unknown): string[] {
  if (!Array.isArray(valor) || valor.length === 0 || valor.length > MAX_PALAVRAS_CHAVE) {
    throw new ErroApi(
      400,
      `"palavrasChaveConversao" deve ser uma lista com 1 a ${MAX_PALAVRAS_CHAVE} palavras.`,
      "campo_invalido"
    );
  }
  return valor.map((item, indice) => exigirTexto(item, `palavrasChaveConversao[${indice}]`, { max: 64 }));
}

export const POST = comGuarda(
  async ({ requisicao, usuario }) => {
    const diagAdmin = diagnosticoAdmin();
    if (!diagAdmin.pronto) {
      throw new ErroApi(
        503,
        `Simulador indisponível — Admin SDK não configurado: ${diagAdmin.motivo}.`,
        "orquestrador_admin_indisponivel"
      );
    }

    const diagOrq = diagnosticoOrquestrador();
    if (!diagOrq.pronto) {
      throw new ErroApi(
        503,
        `Simulador indisponível. Variáveis ausentes: ${diagOrq.faltando.join(", ")}.`,
        "orquestrador_nao_configurado"
      );
    }

    const corpo = await corpoJson<CorpoSimulacaoAB>(requisicao, MAX_PAYLOAD);
    const flowId = exigirIdentificador(corpo.flowId, "flowId");
    const variantes = validarVariantes(corpo.variantes);
    const palavrasChaveConversao = validarPalavrasChave(corpo.palavrasChaveConversao);

    const flow = await lerFlowComPosseAdmin(flowId, usuario.uid);

    const classificar = criarClassificadorPorPalavrasChave(palavrasChaveConversao);
    const resultado = await executarSimulacaoABAdmin(flow.workspaceId, flow, variantes, classificar);

    return respostaJson({
      flowId: flow.id,
      totalEpisodiosReplay: resultado.porVariante[0]?.totalEpisodios ?? 0,
      porVariante: resultado.porVariante,
      veredito: resultado.veredito,
    });
  },
  { escopoLimite: "flows-simulate-ab", maxBytesCorpo: MAX_PAYLOAD, limite: LIMITE_SIMULACAO }
);
