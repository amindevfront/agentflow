// Módulo Multimodal de Elite — lado cliente.
//
// Chama os motores reais (Visão/Transcrição, server-only) pelas respectivas
// rotas autenticadas e injeta o resultado no MESMO pipeline de ingestão de
// qualquer mensagem de texto (`registrarMensagemCliente`) — Shield-Layer,
// Radar de Sentimento e Circuit Breaker tratam o texto resultante como
// tratariam qualquer mensagem digitada, sem lógica duplicada.

import type { Canal } from "@/types";
import { auth } from "@/lib/firebase";
import { registrarMensagemCliente, type RegistrarMensagemClienteResultado } from "./firestore";
import type { MediaTypeImagem } from "@/lib/server/visionAdmin";

async function idToken(): Promise<string> {
  const usuario = auth?.currentUser;
  if (!usuario) {
    throw new Error("Nenhuma sessão autenticada — não é possível processar mídia da Neural Inbox.");
  }
  return usuario.getIdToken();
}

interface RespostaErroApi {
  erro?: { codigo: string; mensagem: string };
}

export interface ProcessarImagemClienteInput {
  conversationId: string;
  canal: Canal;
  workspaceId?: string;
  base64: string;
  mediaType: MediaTypeImagem;
}

/**
 * Envia uma imagem ao Motor de Visão real e registra a descrição retornada
 * como uma mensagem do cliente — mesmo caminho de qualquer texto.
 */
export async function processarImagemCliente(
  entrada: ProcessarImagemClienteInput
): Promise<RegistrarMensagemClienteResultado> {
  const resposta = await fetch("/api/inbox/analisar-imagem", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await idToken()}` },
    body: JSON.stringify({ base64: entrada.base64, mediaType: entrada.mediaType }),
  });

  const dados = (await resposta.json().catch(() => ({}))) as RespostaErroApi & { descricao?: string };
  if (!resposta.ok || !dados.descricao) {
    throw new Error(dados.erro?.mensagem ?? `Falha ao analisar a imagem (HTTP ${resposta.status}).`);
  }

  return registrarMensagemCliente({
    conversationId: entrada.conversationId,
    texto: dados.descricao,
    canal: entrada.canal,
    workspaceId: entrada.workspaceId,
    tipoConteudo: "imagem-analisada",
  });
}

export interface ProcessarAudioClienteInput {
  conversationId: string;
  canal: Canal;
  workspaceId?: string;
  base64: string;
  mimeType: string;
}

/**
 * Envia um áudio ao Motor de Transcrição real e registra o texto transcrito
 * como uma mensagem do cliente — o Radar de Sentimento e o Circuit Breaker
 * avaliam esse texto exatamente como avaliariam qualquer mensagem digitada.
 */
export async function processarAudioCliente(
  entrada: ProcessarAudioClienteInput
): Promise<RegistrarMensagemClienteResultado> {
  const resposta = await fetch("/api/inbox/transcrever-audio", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await idToken()}` },
    body: JSON.stringify({ base64: entrada.base64, mimeType: entrada.mimeType }),
  });

  const dados = (await resposta.json().catch(() => ({}))) as RespostaErroApi & { texto?: string };
  if (!resposta.ok || !dados.texto) {
    throw new Error(dados.erro?.mensagem ?? `Falha ao transcrever o áudio (HTTP ${resposta.status}).`);
  }

  return registrarMensagemCliente({
    conversationId: entrada.conversationId,
    texto: dados.texto,
    canal: entrada.canal,
    workspaceId: entrada.workspaceId,
    tipoConteudo: "audio-transcrito",
  });
}
