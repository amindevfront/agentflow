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
  /**
   * Protocolo estruturado de qualificação (Módulo Vertical: Construtoras/
   * Imobiliárias de Alto Padrão) — os campos que o agente precisa coletar,
   * de forma educada e sem parecer um formulário, antes de considerar o
   * lead qualificado para o corretor. Opcional: só nichos com um protocolo
   * genuinamente estruturado (não um roteiro genérico inventado) o definem.
   */
  protocoloQualificacao?: string;
  /**
   * Restrição explícita no próprio prompt — defesa em profundidade junto do
   * guardrail correspondente (`preco-comercial-nao-autorizado` e/ou
   * `diagnostico-ou-resultado-nao-autorizado`, em `@/lib/guardrails/consistency`):
   * instruir o modelo a nunca tentar a promessa já ajuda a reduzir a taxa de
   * tentativas, mesmo que o guardrail seja a garantia real (o modelo pode
   * ignorar a instrução; não pode ignorar o bloqueio). Deliberadamente
   * genérico (não "restricaoComercial"): nichos diferentes têm riscos
   * diferentes — financeiro num, clínico/ético noutro.
   */
  restricao?: string;
}

export const PERFIL_POR_NICHO: Partial<Record<NicheKey, PerfilNicho>> = {
  "salao-beleza": {
    foco: "agendamento rápido de serviços (cabelo, unhas, estética) e dúvidas sobre valores",
    acaoPrincipal:
      "direcionar o cliente o quanto antes para o link de agendamento online — não prolongar a conversa com perguntas que o próprio link já resolve",
    tomAtendimento: "simpático, ágil e direto",
  },
  "clinica-alto-padrao": {
    foco:
      "acolhimento e triagem de leads de procedimentos estéticos/médicos de alto ticket (estética avançada, " +
      "odontologia, harmonização, especialistas), a qualquer hora — nenhum paciente pode ficar sem resposta " +
      "por causa do horário",
    acaoPrincipal:
      "qualificar com o protocolo estruturado abaixo e agendar uma consulta de avaliação presencial — nunca " +
      "estimar preço, diagnosticar ou prometer resultado de procedimento sem avaliação presencial",
    tomAtendimento: "refinado, exclusivo, acolhedor e consultivo — nunca clínico/frio",
    protocoloQualificacao:
      "Conduza o acolhimento de forma polida e conversacional (nunca como uma triagem fria) até reunir: " +
      "(1) queixa principal, na própria descrição do paciente; (2) objetivo do paciente com o procedimento " +
      "(estético, funcional, ambos); (3) se já realizou avaliação ou procedimento semelhante antes. Nunca " +
      "ofereça diagnóstico, estimativa de resultado ou orçamento fechado — direcione sempre para uma avaliação " +
      "presencial com o especialista. Se o paciente confirmar o agendamento, informe que a equipe dará " +
      "continuidade com o resumo já levantado — não repita perguntas que o paciente já respondeu.",
    restricao:
      "Nunca forneça diagnóstico médico, nunca prometa ou garanta resultado estético, e nunca informe orçamento " +
      "fechado de procedimento invasivo — essas decisões exigem avaliação presencial com o especialista. Quando " +
      "perguntado sobre resultado ou preço, explique que depende da avaliação presencial e direcione o " +
      "agendamento.",
  },
  "construtora-imobiliaria": {
    foco:
      "resposta imediata a compradores/locatários de imóveis de alto padrão, inclusive leads noturnos/madrugada " +
      "(comuns em capitais buscando imóveis em destinos como a Praia Brava, em Balneário Camboriú) — nenhum lead " +
      "pode ficar sem resposta por causa do horário",
    acaoPrincipal:
      "qualificar o lead com o protocolo estruturado abaixo e direcionar ao corretor de plantão com um resumo " +
      "formatado da necessidade",
    tomAtendimento: "consultivo, refinado e com senso de urgência na resposta — nunca apressado ou robótico",
    protocoloQualificacao:
      "Conduza a qualificação de forma polida e conversacional (nunca como um formulário) até reunir: " +
      "(1) faixa de orçamento, em termos aproximados (ex.: \"até 800 mil\", \"entre 1 e 1,5 milhão\") — nunca " +
      "peça nem repita um valor exato em R$; (2) metragem ou número de quartos desejado; (3) prazo de decisão " +
      "(imediato, poucos meses, sem pressa). Se o lead pedir para agendar uma visita presencial, confirme o " +
      "interesse e informe que um corretor dará continuidade com os detalhes já levantados — não repita " +
      "perguntas que o lead já respondeu.",
    restricao:
      "Nunca informe valor de tabela exato, percentual de desconto ou condição de parcelamento/financiamento — " +
      "essas informações exigem validação prévia da diretoria. Quando perguntado sobre preço, responda em faixas " +
      "aproximadas e direcione a negociação final ao corretor humano.",
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

  let contexto =
    `Nicho do negócio: foco em ${perfil.foco}. ` +
    `Ação principal esperada ao final do atendimento: ${perfil.acaoPrincipal}. ` +
    `Tom de atendimento: ${perfil.tomAtendimento}.`;

  if (perfil.protocoloQualificacao) {
    contexto += ` Protocolo de qualificação: ${perfil.protocoloQualificacao}`;
  }
  if (perfil.restricao) {
    contexto += ` Restrição: ${perfil.restricao}`;
  }

  return contexto;
}
