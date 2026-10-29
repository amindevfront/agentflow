import { describe, expect, it } from "vitest";
import {
  analisarImagem,
  transcreverAudio,
  type ExecutorTranscricao,
  type ExecutorVisao,
} from "@/lib/inbox/multimodalPipeline";

const IMAGEM = { base64: "ZmFrZS1pbWFnZQ==", mediaType: "image/jpeg" };
const AUDIO = { base64: "ZmFrZS1hdWRpbw==", mimeType: "audio/ogg" };

describe("analisarImagem", () => {
  it("envolve a descrição do executor no formato padrão [Imagem Analisada: ...]", async () => {
    const executor: ExecutorVisao = async () => "Comprovante de PIX no valor de R$ 350,00";
    const resultado = await analisarImagem(IMAGEM, executor);
    expect(resultado).toBe("[Imagem Analisada: Comprovante de PIX no valor de R$ 350,00]");
  });

  it("não duplica o prefixo quando o executor já devolve o envelope completo", async () => {
    const executor: ExecutorVisao = async () => "[Imagem Analisada: Planta de 3 dormitórios]";
    const resultado = await analisarImagem(IMAGEM, executor);
    expect(resultado).toBe("[Imagem Analisada: Planta de 3 dormitórios]");
  });

  it("repassa base64 e mediaType exatamente ao executor", async () => {
    let recebido: typeof IMAGEM | null = null;
    const executor: ExecutorVisao = async (imagem) => {
      recebido = imagem;
      return "ok";
    };
    await analisarImagem(IMAGEM, executor);
    expect(recebido).toEqual(IMAGEM);
  });

  it("lança quando o executor devolve uma string vazia ou só espaços", async () => {
    await expect(analisarImagem(IMAGEM, async () => "")).rejects.toThrow(/não retornou/);
    await expect(analisarImagem(IMAGEM, async () => "   ")).rejects.toThrow(/não retornou/);
  });

  it("propaga uma falha do executor (ex.: provedor indisponível) sem mascarar o erro", async () => {
    const executor: ExecutorVisao = async () => {
      throw new Error("ANTHROPIC_API_KEY não configurada.");
    };
    await expect(analisarImagem(IMAGEM, executor)).rejects.toThrow("ANTHROPIC_API_KEY não configurada.");
  });
});

describe("transcreverAudio", () => {
  it("devolve o texto transcrito sem nenhum envelope (exibido como se o cliente tivesse digitado)", async () => {
    const executor: ExecutorTranscricao = async () => "Já tentei três vezes e ninguém resolveu, isso é um absurdo!";
    const resultado = await transcreverAudio(AUDIO, executor);
    expect(resultado).toBe("Já tentei três vezes e ninguém resolveu, isso é um absurdo!");
  });

  it("apara espaços nas bordas do texto transcrito", async () => {
    const executor: ExecutorTranscricao = async () => "  Quero cancelar o pedido  ";
    const resultado = await transcreverAudio(AUDIO, executor);
    expect(resultado).toBe("Quero cancelar o pedido");
  });

  it("lança quando a transcrição vem vazia", async () => {
    await expect(transcreverAudio(AUDIO, async () => "")).rejects.toThrow(/não retornou texto/);
  });

  it("propaga uma falha do executor (ex.: OPENAI_API_KEY ausente) sem mascarar o erro", async () => {
    const executor: ExecutorTranscricao = async () => {
      throw new Error("Transcrição de áudio não configurada. Variáveis ausentes: OPENAI_API_KEY.");
    };
    await expect(transcreverAudio(AUDIO, executor)).rejects.toThrow("OPENAI_API_KEY");
  });
});
