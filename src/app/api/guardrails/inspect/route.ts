// POST /api/guardrails/inspect — executa o motor de guardrails no servidor.
//
// Esta rota é a FONTE DE VERDADE do veredito. O mesmo motor roda no browser
// para dar resposta imediata no inspetor da UI, mas um veredito produzido no
// cliente nunca pode ser confiado: ele é visível e alterável por quem o executa.
//
// A rota é deliberadamente stateless e não persiste nada. O cofre de PII é
// criado, usado e destruído dentro da requisição — nenhum valor em claro
// sobrevive à resposta, e a resposta só contém texto mascarado.

import type { GuardrailPolicy } from "@/types";
import {
  POLITICAS_PREDEFINIDAS,
  inspecionarEntrada,
  inspecionarSaida,
  novoTraceId,
} from "@/lib/guardrails";
import { ErroApi, comGuarda, corpoJson, respostaJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PAYLOAD = 200_000;
const MAX_AMOSTRAS = 7;
const MAX_CONTEXTOS = 20;

interface CorpoInspecao {
  payload?: unknown;
  amostras?: unknown;
  contextos?: unknown;
  trace?: unknown;
  politica?: unknown;
  sobrescritas?: unknown;
  tokensUsados?: unknown;
}

function listaDeTextos(bruto: unknown, campo: string, maximo: number): string[] {
  if (bruto === undefined || bruto === null) return [];
  if (!Array.isArray(bruto)) {
    throw new ErroApi(400, `Campo "${campo}" deve ser uma lista de textos.`, "campo_invalido");
  }
  if (bruto.length > maximo) {
    throw new ErroApi(400, `Campo "${campo}" aceita no máximo ${maximo} itens.`, "campo_invalido");
  }
  return bruto.map((item, indice) => {
    if (typeof item !== "string") {
      throw new ErroApi(400, `Item ${indice} de "${campo}" não é texto.`, "campo_invalido");
    }
    return item.slice(0, MAX_PAYLOAD);
  });
}

/**
 * Resolve a política solicitada.
 *
 * Sobrescritas vindas do cliente são aceitas, mas `resolverPolitica` limita
 * todos os valores numéricos à faixa segura — então um cliente não consegue
 * desativar o motor pedindo, por exemplo, `minConsistencia: -1`.
 */
function politicaSolicitada(bruto: unknown): GuardrailPolicy | string | undefined {
  if (bruto === undefined || bruto === null) return undefined;
  if (typeof bruto === "string") {
    if (!(bruto in POLITICAS_PREDEFINIDAS)) {
      throw new ErroApi(
        400,
        `Política desconhecida: ${bruto}. Disponíveis: ${Object.keys(POLITICAS_PREDEFINIDAS).join(", ")}.`,
        "campo_invalido"
      );
    }
    return bruto;
  }
  if (typeof bruto === "object") return bruto as GuardrailPolicy;
  throw new ErroApi(400, 'Campo "politica" deve ser um id ou um objeto.', "campo_invalido");
}

export const POST = comGuarda(
  async ({ requisicao }) => {
    const corpo = await corpoJson<CorpoInspecao>(requisicao, 1024 * 1024);

    const politica = politicaSolicitada(corpo.politica);
    const sobrescritas =
      corpo.sobrescritas && typeof corpo.sobrescritas === "object" && !Array.isArray(corpo.sobrescritas)
        ? (corpo.sobrescritas as Partial<GuardrailPolicy>)
        : {};

    const payload = typeof corpo.payload === "string" ? corpo.payload.slice(0, MAX_PAYLOAD) : "";
    const amostras = listaDeTextos(corpo.amostras, "amostras", MAX_AMOSTRAS);
    const contextos = listaDeTextos(corpo.contextos, "contextos", MAX_CONTEXTOS);
    const trace = listaDeTextos(corpo.trace, "trace", 200);

    if (payload.length === 0 && amostras.length === 0) {
      throw new ErroApi(
        400,
        'Informe "payload" (inspeção de entrada) e/ou "amostras" (inspeção de saída).',
        "campo_obrigatorio"
      );
    }

    const tokensUsados = Number.isFinite(Number(corpo.tokensUsados))
      ? Number(corpo.tokensUsados)
      : undefined;

    const traceId = novoTraceId();
    const { inspecao: entrada, vault } = inspecionarEntrada({ payload, politica, sobrescritas, traceId });

    try {
      const saida =
        amostras.length > 0
          ? inspecionarSaida({ amostras, contextos, trace, vault, politica, sobrescritas, traceId, tokensUsados })
          : null;

      return respostaJson({
        traceId,
        entrada,
        // `saidaFinal` é a versão re-hidratada e por isso NÃO é devolvida ao
        // cliente: só o resultado mascarado atravessa a fronteira da API.
        saida: saida ? { ...saida, saidaFinal: saida.saidaMascarada } : null,
      });
    } finally {
      vault.clear();
    }
  },
  { escopoLimite: "guardrails-inspect", maxBytesCorpo: 1024 * 1024 }
);
