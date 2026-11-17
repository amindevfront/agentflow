// Catálogo de Canais & Integrações — hierarquia de vitrine.
//
// Fonte única da verdade sobre QUAIS canais existem, em que camada cada um
// entra e o que cada um realmente faz hoje. Antes, essa informação estava
// dispersa em três lugares dentro de `connectors/page.tsx` (a lista do
// `<select>`, o conjunto `TIPOS_COM_INGESTAO_REAL` e o texto do aviso de
// rodapé), o que permitia que divergissem em silêncio — um canal podia
// aparecer como opção, não estar no conjunto de ingestão real e mesmo assim
// ser citado no aviso como "já funciona".
//
// Os `tipo` abaixo são CHAVES DE DADOS: ficam gravados em
// `Connector.tipo` no Firestore e são comparados por igualdade exata pelos
// resolvedores de webhook do servidor (`resolverConectorPorPhoneNumberId`,
// `resolverConectorPorPageId`, `resolverConectorTelegram`, etc.). Renomear
// qualquer string aqui órfã os conectores já criados — rótulo de vitrine
// muda em `rotuloCurto`, nunca em `tipo`.

export type CamadaCanal = "tier-1" | "ativo-adicional" | "beta";

export interface DefinicaoCanal {
  /** Valor gravado em `Connector.tipo` — nunca renomear sem migração. */
  tipo: string;
  /** Nome de vitrine, curto, para o card do grid. */
  rotuloCurto: string;
  /** O que este canal faz hoje, em uma linha. */
  descricao: string;
  camada: CamadaCanal;
  /** `true` quando existe ingestão REAL implementada ponta a ponta nesta versão. */
  ingestaoReal: boolean;
}

export const TIPO_WEBHOOK = "Webhook";
export const TIPO_EMAIL = "E-mail";
export const TIPO_ARMAZENAMENTO = "Armazenamento";
export const TIPO_API_EXTERNA = "API externa";
export const TIPO_SMS = "SMS / Twilio Gateway";
export const TIPO_WIDGET = "Web Widget Corporativo (Embed)";
export const TIPO_WHATSAPP = "WhatsApp Business (Cloud API)";
export const TIPO_INSTAGRAM = "Instagram Direct (Meta Graph API)";
export const TIPO_FACEBOOK = "Facebook Messenger (Meta Graph API)";
export const TIPO_TELEGRAM = "Telegram Bot API";

/**
 * Catálogo completo, na ordem de exibição.
 *
 * Camada `tier-1`: os quatro canais operacionais primários de uma operação
 * enterprise — os que sustentam uma demonstração e o primeiro mês de
 * produção. Camada `ativo-adicional`: canais igualmente REAIS, porém de
 * adoção secundária (um deles exige conta Twilio própria, o outro é o irmão
 * do Instagram no mesmo app Meta) — ficam agrupados à parte para não
 * disputar atenção com o tier 1, nunca escondidos como se não existissem.
 * Camada `beta`: registro de intenção, sem provedor ligado.
 */
export const CATALOGO_CANAIS: DefinicaoCanal[] = [
  {
    tipo: TIPO_WHATSAPP,
    rotuloCurto: "WhatsApp Business",
    descricao: "Cloud API oficial da Meta — mensagens reais entram direto na Neural Inbox.",
    camada: "tier-1",
    ingestaoReal: true,
  },
  {
    tipo: TIPO_INSTAGRAM,
    rotuloCurto: "Instagram Direct",
    descricao: "DMs do perfil comercial via Meta Graph API, com o mesmo Shield-Layer dos demais canais.",
    camada: "tier-1",
    ingestaoReal: true,
  },
  {
    tipo: TIPO_WIDGET,
    rotuloCurto: "Web Widget Corporativo",
    descricao: "Snippet de embed para o site institucional — atendimento autônomo 24/7 no próprio domínio.",
    camada: "tier-1",
    ingestaoReal: true,
  },
  {
    tipo: TIPO_TELEGRAM,
    rotuloCurto: "Telegram",
    descricao: "Bot dedicado com token selado no Cofre Zero-Trust (exclusivo de admin).",
    camada: "tier-1",
    ingestaoReal: true,
  },
  {
    tipo: TIPO_SMS,
    rotuloCurto: "SMS / Twilio Gateway",
    descricao: "Canal SMS via conta Twilio própria do cliente.",
    camada: "ativo-adicional",
    ingestaoReal: true,
  },
  {
    tipo: TIPO_FACEBOOK,
    rotuloCurto: "Facebook Messenger",
    descricao: "Mesmo app Meta do Instagram, assinando o produto Messenger.",
    camada: "ativo-adicional",
    ingestaoReal: true,
  },
  {
    tipo: TIPO_WEBHOOK,
    rotuloCurto: "Webhook genérico",
    descricao: "Entrada HTTP arbitrária para sistemas internos.",
    camada: "beta",
    ingestaoReal: false,
  },
  {
    tipo: TIPO_EMAIL,
    rotuloCurto: "E-mail",
    descricao: "Caixa de entrada corporativa como canal de atendimento.",
    camada: "beta",
    ingestaoReal: false,
  },
  {
    tipo: TIPO_ARMAZENAMENTO,
    rotuloCurto: "Cloud Storage",
    descricao: "Ingestão de documentos a partir de um bucket/pasta compartilhada.",
    camada: "beta",
    ingestaoReal: false,
  },
  {
    tipo: TIPO_API_EXTERNA,
    rotuloCurto: "API externa",
    descricao: "Integração sob medida com um ERP/CRM proprietário.",
    camada: "beta",
    ingestaoReal: false,
  },
];

/** Todos os `tipo` do catálogo, na ordem de exibição — a lista que o seletor de tipo usa. */
export const CONNECTOR_TYPES: string[] = CATALOGO_CANAIS.map((c) => c.tipo);

export function canaisDaCamada(camada: CamadaCanal): DefinicaoCanal[] {
  return CATALOGO_CANAIS.filter((c) => c.camada === camada);
}

/** Definição de um `Connector.tipo`, ou `null` para um tipo legado que saiu do catálogo. */
export function obterDefinicaoCanal(tipo: string): DefinicaoCanal | null {
  return CATALOGO_CANAIS.find((c) => c.tipo === tipo) ?? null;
}

/** Tipos com ingestão real ponta a ponta — derivado do catálogo, nunca uma segunda lista escrita à mão. */
export const TIPOS_COM_INGESTAO_REAL = new Set(
  CATALOGO_CANAIS.filter((c) => c.ingestaoReal).map((c) => c.tipo)
);

export const TIPOS_SEM_INGESTAO_REAL = new Set(
  CATALOGO_CANAIS.filter((c) => !c.ingestaoReal).map((c) => c.tipo)
);
