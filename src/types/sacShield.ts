// Tipos do SAC Shield.
//
// Três frentes, cada uma com seu módulo de implementação:
//
//   1. Cronometragem de handoff e fallback regulatório — a janela legal de
//      atendimento (ex.: Decreto do SAC) para um transbordo humano vinculado
//      a uma conversa real nunca passa sem reação automática. Ver
//      `@/lib/server/sacShieldHandoffMonitor`.
//   2. Blindagem de reputação de canal — anti-banimento de WhatsApp/canais de
//      mensageria: risco de disparo em massa, picos de volume e termos-gatilho
//      de denúncia de spam. Ver `@/lib/channelReputationShield` (avaliação
//      pura) e `@/lib/server/channelReputationShieldAdmin` (disjuntor + fila).
//   3. Pacote de Evidência de Conformidade — exportação auditável da trilha
//      selada para auditorias corporativas. Ver
//      `@/lib/server/sacShieldEvidencePackage`.

import type { AuditChainVerification, AuditEntry, HandoffPriority } from "./governance";
import type { GuardrailSeverity } from "./guardrails";
import type { Canal } from "./inbox";

// ---------------------------------------------------------------------------
// 1. Cronometragem de handoff e fallback regulatório
// ---------------------------------------------------------------------------

/**
 * Emitido quando um ticket de transbordo vinculado a uma conversa real
 * (`HandoffTicket.conversationId` presente) estoura a janela legal de
 * atendimento sem decisão humana — o fallback seguro já foi aplicado quando
 * este alerta é produzido.
 */
export interface AlertaSacShield {
  ticketId: string;
  conversationId: string;
  workspaceId: string;
  prioridade: HandoffPriority;
  severidade: GuardrailSeverity;
  /** Minutos decorridos além do prazo legal — sempre positivo. */
  atrasoMinutos: number;
  /** Entrada selada na trilha de auditoria que registra este fallback. */
  auditEntryId: string;
  ocorridoEm: string;
}

export interface ResultadoTickSacShieldSla {
  ticketsVerificados: number;
  fallbacksAplicados: number;
  alertas: AlertaSacShield[];
}

// ---------------------------------------------------------------------------
// 2. Blindagem de reputação de canal (anti-banimento)
// ---------------------------------------------------------------------------

export type NivelRiscoDisparoCanal = "normal" | "elevado" | "critico";

export interface AvaliacaoRiscoDisparoCanal {
  nivel: NivelRiscoDisparoCanal;
  /** `false` significa: não envie agora — enfileire. */
  permitido: boolean;
  motivos: string[];
  /**
   * Atraso adicional sugerido antes do próximo disparo ao mesmo canal, em ms.
   * Puramente informativo: nunca aplicado como espera bloqueante dentro de
   * uma requisição — mesma restrição documentada em
   * `@/lib/campaigns/stochasticEngine`. Um chamador com cronograma (campanha)
   * pode somar este valor ao próprio jitter.
   */
  atrasoMsRecomendado: number;
}

export type StatusItemFilaReputacao = "pendente" | "reenviado" | "descartado";

/**
 * Item da fila de reenvio inteligente — persistido em
 * `channelReputationQueue` quando um disparo é contido pela blindagem.
 * Carrega o hash do destino, nunca o valor em claro (mesma minimização de
 * `CampaignRecipient.destinoHash`).
 */
export interface ItemFilaReputacaoCanal {
  id: string;
  workspaceId: string;
  canal: Canal;
  destinoHash: string;
  mensagem: string;
  motivos: string[];
  nivel: NivelRiscoDisparoCanal;
  status: StatusItemFilaReputacao;
  tentativas: number;
  criadoEm: string;
  ultimaTentativaEm?: string | null;
  /**
   * Referência opaca de volta à origem do disparo (ex.: `${campaignId}__${recipientId}`
   * para um envio de campanha) — necessária porque `destinoHash` é
   * irreversível por desenho (minimização: nunca persiste o destino em
   * claro). Sem esta referência, o reenvio não teria como resolver o
   * destino real; cada origem resolve o próprio significado do valor (ver
   * `reenviarItemFilaReputacaoDeCampanha` em `@/lib/server/campaignsAdmin`).
   */
  origemReferencia?: string | null;
}

export interface ResultadoEnvioBlindado {
  enviado: boolean;
  enfileirado: boolean;
  avaliacao: AvaliacaoRiscoDisparoCanal;
}

export interface ResultadoDrenagemFilaReputacao {
  processados: number;
  reenviados: number;
  descartados: number;
  aindaPendentes: number;
}

// ---------------------------------------------------------------------------
// 3. Pacote de Evidência de Conformidade
// ---------------------------------------------------------------------------

/**
 * Exportação auditável da trilha selada de um período, pronta para entrega a
 * um auditor corporativo. `verificacaoCadeia` embute a prova de integridade
 * (hash + HMAC) no próprio pacote — o auditor não precisa confiar no
 * servidor que o gerou, só recalcular (ver `verificarCadeiaAuditoria`).
 */
export interface PacoteEvidenciaConformidade {
  workspaceId: string;
  periodoInicio: string;
  periodoFim: string;
  geradoEm: string;
  totalEventos: number;
  verificacaoCadeia: AuditChainVerification;
  eventos: AuditEntry[];
}
