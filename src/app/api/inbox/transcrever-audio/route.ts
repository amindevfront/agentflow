// POST /api/inbox/transcrever-audio — Motor de Transcrição de Áudio.
//
// Autenticada (ID token do Firebase, via `comGuarda`) — chamada pelo
// harness de "simular áudio do cliente" na Neural Inbox, mesmo espírito do
// `PayloadSimulator` dos fluxos: nunca finge ser o canal real, só exercita
// o pipeline real de ponta a ponta.
//
// Graceful degradation: sem `OPENAI_API_KEY`, responde 503 com mensagem
// acionável — nunca deixa a exceção do provedor subir como 500 genérico.
// Transcrição de áudio depende de um provedor diferente do motor de
// orquestração/visão (Claude não cobre áudio nesta integração).

import { transcreverAudioAdmin } from "@/lib/server/audioTranscriptionAdmin";
import { diagnosticoTranscricao } from "@/lib/server/env";
import {
  ErroApi,
  comGuarda,
  corpoJson,
  exigirTexto,
  respostaJson,
} from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ~4 MB de áudio em base64 — sob o teto de corpo de função serverless (áudios mais longos exigiriam upload em partes, fora do escopo desta versão). */
const MAX_BYTES_CORPO = 4 * 1024 * 1024;
const MAX_BASE64 = 5_500_000;

interface CorpoTranscreverAudio {
  base64?: unknown;
  mimeType?: unknown;
}

export const POST = comGuarda(
  async ({ requisicao }) => {
    const diagnostico = diagnosticoTranscricao();
    if (!diagnostico.pronto) {
      throw new ErroApi(
        503,
        `Motor de Transcrição de Áudio indisponível. Variáveis ausentes: ${diagnostico.faltando.join(", ")}.`,
        "transcricao_nao_configurada"
      );
    }

    const corpo = await corpoJson<CorpoTranscreverAudio>(requisicao, MAX_BYTES_CORPO);
    const base64 = exigirTexto(corpo.base64, "base64", { max: MAX_BASE64, min: 10 });
    const mimeType = exigirTexto(corpo.mimeType, "mimeType", { max: 32 });

    try {
      const texto = await transcreverAudioAdmin({ base64, mimeType });
      return respostaJson({ texto });
    } catch (erro) {
      console.error("[inbox/transcrever-audio] falha ao transcrever áudio:", erro);
      throw new ErroApi(
        502,
        erro instanceof Error ? erro.message : "Não foi possível transcrever o áudio.",
        "falha_transcricao"
      );
    }
  },
  {
    escopoLimite: "inbox-transcrever-audio",
    maxBytesCorpo: MAX_BYTES_CORPO,
    limite: { capacidade: 10, taxaPorSegundo: 0.1 },
  }
);
