// AgentFlow Connect Hub — fachada pública.
//
// Importe sempre `@/lib/server/connectors`, nunca os submódulos diretamente,
// para que a superfície pública possa evoluir sem quebrar os consumidores —
// mesmo princípio de `@/lib/guardrails/index.ts`.

export {
  HEADER_ASSINATURA_CONNECT_HUB,
  assinarPayloadConnectHub,
  despacharPayloadConnectHub,
  executorEnvioFetch,
  mascararDadosSaida,
  montarPayloadConnectHub,
  type DespacharInput,
  type DespacharResultado,
  type ExecutorEnvioWebhook,
  type MontarPayloadInput,
  type ResultadoEnvioHttp,
} from "./webhookDispatcher";

export {
  MAX_TENTATIVAS_CONNECT_HUB,
  calcularBackoffMs,
  decidirProximoEstadoEntrega,
  despacharEventoConnectHubAdmin,
  disjuntorDoWebhook,
  drenarFilaConnectHub,
  _resetarDisjuntoresConnectHubParaTeste,
  type DespacharEventoAdminInput,
  type ProximoEstadoEntrega,
  type ResultadoDespachoInterno,
} from "./webhookQueue";

export { lerSegredoCredencialAdmin } from "./credentialReader";
