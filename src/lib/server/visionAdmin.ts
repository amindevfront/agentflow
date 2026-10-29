// Motor de Visão Computacional — análise REAL de imagens via Claude
// (Anthropic Messages API, bloco de imagem). SERVER-ONLY.
//
// Mesma credencial e modelo já usados pelo motor de orquestração de texto
// (`chaveAnthropic`/`modeloOrquestrador`, em `./env`) — nenhuma chave nova.
// Mesmo padrão de diagnóstico de `diagnosticoOrquestrador()`: a rota que
// chama este módulo responde 503 com mensagem acionável quando
// `ANTHROPIC_API_KEY` não está configurada, em vez de um 500 genérico no
// meio da chamada ao provedor.
//
// A lógica de "o que fazer com a resposta" (formatar o envelope, rejeitar
// resposta vazia) vive em `@/lib/inbox/multimodalPipeline` — este arquivo só
// fornece o executor real.

import Anthropic from "@anthropic-ai/sdk";
import { analisarImagem, type ExecutorVisao, type ImagemEntrada } from "@/lib/inbox/multimodalPipeline";
import { chaveAnthropic, diagnosticoOrquestrador, modeloOrquestrador } from "./env";

/** Descrição curta é suficiente — isto alimenta uma mensagem de chat, não um relatório. */
const MAX_TOKENS_SAIDA = 300;

export type MediaTypeImagem = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

const PROMPT_ANALISE = [
  "Você é um assistente que descreve, em UMA frase objetiva (até 160 caracteres), o conteúdo de uma",
  "imagem enviada por um cliente em um atendimento comercial (WhatsApp ou Web Widget).",
  "Se for um comprovante de pagamento (PIX, transferência, boleto), inclua o valor e o método quando",
  "estiverem legíveis. Se for planta/documento imobiliário, inclua metragem e número de cômodos quando",
  "legíveis. Se for foto de agendamento, exame ou procedimento, descreva objetivamente o que é visível.",
  "NUNCA invente um dado que não esteja legível na imagem — se não conseguir ler, diga isso explicitamente.",
  "Responda APENAS com a descrição em português, sem introdução nem comentário adicional.",
].join(" ");

let clienteCache: Anthropic | null = null;
function clienteAnthropic(): Anthropic {
  if (clienteCache) return clienteCache;
  clienteCache = new Anthropic({ apiKey: chaveAnthropic() });
  return clienteCache;
}

/** Executor real — chama o Claude de verdade. Injetado em `analisarImagem` (núcleo puro). */
export const executorVisaoAnthropic: ExecutorVisao = async (imagem: ImagemEntrada): Promise<string> => {
  const resposta = await clienteAnthropic().messages.create({
    model: modeloOrquestrador(),
    max_tokens: MAX_TOKENS_SAIDA,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: imagem.mediaType as MediaTypeImagem, data: imagem.base64 },
          },
          { type: "text", text: PROMPT_ANALISE },
        ],
      },
    ],
  });

  const bloco = resposta.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  return bloco?.text ?? "";
};

/**
 * Analisa uma imagem com o Claude real e devolve a descrição enriquecida no
 * formato `"[Imagem Analisada: ...]"`.
 *
 * Lança `Error` quando `ANTHROPIC_API_KEY` não está configurada — quem
 * chama (a rota de API) deve checar `diagnosticoOrquestrador()` antes,
 * exatamente como `/api/flows/execute` já faz, para responder 503 em vez de
 * deixar a exceção subir como 500.
 */
export async function analisarImagemAdmin(imagem: { base64: string; mediaType: MediaTypeImagem }): Promise<string> {
  const diagnostico = diagnosticoOrquestrador();
  if (!diagnostico.pronto) {
    throw new Error(`Motor de Visão indisponível. Variáveis ausentes: ${diagnostico.faltando.join(", ")}.`);
  }
  return analisarImagem(imagem, executorVisaoAnthropic);
}
