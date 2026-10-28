// Presets de verticalização usados na triagem de nicho do onboarding
// (ver docs/architecture/adr-0002-self-serve-signup-e-verticalizacao.md).
// Cada preset só fornece CONTEÚDO (texto sugerido) para componentes que já
// existem no design system (EmptyState) — nunca introduz tokens, cores ou
// componentes novos, conforme .claude/rules/design-system-compliance.md.

import type { NicheKey } from "@/types";

export interface NichePreset {
  key: NicheKey;
  label: string;
  descricao: string;
  playbooksSugeridos: string[];
}

export const NICHE_PRESETS: Record<NicheKey, NichePreset> = {
  "construtora-imobiliaria": {
    key: "construtora-imobiliaria",
    label: "Construtora & Imobiliária",
    descricao: "Leads de unidades, status de obra e repasse de documentação.",
    playbooksSugeridos: [
      "Qualificação de leads de unidades",
      "Atualização de status de obra para clientes",
      "Agendamento de visitas e vistorias",
    ],
  },
  "logistica-portuaria": {
    key: "logistica-portuaria",
    label: "Logística & Portos",
    descricao: "Rastreamento de cargas, janelas de atracação e documentação alfandegária.",
    playbooksSugeridos: [
      "Notificação de status de carga",
      "Agendamento de janela de atracação",
      "Alerta de pendência documental (DI/BL)",
    ],
  },
  "clinica-alto-padrao": {
    key: "clinica-alto-padrao",
    label: "Clínica de Alto Padrão",
    descricao: "Agenda de procedimentos, confirmação de pacientes e pós-atendimento.",
    playbooksSugeridos: [
      "Confirmação de agendamento de procedimento",
      "Follow-up pós-atendimento",
      "Lembrete de retorno/manutenção",
    ],
  },
  "servicos-luxo": {
    key: "servicos-luxo",
    label: "Serviços de Luxo",
    descricao: "Concierge, reservas exclusivas e atendimento personalizado de alto padrão.",
    playbooksSugeridos: [
      "Triagem e concierge de alta prioridade",
      "Confirmação de reserva/experiência exclusiva",
      "Follow-up pós-experiência",
    ],
  },
  ecommerce: {
    key: "ecommerce",
    label: "E-commerce",
    descricao: "Status de pedido, rastreio, trocas/devoluções e recuperação de carrinho.",
    playbooksSugeridos: [
      "Status de pedido e rastreio",
      "Recuperação de carrinho abandonado",
      "Triagem de troca/devolução",
    ],
  },
  outros: {
    key: "outros",
    label: "Outros",
    descricao: "Configuração genérica — personalize os fluxos do zero.",
    playbooksSugeridos: [],
  },
};

export const NICHE_ORDER: NicheKey[] = [
  "construtora-imobiliaria",
  "clinica-alto-padrao",
  "logistica-portuaria",
  "servicos-luxo",
  "ecommerce",
  "outros",
];
