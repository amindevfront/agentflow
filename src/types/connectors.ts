// AgentFlow Connect Hub — Conectores Universais baseados em Webhooks
// Assíncronos, com Mascaramento de PII na Saída.
//
// Camada de domínio compartilhada entre o dispatcher (`@/lib/server/connectors`)
// e a trilha de auditoria. Isomórfico: nenhum tipo aqui depende de Admin SDK
// ou de rede.

/**
 * Eventos que disparam uma notificação ao webhook de saída do workspace.
 * Deliberadamente fechado (não um `string` livre): cada novo tipo de evento
 * exige decisão explícita de o que vai no payload, nunca um "evento genérico"
 * inventado para cobrir um caso não pensado (Artigo IV — No Invention).
 */
export type ConnectHubEventType = "handoff.sucesso" | "agendamento.validado";

/**
 * Envelope padronizado do payload JSON enviado ao webhook de saída.
 *
 * `dados` já chega aqui JÁ MASCARADO pelo Shield-Layer — ver
 * `mascararDadosSaida` em `@/lib/server/connectors/webhookDispatcher`. Este
 * tipo descreve o formato depois da sanitização, nunca antes.
 */
export interface ConnectHubPayload {
  evento: ConnectHubEventType;
  workspaceId: string;
  /** Correlaciona com a trilha de auditoria e com o ticket/execução de origem. */
  traceId?: string;
  ocorridoEm: string;
  /** Sempre já mascarado — nunca contém PII em claro. */
  dados: Record<string, unknown>;
}

export type ConnectHubDeliveryStatus = "pendente" | "entregue" | "falhou" | "descartado";

/**
 * Registro de uma tentativa de entrega na fila de retry
 * (`connectHubDeliveries`, ver `@/lib/server/connectors/webhookQueue`).
 *
 * Mesmo desenho de `ItemFilaReputacaoCanal` (`@/types/sacShield`): a entrega
 * nunca é descartada silenciosamente em caso de falha — ela fica registrada
 * aqui para retry com backoff, até `MAX_TENTATIVAS_CONNECT_HUB`.
 */
export interface ConnectHubDelivery {
  id: string;
  workspaceId: string;
  webhookUrl: string;
  payload: ConnectHubPayload;
  /** HMAC-SHA-256 do corpo JSON canônico, em hex — o mesmo valor enviado no header de assinatura. */
  assinatura: string;
  status: ConnectHubDeliveryStatus;
  tentativas: number;
  criadoEm: string;
  ultimaTentativaEm: string | null;
  /** Ausente quando `status` é `entregue` ou `descartado` — não há próxima tentativa agendada. */
  proximaTentativaEm?: string | null;
  /** Mensagem de erro da última tentativa, sanitizada — nunca o corpo de resposta bruto do destino. */
  erroUltimaTentativa?: string | null;
}

/** Resultado devolvido por `despacharEventoConnectHubAdmin` — nunca lança, sempre descreve o desfecho. */
export interface ResultadoDespachoConnectHub {
  /** `false` quando o workspace não tem Connect Hub configurado — não é um erro, apenas "nada a fazer". */
  configurado: boolean;
  entregue: boolean;
  enfileirado: boolean;
  deliveryId?: string;
}

/**
 * Configuração do Connect Hub no workspace — um único webhook de saída que
 * recebe todos os eventos (`ConnectHubEventType`). `secretCredentialId`
 * referencia o cofre Zero-Trust (`credentials/{id}`, tipo `"webhook-secret"`)
 * — o segredo em claro nunca é persistido aqui, mesmo padrão de
 * `Flow.apiTokenCredentialId`.
 */
export interface ConnectHubConfig {
  webhookUrl: string;
  secretCredentialId: string;
}
