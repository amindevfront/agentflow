// Shield-Layer de PII para a Neural Inbox — mascaramento instantâneo +
// cofre efêmero de texto original selado.
//
// Isomórfico por desenho, mas com uma fronteira clara de privilégio:
//
//   interceptarMensagem()       → PURO, roda em qualquer lugar (cliente ou
//                                  servidor). Reaproveita `maskPayload`/
//                                  `PiiVault` já construídos em `./pii` — este
//                                  arquivo não duplica detecção de PII, ele
//                                  aplica a detecção existente ao transporte
//                                  de chat especificamente.
//   selarMensagemOriginal()     → chama `/api/inbox/seal-message`, que é quem
//                                  de fato cifra (AES-256-GCM) — a chave-mestra
//                                  nunca existe fora do servidor.
//
// Modelo de retenção (diferente do padrão de guardrails de LLM): aqui o texto
// MASCARADO é o registro permanente e visível; o original só existe, cifrado,
// em um cofre separado e bloqueado para leitura de cliente (mesma forma de
// `credentials`/`credentialSecrets`) — reservado a uma extração formal de
// compliance (LGPD art. 18, atendimento a titular de dados), nunca para
// "desfazer" a máscara na tela do atendente. Isso é deliberadamente MAIS
// restritivo que o fluxo de guardrails de LLM (que re-hidrata para o próprio
// fluxo) — na Neural Inbox não há um processo automatizado que precise ler o
// dado em claro de volta, então ele fica selado e inerte até ser formalmente
// solicitado.

import type { PiiKind, SealedSecret } from "@/types";
import { PiiVault, maskPayload } from "./pii";

export interface InterceptacaoMensagem {
  /** Texto seguro para exibição e persistência em `mensagens/{id}.texto`. */
  textoMascarado: string;
  piiDetectada: PiiKind[];
  temPii: boolean;
}

/**
 * Mascara uma mensagem de chat antes de qualquer persistência.
 *
 * O cofre de tradução (`PiiVault`) é descartado imediatamente após o uso —
 * ele nunca sai desta função, e esta função nunca devolve o texto original.
 */
export function interceptarMensagem(textoOriginal: string): InterceptacaoMensagem {
  const vaultDescartavel = new PiiVault();
  try {
    const resultado = maskPayload(textoOriginal ?? "", vaultDescartavel);
    return {
      textoMascarado: resultado.texto,
      piiDetectada: resultado.kindsMascarados,
      temPii: resultado.kindsMascarados.length > 0,
    };
  } finally {
    vaultDescartavel.clear();
  }
}

interface RespostaSelarMensagem {
  envelope?: SealedSecret;
  erro?: { codigo: string; mensagem: string };
}

/**
 * Sela o texto ORIGINAL de uma mensagem no cofre efêmero do servidor.
 *
 * Só precisa ser chamada quando `interceptarMensagem` detectou PII — uma
 * mensagem sem dado sensível não tem nada que precise ficar sob cofre; o
 * texto mascarado já É o texto original, verbatim.
 */
export async function selarMensagemOriginal(entrada: {
  texto: string;
  conversationId: string;
  messageId: string;
  workspaceId: string;
  idToken: string;
}): Promise<SealedSecret> {
  const resposta = await fetch("/api/inbox/seal-message", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${entrada.idToken}`,
    },
    body: JSON.stringify({
      texto: entrada.texto,
      conversationId: entrada.conversationId,
      messageId: entrada.messageId,
      workspaceId: entrada.workspaceId,
    }),
  });

  const dados = (await resposta.json().catch(() => ({}))) as RespostaSelarMensagem;
  if (!resposta.ok || !dados.envelope) {
    throw new Error(dados.erro?.mensagem ?? `Falha ao selar a mensagem original (HTTP ${resposta.status}).`);
  }
  return dados.envelope;
}

export interface ProcessarMensagemEntranteResultado {
  textoMascarado: string;
  piiDetectada: PiiKind[];
  temVersaoOriginalSelada: boolean;
  envelope: SealedSecret | null;
}

/**
 * Orquestra o Shield-Layer completo para uma mensagem entrante: mascara
 * instantaneamente e, só se necessário, sela o original no servidor.
 *
 * Fail-closed quanto à exibição: se o selo falhar, a mensagem AINDA é
 * mascarada normalmente (a máscara não depende do selo) — o que se perde é
 * só a cópia de compliance, registrada como ausente (`temVersaoOriginalSelada:
 * false`), nunca o vazamento do dado em claro.
 */
export async function processarMensagemEntrante(entrada: {
  texto: string;
  conversationId: string;
  messageId: string;
  workspaceId: string;
  idToken: string;
}): Promise<ProcessarMensagemEntranteResultado> {
  const interceptacao = interceptarMensagem(entrada.texto);

  if (!interceptacao.temPii) {
    return {
      textoMascarado: interceptacao.textoMascarado,
      piiDetectada: [],
      temVersaoOriginalSelada: false,
      envelope: null,
    };
  }

  try {
    const envelope = await selarMensagemOriginal(entrada);
    return {
      textoMascarado: interceptacao.textoMascarado,
      piiDetectada: interceptacao.piiDetectada,
      temVersaoOriginalSelada: true,
      envelope,
    };
  } catch (erro) {
    console.error("[piiVault] falha ao selar o original — mensagem segue mascarada, sem cópia de compliance:", erro);
    return {
      textoMascarado: interceptacao.textoMascarado,
      piiDetectada: interceptacao.piiDetectada,
      temVersaoOriginalSelada: false,
      envelope: null,
    };
  }
}
