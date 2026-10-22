// POST /api/inbox/webhook — ingestão de mensagens de canais externos.
//
// Ponto de entrada real para WhatsApp Business Cloud API, Instagram e
// Facebook Messenger (via Meta Graph API) — o provedor do canal chamaria
// esta rota a cada mensagem recebida. Nenhum desses três provedores tem
// credenciais configuradas neste ambiente (não há como validar a assinatura
// de um webhook sem o segredo real do app Meta), então esta rota opera em
// modo de DIAGNÓSTICO: valida a assinatura e o formato do payload, e devolve
// exatamente o que faltaria para processá-lo de verdade, em vez de fingir
// sucesso.
//
// DELIBERADAMENTE NÃO usa `comGuarda`: aquele wrapper exige um ID token do
// Firebase em `Authorization: Bearer`, e um webhook real do Meta nunca envia
// isso — ele autentica por assinatura HMAC no corpo (`X-Hub-Signature-256`),
// um mecanismo completamente diferente. Exigir sessão Firebase aqui rejeitaria
// toda chamada real do provedor antes mesmo de validar a assinatura.
//
// O pipeline de processamento em si — Shield-Layer, Radar de Sentimento,
// Circuit Breaker — é real e já está implementado em
// `@/lib/inbox/firestore` (`registrarMensagemCliente`). Esta rota está pronta
// para chamá-lo assim que `META_WEBHOOK_SECRET` estiver configurado; a
// validação de assinatura HMAC do Meta é aplicada antes de qualquer outra
// coisa, exatamente como a documentação do provedor exige — ela só não pode
// ser EXERCITADA sem o segredo real.
//
// O canal "webchat" não depende de credencial externa nem desta rota: o
// operador autenticado chama `registrarMensagemCliente` (em
// `@/lib/inbox/firestore`) diretamente do navegador, com sua própria sessão
// Firebase — ver o harness de simulação em `NeuralInbox.tsx`.

import { createHmac, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VARIAVEL_SEGREDO = "META_WEBHOOK_SECRET";
const MAX_BYTES_CORPO = 64 * 1024;

const CABECALHOS_SEGUROS: Record<string, string> = {
  "cache-control": "no-store, no-cache, must-revalidate, private",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function respostaJson(dados: unknown, status: number): Response {
  return new Response(JSON.stringify(dados), { status, headers: CABECALHOS_SEGUROS });
}

/** Valida a assinatura HMAC-SHA256 que o Meta anexa a cada chamada de webhook real. */
function validarAssinaturaMeta(corpoBruto: string, assinaturaRecebida: string | null, segredo: string): boolean {
  if (!assinaturaRecebida) return false;
  const esperada = `sha256=${createHmac("sha256", segredo).update(corpoBruto).digest("hex")}`;
  const bufferRecebido = Buffer.from(assinaturaRecebida);
  const bufferEsperado = Buffer.from(esperada);
  if (bufferRecebido.length !== bufferEsperado.length) return false;
  return timingSafeEqual(bufferRecebido, bufferEsperado);
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
            mensagem: `Webhook de canal externo não configurado — defina ${VARIAVEL_SEGREDO} com o segredo do app Meta para ativar a validação de assinatura e a ingestão real.`,
          },
        },
        503
      );
    }

    const corpoBruto = await requisicao.text();
    if (corpoBruto.length > MAX_BYTES_CORPO) {
      return respostaJson({ erro: { codigo: "corpo_grande", mensagem: "Corpo excede o limite." } }, 413);
    }

    const assinatura = requisicao.headers.get("x-hub-signature-256");
    if (!validarAssinaturaMeta(corpoBruto, assinatura, segredo)) {
      return respostaJson({ erro: { codigo: "assinatura_invalida", mensagem: "Assinatura do webhook inválida." } }, 401);
    }

    try {
      JSON.parse(corpoBruto);
    } catch {
      return respostaJson({ erro: { codigo: "json_invalido", mensagem: "Corpo do webhook não é JSON válido." } }, 400);
    }

    // A partir daqui, com a assinatura validada, o processamento real seria
    // extrair conversationId/texto/canal do formato específico do provedor
    // (WhatsApp Cloud API e Meta Graph API têm envelopes diferentes) e chamar
    // o pipeline real já construído em `registrarMensagemCliente`. Trabalho
    // futuro assim que um provedor real estiver configurado e este caminho
    // puder ser exercitado de ponta a ponta contra tráfego real — ver
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
    console.error("[inbox/webhook] erro não tratado:", erro);
    return respostaJson({ erro: { codigo: "erro_interno", mensagem: "Erro interno ao processar o webhook." } }, 500);
  }
}

/**
 * Meta chama GET nesta mesma URL durante a configuração do webhook, para
 * verificar posse do endpoint (handshake de `hub.challenge`).
 */
export async function GET(requisicao: Request): Promise<Response> {
  const url = new URL(requisicao.url);
  const modo = url.searchParams.get("hub.mode");
  const challenge = url.searchParams.get("hub.challenge");
  const tokenVerificacao = url.searchParams.get("hub.verify_token");
  const segredo = process.env[VARIAVEL_SEGREDO]?.trim();

  if (modo === "subscribe" && segredo && tokenVerificacao === segredo && challenge) {
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }

  return respostaJson({ erro: { codigo: "verificacao_invalida", mensagem: "Parâmetros de verificação inválidos." } }, 403);
}
