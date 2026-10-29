// POST /api/inbox/webhook/widget — ingestão real do Web Widget Corporativo
// (Canais Globais — EUA/UK/Europa/Brasil).
//
// Única rota de ingestão desta família (Meta, Twilio) que de fato ESCREVE no
// Firestore: as outras duas ficam em modo de diagnóstico porque não há
// credenciais reais de provedor configuradas neste ambiente. O Web Widget
// não depende de credencial de terceiro — o próprio `public/widget.js`,
// embutido no site do cliente, é o "provedor" — então não há nada bloqueando
// a ingestão real aqui.
//
// Isso também a torna a PRIMEIRA superfície de escrita pública e anônima do
// AgentFlow (sem ID token do Firebase, sem assinatura HMAC de um terceiro
// confiável). As defesas, em camadas:
//   1. `widgetHabilitado` (em `@/lib/server/inboxWidgetAdmin`) exige que o
//      workspace tenha de fato cadastrado um conector do tipo Web Widget —
//      tráfego para um workspaceId que nunca habilitou o canal é rejeitado
//      antes de tocar em qualquer dado;
//   2. limite de taxa distribuído por IP (`consumirLimiteDistribuido`);
//   3. tamanho de corpo e de campos limitado;
//   4. o pipeline de ingestão em si passa pelo MESMO Shield-Layer e Radar de
//      Sentimento/Circuit Breaker de qualquer outro canal — uma mensagem
//      hostil não tem tratamento especial por vir de um canal anônimo.
// Limitação documentada, não escondida: não há CAPTCHA nem verificação de
// origem (`Origin`) — um widget embutido em qualquer site é, por desenho,
// uma origem diferente da do AgentFlow, então travar por `Origin` quebraria
// o caso de uso legítimo. Se o volume de abuso justificar, a camada 2
// (limite de taxa) é o primeiro lugar a endurecer.

import {
  ErroApi,
  corpoJson,
  exigirIdentificador,
  exigirTexto,
  respostaErro,
  respostaJson,
} from "@/lib/server/http";
import { consumirLimiteDistribuido } from "@/lib/server/distributedRateLimit";
import { normalizarMensagemWidget } from "@/lib/inbox/channelAdapters";
import { ErroWidgetNaoHabilitado, registrarMensagemWidgetAdmin } from "@/lib/server/inboxWidgetAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES_CORPO = 8 * 1024;
const MAX_TEXTO = 2000;

/** Generosa para uma conversa humana real, apertada contra um laço automatizado: 15 mensagens, 1 nova a cada 5s. */
const LIMITE_WIDGET = { capacidade: 15, taxaPorSegundo: 0.2 };

const CABECALHOS_CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

function ipDaRequisicao(requisicao: Request): string {
  const encaminhado = requisicao.headers.get("x-forwarded-for");
  return encaminhado?.split(",")[0]?.trim() || "desconhecido";
}

/** Preflight CORS: o navegador sempre dispara isto antes de um POST JSON cross-origin. */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CABECALHOS_CORS });
}

interface CorpoWidget {
  workspaceId?: unknown;
  visitorId?: unknown;
  texto?: unknown;
}

export async function POST(requisicao: Request): Promise<Response> {
  try {
    const declarado = requisicao.headers.get("content-length");
    if (declarado && Number(declarado) > MAX_BYTES_CORPO) {
      return respostaErro(413, "Corpo excede o limite.", "corpo_grande", CABECALHOS_CORS);
    }

    const ip = ipDaRequisicao(requisicao);
    const limite = await consumirLimiteDistribuido(`widget-ip:${ip}`, LIMITE_WIDGET);
    if (!limite.permitido) {
      return respostaErro(
        429,
        `Muitas mensagens em pouco tempo. Tente novamente em ${limite.tentarEmSegundos}s.`,
        "limite_excedido",
        { ...CABECALHOS_CORS, "retry-after": String(limite.tentarEmSegundos) }
      );
    }

    const corpo = await corpoJson<CorpoWidget>(requisicao, MAX_BYTES_CORPO);
    const workspaceId = exigirIdentificador(corpo.workspaceId, "workspaceId");
    const visitorId = exigirIdentificador(corpo.visitorId, "visitorId");
    const texto = exigirTexto(corpo.texto, "texto", { max: MAX_TEXTO, min: 1 });

    const normalizado = normalizarMensagemWidget({ workspaceId, visitorId, texto });

    const resultado = await registrarMensagemWidgetAdmin({
      workspaceId,
      visitorId: normalizado.identificadorRemetente,
      texto: normalizado.texto,
    });

    return respostaJson(
      { conversationId: resultado.conversationId, messageId: resultado.messageId },
      201,
      CABECALHOS_CORS
    );
  } catch (erro) {
    if (erro instanceof ErroWidgetNaoHabilitado) {
      return respostaErro(403, erro.message, "widget_nao_habilitado", CABECALHOS_CORS);
    }
    if (erro instanceof ErroApi) {
      return respostaErro(erro.status, erro.message, erro.codigo, CABECALHOS_CORS);
    }
    console.error("[inbox/webhook/widget] erro não tratado:", erro);
    return respostaErro(500, "Erro interno ao processar a mensagem.", "erro_interno", CABECALHOS_CORS);
  }
}
