// AgentFlow Connect Hub — Webhook Dispatcher Seguro.
//
// Núcleo puro + executor injetado (mesmo desenho de `@/lib/server/orchestrator`
// e `@/lib/server/visionAdmin`): nenhuma função aqui toca em Firestore
// diretamente — a montagem do payload, o mascaramento e a assinatura são
// 100% testáveis sem rede nem Admin SDK. A fiação real (ler a configuração
// do workspace, decifrar o segredo, persistir a fila de retry) vive em
// `./webhookQueue`.
//
// Isomórfico por desenho (Web Crypto, sem Node-only APIs) — mesmo padrão de
// `@/lib/crypto/digest`.

import type { ConnectHubEventType, ConnectHubPayload } from "@/types";
import { PiiVault, maskDeep } from "@/lib/guardrails";
import { hmacSha256Hex } from "@/lib/crypto/digest";
import { jsonCanonico } from "@/lib/crypto/canonical";
import { textoParaBytes } from "@/lib/crypto/encoding";

/** Header convencional para a assinatura — mesmo prefixo usado por Stripe/GitHub, familiar para quem integra o outro lado. */
export const HEADER_ASSINATURA_CONNECT_HUB = "x-agentflow-signature";

/**
 * Mascara recursivamente qualquer PII em `dados` antes de sair do processo —
 * a garantia central do item 2 (Blindagem de PII na Saída). Chamada SEMPRE
 * por `montarPayloadConnectHub`, nunca opcional: nenhum caminho de código
 * monta um `ConnectHubPayload` sem passar por aqui, mesmo que o chamador já
 * tenha mascarado o dado antes (ex.: um `payloadMascarado` de ticket HITL) —
 * reaplicar `maskDeep` em texto já mascarado é inerte (placeholders não
 * casam com nenhum padrão de PII), então o custo de rodar de novo é
 * desprezível frente à garantia de nunca depender de todo chamador lembrar
 * de mascarar.
 *
 * Cofre efêmero, descartado imediatamente — mesmo padrão de `evidenciaSegura`
 * (`@/lib/guardrails/pii`).
 */
export function mascararDadosSaida(dados: Record<string, unknown>): Record<string, unknown> {
  const vaultDescartavel = new PiiVault();
  try {
    const resultado = maskDeep(dados, vaultDescartavel);
    return resultado.valor as Record<string, unknown>;
  } finally {
    vaultDescartavel.clear();
  }
}

export interface MontarPayloadInput {
  evento: ConnectHubEventType;
  workspaceId: string;
  traceId?: string;
  /** Dados específicos do evento — serão mascarados antes de entrar no payload. */
  dados: Record<string, unknown>;
  agora?: Date;
}

/**
 * Monta o envelope padronizado do Connect Hub. Pura: mesma entrada produz
 * sempre a mesma saída (exceto `ocorridoEm`, que usa `agora` quando
 * informado — testável sem depender do relógio real).
 */
export function montarPayloadConnectHub(input: MontarPayloadInput): ConnectHubPayload {
  const agora = input.agora ?? new Date();
  return {
    evento: input.evento,
    workspaceId: input.workspaceId,
    traceId: input.traceId,
    ocorridoEm: agora.toISOString(),
    dados: mascararDadosSaida(input.dados),
  };
}

/**
 * Assina o corpo JSON canônico do payload com HMAC-SHA-256, usando o
 * segredo do webhook (string em claro, decifrado do cofre Zero-Trust pelo
 * chamador — nunca persistido). `jsonCanonico` (mesma função usada pela
 * trilha de auditoria) garante que a assinatura seja determinística
 * independentemente da ordem de inserção das chaves do objeto.
 */
export async function assinarPayloadConnectHub(
  payload: ConnectHubPayload,
  segredoWebhook: string
): Promise<{ corpoJson: string; assinatura: string }> {
  const corpoJson = jsonCanonico(payload);
  const assinatura = await hmacSha256Hex(textoParaBytes(segredoWebhook), corpoJson);
  return { corpoJson, assinatura };
}

export interface ResultadoEnvioHttp {
  ok: boolean;
  status?: number;
}

/** Função que efetivamente faz a chamada HTTP ao webhook. Injetável — produção usa `fetch` real, teste usa um dublê. */
export type ExecutorEnvioWebhook = (
  url: string,
  corpoJson: string,
  assinatura: string
) => Promise<ResultadoEnvioHttp>;

/** Executor real — `fetch` com o header de assinatura. Timeout fica a cargo de quem chama (ver `./webhookQueue`). */
export const executorEnvioFetch: ExecutorEnvioWebhook = async (url, corpoJson, assinatura) => {
  const resposta = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [HEADER_ASSINATURA_CONNECT_HUB]: `sha256=${assinatura}`,
    },
    body: corpoJson,
  });
  return { ok: resposta.ok, status: resposta.status };
};

export interface DespacharInput {
  payload: ConnectHubPayload;
  webhookUrl: string;
  segredoWebhook: string;
  executor: ExecutorEnvioWebhook;
}

export interface DespacharResultado {
  entregue: boolean;
  corpoJson: string;
  assinatura: string;
  statusHttp?: number;
}

/**
 * Assina e envia o payload uma única vez, via o executor injetado. Não
 * decide retry nem persiste nada — isso é responsabilidade de
 * `./webhookQueue`, que envolve esta função com o disjuntor e a fila de
 * backoff. Falha de rede do executor propaga para quem chama decidir.
 */
export async function despacharPayloadConnectHub(input: DespacharInput): Promise<DespacharResultado> {
  const { corpoJson, assinatura } = await assinarPayloadConnectHub(input.payload, input.segredoWebhook);
  const resultado = await input.executor(input.webhookUrl, corpoJson, assinatura);
  return { entregue: resultado.ok, corpoJson, assinatura, statusHttp: resultado.status };
}
