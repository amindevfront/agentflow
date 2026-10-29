// Módulo Multimodal de Elite — núcleo puro, testável sem rede.
//
// Mesmo desenho de `@/lib/server/orchestrator` (núcleo puro + executor
// injetado): este arquivo não sabe nada sobre Anthropic, OpenAI/Whisper ou
// Firestore — recebe um executor (`ExecutorVisao`/`ExecutorTranscricao`) e
// valida/formata o resultado. Isso é o que permite testar a lógica de
// "o que fazer com a resposta do provedor" sem credenciais reais e sem rede
// — exatamente como `tests/orchestrator.test.ts` testa `executarFluxo` com
// um executor falso.
//
// A fiação REAL (que de fato chama um provedor) vive em:
//   - `@/lib/server/visionAdmin`              (Claude, visão)
//   - `@/lib/server/audioTranscriptionAdmin`  (Whisper/OpenAI, transcrição)
//
// O resultado de ambos entra no pipeline de ingestão da Neural Inbox
// (`registrarMensagemCliente`, em `@/lib/inbox/firestore`) EXATAMENTE como
// uma mensagem de texto comum — Shield-Layer, Radar de Sentimento e Circuit
// Breaker não precisam saber que o texto se originou de um áudio ou de uma
// imagem. É assim que "a intenção e o nível de frustração do áudio
// transcrito alimentam o SLA Rescue & Circuit Breaker": o texto resultante
// passa pelo MESMO `calcularFrustration` de qualquer canal — não há análise
// acústica de tom de voz aqui (isso exigiria um modelo de emoção em áudio
// dedicado, fora do escopo desta versão), apenas análise textual do
// conteúdo transcrito, honesta sobre o que de fato mede.

const PREFIXO_IMAGEM = "[Imagem Analisada:";

export interface ImagemEntrada {
  base64: string;
  mediaType: string;
}

export interface AudioEntrada {
  base64: string;
  mimeType: string;
}

export type ExecutorVisao = (imagem: ImagemEntrada) => Promise<string>;
export type ExecutorTranscricao = (audio: AudioEntrada) => Promise<string>;

/**
 * Analisa uma imagem via o executor informado e formata o resultado no
 * envelope padrão `"[Imagem Analisada: ...]"` — a convenção que a Neural
 * Inbox e o Radar de Sentimento reconhecem como descrição enriquecida de
 * conteúdo visual, não texto digitado pelo cliente.
 *
 * Lança quando o executor devolve vazio: uma análise sem conteúdo não deve
 * virar uma mensagem vazia na conversa.
 */
export async function analisarImagem(imagem: ImagemEntrada, executor: ExecutorVisao): Promise<string> {
  const bruta = await executor(imagem);
  const descricao = typeof bruta === "string" ? bruta.trim() : "";
  if (descricao.length === 0) {
    throw new Error("A análise de imagem não retornou uma descrição.");
  }
  return descricao.startsWith(PREFIXO_IMAGEM) ? descricao : `${PREFIXO_IMAGEM} ${descricao}]`;
}

/**
 * Transcreve um áudio via o executor informado.
 *
 * Diferente de `analisarImagem`, não aplica nenhum envelope — a transcrição
 * é exibida como se o cliente tivesse digitado aquele texto (é isso que
 * permite ao operador ler a transcrição na bolha da mensagem sem precisar
 * ouvir o áudio).
 */
export async function transcreverAudio(audio: AudioEntrada, executor: ExecutorTranscricao): Promise<string> {
  const bruta = await executor(audio);
  const texto = typeof bruta === "string" ? bruta.trim() : "";
  if (texto.length === 0) {
    throw new Error("A transcrição não retornou texto reconhecível.");
  }
  return texto;
}
