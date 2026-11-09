// Preenchimento Mágico por Nicho — Modo Copiloto Guiado (V2 do Onboarding).
//
// Dados de DEMONSTRAÇÃO, puros e isomórficos: nenhum nome aqui é um cliente
// real — "Horizon BC"/"Salão da Mãe" e os demais são fictícios por desenho,
// só para o implementador não precisar digitar nada ao demonstrar o produto
// pela primeira vez (ou mostrar pra um cliente em pé numa reunião). Mesma
// honestidade de todo dado de exemplo deste código: rotulado como exemplo,
// nunca confundido com dado real.
//
// Cobre as gavetas com UI de nicho (Inbox/guardrail dedicados); o restante
// (back-office transversal, nichos sem gaveta, `outros`) cai no fallback
// genérico — nunca um exemplo inventado "pra forçar" um nicho sem contexto
// real definido (Artigo IV).

import type { NicheKey } from "@/types";

export interface ExemploFluxoPorNicho {
  /** Nome sugerido do fluxo — sempre identificável como demonstração. */
  nomeFluxo: string;
  gatilho: "webhook" | "agendado" | "formulario" | "manual";
  origem: string;
  /** Payload de exemplo para o Simulador — chaves que `extrairClienteSimulado` reconhece. */
  payloadExemplo: Record<string, string>;
}

const EXEMPLO_PADRAO: ExemploFluxoPorNicho = {
  nomeFluxo: "Meu primeiro fluxo de teste",
  gatilho: "manual",
  origem: "Teste manual",
  payloadExemplo: { nome: "Lead de teste", texto: "Olá, gostaria de saber mais sobre os serviços de vocês." },
};

const EXEMPLOS_POR_NICHO: Partial<Record<NicheKey, ExemploFluxoPorNicho>> = {
  "construtora-imobiliaria": {
    nomeFluxo: "Leads Horizon BC — Imóveis de Alto Padrão",
    gatilho: "webhook",
    origem: "Formulário do site Horizon BC",
    payloadExemplo: {
      nome: "Marina Castello",
      texto: "Oi! Vi a cobertura na Praia Brava, orçamento até 1,8 milhão. Podemos agendar uma visita esse sábado?",
    },
  },
  "clinica-alto-padrao": {
    nomeFluxo: "Agenda Clínica Alto Padrão",
    gatilho: "webhook",
    origem: "Widget do site da clínica",
    payloadExemplo: { nome: "Beatriz Lemos", texto: "Gostaria de agendar uma avaliação para harmonização facial, pode ser essa semana?" },
  },
  "clinica-medica-exames": {
    nomeFluxo: "Confirmação de Consultas & Exames",
    gatilho: "agendado",
    origem: "Integração com sistema de agenda",
    payloadExemplo: { nome: "Roberto Alves", texto: "Confirmo presença no exame de sangue amanhã às 8h, preciso mesmo estar em jejum?" },
  },
  "logistica-portuaria": {
    nomeFluxo: "Rastreio de Cargas — Porto",
    gatilho: "webhook",
    origem: "Sistema de rastreamento da transportadora",
    payloadExemplo: { nome: "Setor de Importação", texto: "Qual o status da carga ABC-123456789? Previsão de desembaraço?" },
  },
  ecommerce: {
    nomeFluxo: "Atendimento Pós-venda E-commerce",
    gatilho: "webhook",
    origem: "Loja virtual — chat do checkout",
    payloadExemplo: { nome: "Juliana Prado", texto: "Meu pedido chegou com defeito, quero solicitar devolução. Pedido #48213." },
  },
  "advocacia-contabilidade": {
    nomeFluxo: "Triagem de Novos Clientes B2B",
    gatilho: "formulario",
    origem: 'Formulário "Fale com um especialista" do site',
    payloadExemplo: { nome: "Diretoria Tech Solutions Ltda", texto: "Somos uma startup e precisamos de orientação tributária para abrir filial em outro estado." },
  },
  "salao-beleza": {
    nomeFluxo: "Agendamento Salão da Mãe",
    gatilho: "manual",
    origem: "Atendimento via WhatsApp",
    payloadExemplo: { nome: "Cliente Salão da Mãe", texto: "Oi, vocês têm horário pra escova e manicure sábado de manhã?" },
  },
  "servicos-luxo": {
    nomeFluxo: "Concierge VIP",
    gatilho: "manual",
    origem: "WhatsApp exclusivo de clientes VIP",
    payloadExemplo: { nome: "Cliente Platinum", texto: "Preciso de uma reserva para 6 pessoas hoje à noite, sem exceções." },
  },
  "us-real-estate-luxury": {
    nomeFluxo: "Horizon Miami — Luxury Leads",
    gatilho: "webhook",
    origem: "Website contact form",
    payloadExemplo: { name: "Jordan Pierce", message: "Looking for a penthouse in Brickell, up to $2 million. Can we schedule a showing this weekend?" },
  },
  "us-construction-remodeling": {
    nomeFluxo: "Horizon Builders — Remodeling Leads",
    gatilho: "webhook",
    origem: "Website quote request form",
    payloadExemplo: { name: "Mike Thompson", message: "Need a kitchen remodel, about 300 sq ft. Budget of $25k, kind of urgent." },
  },
  "portugal-clinics-health": {
    nomeFluxo: "Agenda Clínica Lisboa",
    gatilho: "webhook",
    origem: "Formulário do site da clínica",
    payloadExemplo: { nome: "Catarina Sousa", texto: "Posso agendar uma consulta de avaliação para a próxima semana?" },
  },
};

/** Exemplo de demonstração para o nicho — nunca `undefined`: cai no fallback genérico quando o nicho não tem um exemplo próprio. */
export function obterExemploFluxo(setor: NicheKey | null | undefined): ExemploFluxoPorNicho {
  if (!setor) return EXEMPLO_PADRAO;
  return EXEMPLOS_POR_NICHO[setor] ?? EXEMPLO_PADRAO;
}
