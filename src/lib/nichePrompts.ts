// Engine Auto-Moldável por Nicho — Multi-Niche Adaptation.
//
// Pura e testável: dado o `NicheKey` do workspace, devolve o texto de
// contexto que `montarPrompt` (`@/lib/server/orchestrator`) injeta na
// chamada REAL ao modelo — mesmo padrão já estabelecido pelo Auto-Feedback
// de Conversão (`contextoConversao`). O "System Prompt da IA" muda de
// verdade, por workspace, sem nenhuma lógica condicional espalhada pelo
// motor de orquestração: tudo fica neste mapa único.
//
// Cobre apenas os nichos com um perfil de atendimento genuinamente distinto
// o suficiente para merecer instrução própria — `outros` e nichos sem
// entrada aqui simplesmente não recebem contexto adicional (nunca um
// "nicho genérico" inventado).

import type { NicheKey } from "@/types";

export interface PerfilNicho {
  /** O que o atendimento deste nicho precisa resolver, em uma frase. */
  foco: string;
  /** A ação que o agente deve priorizar ao final da conversa. */
  acaoPrincipal: string;
  /** Registro/tom de voz esperado. */
  tomAtendimento: string;
}

export const PERFIL_POR_NICHO: Partial<Record<NicheKey, PerfilNicho>> = {
  "salao-beleza": {
    foco: "agendamento rápido de serviços (cabelo, unhas, estética) e dúvidas sobre valores",
    acaoPrincipal:
      "direcionar o cliente o quanto antes para o link de agendamento online — não prolongar a conversa com perguntas que o próprio link já resolve",
    tomAtendimento: "simpático, ágil e direto",
  },
  "clinica-alto-padrao": {
    foco: "qualificação de leads para procedimentos de alto ticket (estética, odontologia, harmonização)",
    acaoPrincipal:
      "qualificar se o cliente já realizou o procedimento antes e agendar uma consulta de avaliação — nunca estimar preço de procedimento sem avaliação presencial",
    tomAtendimento: "refinado, exclusivo e consultivo",
  },
  "construtora-imobiliaria": {
    foco: "resposta imediata a compradores/locatários de imóveis, inclusive fora do expediente",
    acaoPrincipal:
      "identificar o perfil do imóvel desejado (compra ou aluguel, bairro, orçamento) e direcionar ao corretor de plantão com um resumo formatado da necessidade",
    tomAtendimento: "consultivo, com senso de urgência na resposta",
  },
  "clinica-medica-exames": {
    foco: "confirmação de consultas/exames e prevenção de no-show",
    acaoPrincipal:
      "confirmar presença no horário marcado e enviar as instruções de preparo exigidas (jejum, documentos) de forma clara e completa",
    tomAtendimento: "profissional, preciso e objetivo",
  },
};

/**
 * Gera o texto de contexto de nicho injetado no prompt — `null` quando o
 * nicho é ausente ou não tem perfil definido (nunca um texto genérico
 * inventado para preencher a lacuna).
 */
export function gerarContextoNicho(nicho: NicheKey | null | undefined): string | null {
  if (!nicho) return null;
  const perfil = PERFIL_POR_NICHO[nicho];
  if (!perfil) return null;

  return (
    `Nicho do negócio: foco em ${perfil.foco}. ` +
    `Ação principal esperada ao final do atendimento: ${perfil.acaoPrincipal}. ` +
    `Tom de atendimento: ${perfil.tomAtendimento}.`
  );
}
