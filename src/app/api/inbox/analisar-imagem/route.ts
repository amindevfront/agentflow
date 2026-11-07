// POST /api/inbox/analisar-imagem — Motor de Visão Computacional (imagens e documentos PDF).
//
// Autenticada (ID token do Firebase, via `comGuarda`) — diferente dos
// webhooks de canal externo, esta rota é chamada pelo PRÓPRIO operador
// logado (harness de "simular imagem/documento do cliente" na Neural Inbox,
// mesmo espírito do `PayloadSimulator` dos fluxos: nunca finge ser o canal
// real, só exercita o pipeline real de ponta a ponta).
//
// Graceful degradation: sem `ANTHROPIC_API_KEY`, responde 503 com mensagem
// acionável — nunca deixa a exceção do provedor subir como 500 genérico.

import { analisarImagemAdmin, type MediaTypeAnalise } from "@/lib/server/visionAdmin";
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

/**
 * ~16 MB em base64 (≈12 MB binários) — generoso para uma foto de comprovante/
 * planta ou um PDF de contrato/balanço B2B (Módulo Vertical 3), sob o teto de
 * corpo de função serverless.
 */
const MAX_BYTES_CORPO = 16 * 1024 * 1024;
const MAX_BASE64 = 21_000_000;

const MEDIA_TYPES_SUPORTADOS = new Set<MediaTypeAnalise>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

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

    if (!MEDIA_TYPES_SUPORTADOS.has(mediaTypeTexto as MediaTypeAnalise)) {
      throw new ErroApi(
        400,
        `"mediaType" inválido: ${mediaTypeTexto}. Suportados: ${[...MEDIA_TYPES_SUPORTADOS].join(", ")}.`,
        "campo_invalido"
      );
    }

    try {
      const descricao = await analisarImagemAdmin({ base64, mediaType: mediaTypeTexto as MediaTypeAnalise });
      return respostaJson({ descricao });
    } catch (erro) {
      console.error("[inbox/analisar-imagem] falha ao analisar imagem/documento:", erro);
      throw new ErroApi(
        502,
        erro instanceof Error ? erro.message : "Não foi possível analisar a imagem/documento.",
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
