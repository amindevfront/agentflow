// POST /api/inbox/webhook/twilio — ingestão de SMS via Twilio (Canais Globais — EUA/UK/Europa).
//
// Mesmo padrão de diagnóstico do webhook do Meta
// (`src/app/api/inbox/webhook/route.ts`): valida a assinatura do provedor e
// o formato do payload antes de tocar em qualquer dado.
//
// DELIBERADAMENTE NÃO usa `comGuarda`: a Twilio nunca envia um ID token do
// Firebase — ela autentica por assinatura HMAC-SHA1 no cabeçalho
// `X-Twilio-Signature`, calculada sobre a URL completa + parâmetros POST
// ordenados (ver `validarAssinaturaTwilio` em `@/lib/inbox/channelAdapters`).
//
// Ingestão real: o pipeline (Shield-Layer, Radar de Sentimento, Circuit
// Breaker) roda via `registrarMensagemSmsAdmin` (Admin SDK — a Twilio não
// tem sessão Firebase, então o caminho client de `@/lib/inbox/firestore` não
// se aplica aqui, mesmo racional do WhatsApp Cloud API). O workspace é
// resolvido pelo número `To` cadastrado no conector "SMS / Twilio Gateway" —
// sem conector cadastrado com esse número, a ingestão é recusada, nunca
// gravada às cegas.

import { normalizarMensagemTwilioSms } from "@/lib/inbox/channelAdapters";
import { validarAssinaturaTwilio } from "@/lib/inbox/twilioSignature";
import { registrarMensagemSmsAdmin, resolverConectorPorNumeroTwilio } from "@/lib/server/twilioSmsAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VARIAVEL_SEGREDO = "TWILIO_AUTH_TOKEN";
const MAX_BYTES_CORPO = 16 * 1024;

const CABECALHOS_SEGUROS: Record<string, string> = {
  "cache-control": "no-store, no-cache, must-revalidate, private",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function respostaJson(dados: unknown, status: number): Response {
  return new Response(JSON.stringify(dados), { status, headers: CABECALHOS_SEGUROS });
}

export async function POST(requisicao: Request): Promise<Response> {
  try {
    const declarado = requisicao.headers.get("content-length");
    if (declarado && Number(declarado) > MAX_BYTES_CORPO) {
      return respostaJson({ erro: { codigo: "corpo_grande", mensagem: "Corpo excede o limite." } }, 413);
    }

    const segredo = process.env[VARIAVEL_SEGREDO]?.trim();
    if (!segredo) {
      return respostaJson(
        {
          erro: {
            codigo: "webhook_nao_configurado",
            mensagem: `SMS Gateway não configurado — defina ${VARIAVEL_SEGREDO} com o Auth Token da conta Twilio para ativar a validação de assinatura e a ingestão real.`,
          },
        },
        503
      );
    }

    const corpoBruto = await requisicao.text();
    if (corpoBruto.length > MAX_BYTES_CORPO) {
      return respostaJson({ erro: { codigo: "corpo_grande", mensagem: "Corpo excede o limite." } }, 413);
    }

    const parametros: Record<string, string> = {};
    for (const [chave, valor] of new URLSearchParams(corpoBruto)) {
      parametros[chave] = valor;
    }

    const assinatura = requisicao.headers.get("x-twilio-signature");
    if (!assinatura || !validarAssinaturaTwilio(requisicao.url, parametros, segredo, assinatura)) {
      return respostaJson({ erro: { codigo: "assinatura_invalida", mensagem: "Assinatura do webhook inválida." } }, 401);
    }

    let normalizada;
    try {
      normalizada = normalizarMensagemTwilioSms(parametros);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : "Payload inválido.";
      return respostaJson({ erro: { codigo: "payload_invalido", mensagem } }, 400);
    }

    const numeroDestino = parametros.To?.trim();
    if (!numeroDestino) {
      return respostaJson(
        { erro: { codigo: "payload_invalido", mensagem: 'Payload da Twilio sem o campo "To".' } },
        400
      );
    }

    const conector = await resolverConectorPorNumeroTwilio(numeroDestino);
    if (!conector) {
      // Assinatura válida (é a Twilio de verdade), mas nenhum conector deste
      // workspace reivindica este número — nunca grava às cegas num
      // workspace desconhecido.
      return respostaJson(
        {
          erro: {
            codigo: "conector_nao_encontrado",
            mensagem: `Nenhum conector "SMS / Twilio Gateway" cadastrado para o número ${numeroDestino}.`,
          },
        },
        404
      );
    }

    const resultado = await registrarMensagemSmsAdmin({
      workspaceId: conector.workspaceId,
      telefoneCliente: normalizada.identificadorRemetente,
      texto: normalizada.texto,
      idExterno: normalizada.idExterno,
    });

    return respostaJson({ ingerido: true, conversationId: resultado.conversationId }, 200);
  } catch (erro) {
    console.error("[inbox/webhook/twilio] erro não tratado:", erro);
    return respostaJson({ erro: { codigo: "erro_interno", mensagem: "Erro interno ao processar o webhook." } }, 500);
  }
}
