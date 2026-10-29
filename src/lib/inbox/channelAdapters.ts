// Adaptadores de Canais Globais (EUA/UK/Europa) — Twilio SMS Gateway e Web
// Widget Corporativo (Embed).
//
// Mesmo racional do webhook do Meta (`src/app/api/inbox/webhook/route.ts`):
// cada adaptador aqui é PURO — normaliza e valida um payload específico do
// provedor, sem tocar em Firestore nem em rede. O pipeline real de ingestão
// (Shield-Layer, Radar de Sentimento, Circuit Breaker) já existe em
// `registrarMensagemCliente` (`@/lib/inbox/firestore`); quem conecta este
// módulo a uma rota de API chama aquele pipeline depois de normalizar.
//
// Por que isso é testável SEM credenciais reais de Twilio: o formato do
// webhook (`From`/`To`/`Body`/`MessageSid`) é especificação pública do
// provedor, não dado proprietário que exigiria uma conta real para ser
// exercitado.
//
// Deliberadamente SEM `node:crypto` neste arquivo: `gerarWidgetEmbedSnippet`
// é chamado da tela de Conectores (componente de cliente) — qualquer import
// de um módulo Node-only aqui quebraria o bundle do navegador. A validação
// de assinatura da Twilio (que precisa de `node:crypto`) vive em
// `./twilioSignature`, importado apenas por rotas de API (server-only).

import type { Canal } from "@/types";

export interface MensagemCanalNormalizada {
  canal: Canal;
  /**
   * Identificador do remetente no formato do provedor (ex.: "+15551234567"),
   * AINDA NÃO mascarado — mascarar é responsabilidade do Shield-Layer no
   * momento da ingestão (`interceptarMensagem`/`processarMensagemEntrante`),
   * não deste adaptador.
   */
  identificadorRemetente: string;
  texto: string;
  /** Id da mensagem no provedor de origem — usado para idempotência/depuração. */
  idExterno?: string;
}

// ---------------------------------------------------------------------------
// Twilio SMS Gateway
// ---------------------------------------------------------------------------

export interface CamposWebhookTwilio {
  From?: string;
  To?: string;
  Body?: string;
  MessageSid?: string;
}

/**
 * Normaliza o payload `application/x-www-form-urlencoded` que a Twilio envia
 * a cada SMS recebido.
 *
 * Falha explícita (lança) em vez de devolver um resultado parcial: um SMS
 * sem remetente ou sem corpo não é uma conversa válida para registrar — é
 * melhor rejeitar na borda do que criar uma `Conversation` órfã.
 */
export function normalizarMensagemTwilioSms(campos: CamposWebhookTwilio): MensagemCanalNormalizada {
  const remetente = campos.From?.trim();
  const texto = campos.Body?.trim();

  if (!remetente) {
    throw new Error('Payload da Twilio sem o campo "From" — não há remetente para a conversa.');
  }
  if (!texto) {
    throw new Error('Payload da Twilio sem o campo "Body" — mensagem vazia.');
  }

  return {
    canal: "sms",
    identificadorRemetente: remetente,
    texto,
    idExterno: campos.MessageSid,
  };
}

// ---------------------------------------------------------------------------
// Web Widget Corporativo (Embed)
// ---------------------------------------------------------------------------

export interface PayloadWidgetEmbed {
  workspaceId?: unknown;
  visitorId?: unknown;
  texto?: unknown;
}

/**
 * Normaliza o payload JSON enviado pelo snippet gerado em
 * `gerarWidgetEmbedSnippet` a cada mensagem do visitante.
 *
 * `visitorId` é um identificador de sessão gerado no navegador do visitante
 * (não é, por si só, um dado pessoal) — ainda assim passa pelo Shield-Layer
 * como qualquer identificador na ingestão, por cautela: o visitante pode
 * digitar seu nome/telefone dentro do próprio `texto`.
 */
export function normalizarMensagemWidget(corpo: PayloadWidgetEmbed): MensagemCanalNormalizada {
  if (typeof corpo.workspaceId !== "string" || corpo.workspaceId.trim().length === 0) {
    throw new Error('Payload do widget sem "workspaceId" válido.');
  }
  if (typeof corpo.visitorId !== "string" || corpo.visitorId.trim().length === 0) {
    throw new Error('Payload do widget sem "visitorId" válido.');
  }
  if (typeof corpo.texto !== "string" || corpo.texto.trim().length === 0) {
    throw new Error('Payload do widget sem "texto" válido.');
  }

  return {
    canal: "webchat",
    identificadorRemetente: corpo.visitorId.trim(),
    texto: corpo.texto.trim(),
  };
}

export interface GerarEmbedSnippetInput {
  workspaceId: string;
  /**
   * Origem do próprio AgentFlow que servirá o script — SEMPRE
   * `window.location.origin` no momento da geração (nunca um domínio
   * adivinhado): é assim que o snippet aponta para o host real, qualquer
   * que seja o ambiente (produção, preview, local).
   */
  baseUrl: string;
  /** Domínio do site do cliente onde o widget será embutido — documentação, não aplicado como regra de CORS nesta versão. */
  origemPermitida?: string;
}

/**
 * Gera o snippet de embed do Web Widget Corporativo — copiável e colável no
 * `<head>` do site do cliente.
 *
 * O snippet é real (aponta para o host e o workspace corretos). O que ainda
 * NÃO existe nesta versão é a rota pública de ingestão que ele chamaria
 * (`/api/inbox/webhook/widget`) — abrir um endpoint de escrita sem sessão
 * para tráfego anônimo de terceiros exige seu próprio desenho de
 * rate-limiting e validação de origem, documentado como trabalho futuro em
 * vez de implementado às pressas (mesmo padrão de honestidade do webhook do
 * Meta em `src/app/api/inbox/webhook/route.ts`).
 */
export function gerarWidgetEmbedSnippet(input: GerarEmbedSnippetInput): string {
  const origem = input.origemPermitida ?? "https://seusite.com.br";
  return [
    "<!-- AgentFlow — Web Widget Corporativo (Embed) -->",
    "<script",
    `  src="${input.baseUrl}/widget.js"`,
    `  data-workspace-id="${input.workspaceId}"`,
    `  data-allowed-origin="${origem}"`,
    "  async",
    "></script>",
  ].join("\n");
}
