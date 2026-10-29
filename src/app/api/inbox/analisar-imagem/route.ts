// POST /api/inbox/analisar-imagem — Motor de Visão Computacional.
//
// Autenticada (ID token do Firebase, via `comGuarda`) — diferente dos
// webhooks de canal externo, esta rota é chamada pelo PRÓPRIO operador
// logado (harness de "simular imagem do cliente" na Neural Inbox, mesmo
// espírito do `PayloadSimulator` dos fluxos: nunca finge ser o canal real,
// só exercita o pipeline real de ponta a ponta).
//
// Graceful degradation: sem `ANTHROPIC_API_KEY`, responde 503 com mensagem
// acionável — nunca deixa a exceção do provedor subir como 500 genérico.

import { analisarImagemAdmin, type MediaTypeImagem } from "@/lib/server/visionAdmin";
import { diagnosticoOrquestrador } from "@/lib/server/env";
import {
  ErroApi,
  comGuarda,
  corpoJson,
  exigirTexto,
  respostaJson,
} from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ~6 MB de imagem em base64 (≈4,5 MB binários) — generoso para uma foto de comprovante/planta, sob o teto de corpo de função serverless. */
const MAX_BYTES_CORPO = 6 * 1024 * 1024;
const MAX_BASE64 = 8_000_000;

const MEDIA_TYPES_SUPORTADOS = new Set<MediaTypeImagem>(["image/jpeg", "image/png", "image/webp", "image/gif"]);

interface CorpoAnalisarImagem {
  base64?: unknown;
  mediaType?: unknown;
}

export const POST = comGuarda(
  async ({ requisicao }) => {
    const diagnostico = diagnosticoOrquestrador();
    if (!diagnostico.pronto) {
      throw new ErroApi(
        503,
        `Motor de Visão indisponível. Variáveis ausentes: ${diagnostico.faltando.join(", ")}.`,
        "visao_nao_configurada"
      );
    }

    const corpo = await corpoJson<CorpoAnalisarImagem>(requisicao, MAX_BYTES_CORPO);
    const base64 = exigirTexto(corpo.base64, "base64", { max: MAX_BASE64, min: 10 });
    const mediaTypeTexto = exigirTexto(corpo.mediaType, "mediaType", { max: 32 });

    if (!MEDIA_TYPES_SUPORTADOS.has(mediaTypeTexto as MediaTypeImagem)) {
      throw new ErroApi(
        400,
        `"mediaType" inválido: ${mediaTypeTexto}. Suportados: ${[...MEDIA_TYPES_SUPORTADOS].join(", ")}.`,
        "campo_invalido"
      );
    }

    try {
      const descricao = await analisarImagemAdmin({ base64, mediaType: mediaTypeTexto as MediaTypeImagem });
      return respostaJson({ descricao });
    } catch (erro) {
      console.error("[inbox/analisar-imagem] falha ao analisar imagem:", erro);
      throw new ErroApi(
        502,
        erro instanceof Error ? erro.message : "Não foi possível analisar a imagem.",
        "falha_analise"
      );
    }
  },
  {
    escopoLimite: "inbox-analisar-imagem",
    maxBytesCorpo: MAX_BYTES_CORPO,
    limite: { capacidade: 10, taxaPorSegundo: 0.1 },
  }
);
