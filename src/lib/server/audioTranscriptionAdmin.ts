// Motor de Transcrição de Áudio — SERVER-ONLY.
//
// Usa a API de transcrição da OpenAI (Whisper) via `fetch` cru — sem SDK
// novo como dependência, mesmo espírito de `@/lib/inbox/channelAdapters`
// (não adicionar peso ao projeto por uma integração que pode nunca ser
// exercitada neste ambiente).
//
// Diferente do motor de orquestração (texto) e do motor de Visão (ambos já
// cobertos pela chave Anthropic existente), transcrição de áudio NÃO é uma
// capacidade do Claude nesta integração — por isso depende de uma
// credencial própria (`OPENAI_API_KEY`), ausente por padrão neste ambiente.
// Diagnóstico explícito via `diagnosticoTranscricao()` (`./env`), mesma
// filosofia de `diagnosticoCripto()`/`diagnosticoOrquestrador()`: a rota que
// chama este módulo responde 503 com mensagem acionável, nunca finge
// sucesso.
//
// A lógica de "o que fazer com a resposta" (rejeitar transcrição vazia) vive
// em `@/lib/inbox/multimodalPipeline` — este arquivo só fornece o executor
// real.

import { transcreverAudio, type AudioEntrada, type ExecutorTranscricao } from "@/lib/inbox/multimodalPipeline";
import { chaveTranscricao, diagnosticoTranscricao } from "./env";

const ENDPOINT_TRANSCRICAO = "https://api.openai.com/v1/audio/transcriptions";
const MODELO_TRANSCRICAO_PADRAO = "whisper-1";

/** Extensão de arquivo a partir do MIME type — a API decide o decoder pela extensão do nome enviado. */
const EXTENSAO_POR_MIME: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/webm": "webm",
};

/** Executor real — chama o Whisper (OpenAI) de verdade. Injetado em `transcreverAudio` (núcleo puro). */
export const executorTranscricaoOpenAI: ExecutorTranscricao = async (audio: AudioEntrada): Promise<string> => {
  const bytes = Buffer.from(audio.base64, "base64");
  const extensao = EXTENSAO_POR_MIME[audio.mimeType] ?? "ogg";
  const arquivo = new Blob([bytes], { type: audio.mimeType });

  const formData = new FormData();
  formData.append("file", arquivo, `audio.${extensao}`);
  formData.append("model", process.env.AGENTFLOW_TRANSCRICAO_MODEL?.trim() || MODELO_TRANSCRICAO_PADRAO);

  const resposta = await fetch(ENDPOINT_TRANSCRICAO, {
    method: "POST",
    headers: { authorization: `Bearer ${chaveTranscricao()}` },
    body: formData,
  });

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => "");
    throw new Error(`Falha ao transcrever o áudio (HTTP ${resposta.status}): ${corpo.slice(0, 200)}`);
  }

  const dados = (await resposta.json()) as { text?: string };
  return dados.text ?? "";
};

/**
 * Transcreve um áudio real via Whisper (OpenAI).
 *
 * Lança `Error` quando `OPENAI_API_KEY` não está configurada — quem chama
 * (a rota de API) deve checar `diagnosticoTranscricao()` antes, para
 * responder 503 em vez de deixar a exceção subir como 500.
 */
export async function transcreverAudioAdmin(audio: AudioEntrada): Promise<string> {
  const diagnostico = diagnosticoTranscricao();
  if (!diagnostico.pronto) {
    throw new Error(`Motor de Transcrição de Áudio indisponível. Variáveis ausentes: ${diagnostico.faltando.join(", ")}.`);
  }
  return transcreverAudio(audio, executorTranscricaoOpenAI);
}
