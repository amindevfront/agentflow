// POST /api/inbox/webhook/twilio — ingestão de SMS via Twilio (Canais Globais — EUA/UK/Europa).
//
// Mesmo padrão de diagnóstico do webhook do Meta
// (`src/app/api/inbox/webhook/route.ts`): valida a assinatura do provedor e
// o formato do payload, e devolve exatamente o que faltaria para processá-lo
// de verdade, em vez de fingir sucesso. Nenhuma conta Twilio real está
// configurada neste ambiente — não há como exercitar a ingestão de ponta a
// ponta sem o Auth Token real do projeto Twilio do cliente.
//
// DELIBERADAMENTE NÃO usa `comGuarda`: a Twilio nunca envia um ID token do
// Firebase — ela autentica por assinatura HMAC-SHA1 no cabeçalho
// `X-Twilio-Signature`, calculada sobre a URL completa + parâmetros POST
// ordenados (ver `validarAssinaturaTwilio` em `@/lib/inbox/channelAdapters`).
//
// O pipeline de processamento em si — Shield-Layer, Radar de Sentimento,
// Circuit Breaker — é real e já está implementado em
// `@/lib/inbox/firestore` (`registrarMensagemCliente`). Esta rota está
// pronta para chamá-lo assim que `TWILIO_AUTH_TOKEN` estiver configurado.

import { normalizarMensagemTwilioSms } from "@/lib/inbox/channelAdapters";
import { validarAssinaturaTwilio } from "@/lib/inbox/twilioSignature";

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

    try {
      normalizarMensagemTwilioSms(parametros);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : "Payload inválido.";
      return respostaJson({ erro: { codigo: "payload_invalido", mensagem } }, 400);
    }

    // A partir daqui, com a assinatura validada e o payload normalizado, o
    // processamento real seria resolver o workspace pelo número `To` (a
    // Twilio não informa o workspace — isso exige um mapeamento número↔
    // workspace, hoje inexistente) e chamar `registrarMensagemCliente`.
    // Trabalho futuro assim que uma conta Twilio real estiver configurada e
    // este caminho puder ser exercitado de ponta a ponta — ver
    // `src/lib/inbox/firestore.ts`.
    return respostaJson(
      {
        erro: {
          codigo: "ingestao_nao_implementada",
          mensagem: "Assinatura validada, mas a ingestão real ainda não está implementada para este canal.",
        },
      },
      501
    );
  } catch (erro) {
    console.error("[inbox/webhook/twilio] erro não tratado:", erro);
    return respostaJson({ erro: { codigo: "erro_interno", mensagem: "Erro interno ao processar o webhook." } }, 500);
  }
}
