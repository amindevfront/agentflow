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
import { PiiVault, maskText } from "@/lib/guardrails";
import { chaveAnthropic, diagnosticoOrquestrador, modeloOrquestrador } from "./env";

/** Descrição curta é suficiente — isto alimenta uma mensagem de chat, não um relatório. */
const MAX_TOKENS_SAIDA = 300;

export type MediaTypeImagem = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

const PROMPT_ANALISE = [
  "Você é um assistente que descreve, em UMA frase objetiva (até 160 caracteres), o conteúdo de uma",
  "imagem enviada por um cliente em um atendimento comercial (WhatsApp ou Web Widget).",
  "Se for um comprovante de pagamento (PIX, transferência, boleto), inclua o valor e o método quando",
  "estiverem legíveis. Se for planta/documento imobiliário, inclua metragem e número de cômodos quando",
  "legíveis. Se for documento de exame médico, descreva apenas o tipo de exame e o achado clínico",
  "relevante (ex.: \"exame de sangue com colesterol alterado\") — NUNCA transcreva nome completo, CPF,",
  "número de documento ou de prontuário, mesmo que estejam legíveis na imagem. Se for foto de",
  "agendamento ou procedimento (não de rosto/corpo do paciente), descreva objetivamente o que é visível.",
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
 * formato `"[Imagem Analisada: ...]"`, JÁ MASCARADA pelo Shield-Layer
 * (`@/lib/guardrails`).
 *
 * Um comprovante de pagamento ou documento imobiliário fotografado é
 * exatamente o tipo de anexo que carrega PII/dado de crédito (CPF, valor,
 * conta bancária) — e, diferente do texto digitado pelo cliente, aqui a
 * rota HTTP (`/api/inbox/analisar-imagem`) devolve a descrição diretamente
 * à resposta, antes de qualquer decisão do chamador sobre persistir. Mascarar
 * só depois (no pipeline de ingestão da Neural Inbox) confiaria no chamador
 * para nunca logar/exibir o resultado bruto entretanto — o mesmo
 * anti-padrão já corrigido em `/api/audit/seal` (ver `auditDetalhes.ts`).
 * Mascarar aqui, na origem, garante a mesma regra independentemente do que
 * o chamador fizer com a resposta.
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
  const descricao = await analisarImagem(imagem, executorVisaoAnthropic);

  const vaultDescartavel = new PiiVault();
  try {
    return maskText(descricao, vaultDescartavel).texto;
  } finally {
    vaultDescartavel.clear();
  }
}
