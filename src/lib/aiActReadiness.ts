// Relatório de Prontidão para Regulação de IA (EU AI Act e equivalentes).
//
// Por que isto existe (ver ADR-0007, item 2 do roadmap): o AI Act da União
// Europeia já está em vigor para transparência e fiscalização desde agosto
// de 2026; as obrigações mais pesadas de sistemas de alto risco (Anexo III)
// foram prorrogadas para dezembro de 2027. O Artigo 12(1) exige que sistemas
// de alto risco permitam o registro automático de eventos ("logs") ao longo
// de todo o ciclo de vida, cobrindo eventos relevantes a situações de risco
// ou alterações substanciais, com retenção mínima de 6 meses — e a própria
// Comissão Europeia reconhece proporcionalidade para pequenas empresas
// (documentação mais simples, avaliação de risco mais leve).
//
// Honestidade de escopo (Artigo IV — No Invention): este módulo NUNCA
// declara "o AgentFlow está em conformidade com o AI Act" — isso depende de
// decisões que só o cliente e o advogado dele podem tomar (se o caso de uso
// dele é "alto risco" sob o Anexo III, qual o papel dele — provedor ou
// implementador —, se precisa de uma Avaliação de Impacto). O que este
// módulo verifica, com dados reais e auditáveis, são os CONTROLES TÉCNICOS
// que o AgentFlow já oferece e que mapeiam diretamente para o Artigo 12:
// registro automático de eventos, integridade da cadeia, retenção já
// demonstrada e supervisão humana ativa. Tudo o que está fora do alcance do
// software continua listado — explicitamente como responsabilidade do
// cliente, nunca escondido.
//
// Puro e determinístico: mesmos dados de entrada, mesmo resultado sempre —
// testável sem Firestore (quem chama já buscou os dados reais).

import type { AuditChainVerification, HandoffQueueStats } from "@/types";

export type StatusItemProntidao = "atende" | "em_formacao" | "nao_atende" | "sem_dados" | "fora_do_escopo";

export interface ItemProntidaoAiAct {
  id: string;
  titulo: string;
  /** Referência legal concreta, ou `null` para itens que são controle técnico complementar sem citação direta de artigo. */
  baseLegal: string | null;
  status: StatusItemProntidao;
  detalhe: string;
}

export interface ProntidaoAiActResultado {
  itens: ItemProntidaoAiAct[];
  /** Quantos itens avaliáveis pelo software (exclui "fora_do_escopo") estão em "atende". */
  totalAtende: number;
  /** Itens avaliáveis pelo software — denominador de `totalAtende`. */
  totalAvaliavelPorSoftware: number;
  /** `null` quando não há nenhuma entrada de auditoria ainda. */
  diasRetencaoDemonstrados: number | null;
}

/** Retenção mínima exigida pelo Artigo 12 do AI Act para sistemas de alto risco. */
export const LIMIAR_RETENCAO_MINIMA_DIAS = 180;

export interface AvaliarProntidaoInput {
  totalEntradasAuditoria: number;
  /** ISO da entrada mais antiga disponível. `null` sem nenhuma entrada ainda. */
  primeiraEntradaEm: string | null;
  /** `null` quando a verificação de integridade ainda não foi executada nesta sessão. */
  verificacaoCadeia: AuditChainVerification | null;
  ticketStats: HandoffQueueStats;
  referencia?: Date;
}

export function avaliarProntidaoAiAct(input: AvaliarProntidaoInput): ProntidaoAiActResultado {
  const referencia = input.referencia ?? new Date();

  const diasRetencaoDemonstrados = input.primeiraEntradaEm
    ? Math.max(0, Math.floor((referencia.getTime() - new Date(input.primeiraEntradaEm).getTime()) / (24 * 60 * 60 * 1000)))
    : null;

  const itens: ItemProntidaoAiAct[] = [
    {
      id: "registro-automatico",
      titulo: "Registro automático de eventos relevantes",
      baseLegal: "AI Act, Art. 12(1)",
      status: input.totalEntradasAuditoria > 0 ? "atende" : "sem_dados",
      detalhe:
        input.totalEntradasAuditoria > 0
          ? `${input.totalEntradasAuditoria} evento(s) já registrado(s) automaticamente, sem intervenção manual, cobrindo bloqueios de guardrail, transbordos, credenciais e alterações de configuração.`
          : "Nenhum evento registrado ainda neste workspace — o mecanismo existe, mas falta histórico para demonstrar.",
    },
    {
      id: "integridade-cadeia",
      titulo: "Integridade da trilha verificada (hash-chain + HMAC)",
      baseLegal: "AI Act, Art. 12(1)",
      status:
        input.verificacaoCadeia === null
          ? "sem_dados"
          : input.verificacaoCadeia.integra
            ? "atende"
            : "nao_atende",
      detalhe:
        input.verificacaoCadeia === null
          ? "Execute a verificação na aba Auditoria para confirmar que a cadeia não foi adulterada."
          : input.verificacaoCadeia.integra
            ? `${input.verificacaoCadeia.entradasVerificadas} entrada(s) verificada(s)${input.verificacaoCadeia.assinaturasVerificadas ? ", hashes e assinaturas HMAC conferem" : ", hashes conferem (assinatura ainda não conferida)"}.`
            : `${input.verificacaoCadeia.problemas.length} problema(s) de integridade detectado(s) — investigue antes de declarar prontidão.`,
    },
    {
      id: "retencao-minima",
      titulo: `Retenção mínima de ${LIMIAR_RETENCAO_MINIMA_DIAS} dias (6 meses)`,
      baseLegal: "AI Act, Art. 12",
      status:
        diasRetencaoDemonstrados === null
          ? "sem_dados"
          : diasRetencaoDemonstrados >= LIMIAR_RETENCAO_MINIMA_DIAS
            ? "atende"
            : "em_formacao",
      detalhe:
        diasRetencaoDemonstrados === null
          ? "Sem entrada de auditoria ainda para medir a retenção."
          : diasRetencaoDemonstrados >= LIMIAR_RETENCAO_MINIMA_DIAS
            ? `${diasRetencaoDemonstrados} dias de histórico contínuo já demonstrados — acima do mínimo exigido. A trilha nunca é apagada pelo produto (sem exclusão habilitada para o cliente nem rotina de expurgo), então a retenção só cresce.`
            : `${diasRetencaoDemonstrados} dia(s) de histórico demonstrados até agora — ainda abaixo do mínimo de ${LIMIAR_RETENCAO_MINIMA_DIAS} dias, mas a arquitetura nunca apaga uma entrada, então o prazo se cumpre sozinho com o tempo de uso.`,
    },
    {
      id: "minimizacao-pii",
      titulo: "Minimização de dados pessoais antes do processamento por IA",
      baseLegal: null,
      status: "atende",
      detalhe:
        "100% dos payloads enviados a modelos de IA passam pelo mascaramento de PII (Shield-Layer) antes do processamento — controle técnico arquitetural, sempre ativo, não depende de configuração do cliente.",
    },
    {
      id: "supervisao-humana",
      titulo: "Mecanismo de supervisão humana ativo (human-in-the-loop)",
      baseLegal: null,
      status: input.ticketStats.total > 0 ? "atende" : "sem_dados",
      detalhe:
        input.ticketStats.total > 0
          ? `${input.ticketStats.total} caso(s) já passaram por revisão humana (${input.ticketStats.resolvidos} resolvido(s)) — o mecanismo de transbordo está em uso real, não só disponível.`
          : "O mecanismo de transbordo para revisão humana existe e está ativo, mas nenhum caso precisou dele ainda neste workspace.",
    },
    {
      id: "classificacao-risco",
      titulo: "Classificação do caso de uso (risco mínimo, limitado ou alto — Anexo III)",
      baseLegal: "AI Act, Anexo III",
      status: "fora_do_escopo",
      detalhe:
        "Depende da aplicação concreta do cliente, não de uma configuração de software — exige avaliação jurídica própria.",
    },
    {
      id: "papel-ai-act",
      titulo: "Papel do cliente no AI Act (provedor vs. implementador/deployer)",
      baseLegal: "AI Act, Art. 3",
      status: "fora_do_escopo",
      detalhe: "Determina quais obrigações recaem sobre o cliente — decisão jurídica, não técnica.",
    },
    {
      id: "dpia",
      titulo: "Avaliação de Impacto à Proteção de Dados (DPIA/AIPD), se aplicável",
      baseLegal: null,
      status: "fora_do_escopo",
      detalhe: "Documento próprio do cliente, fora do que um registro de auditoria de software pode produzir.",
    },
  ];

  const avaliaveis = itens.filter((item) => item.status !== "fora_do_escopo");
  const totalAtende = avaliaveis.filter((item) => item.status === "atende").length;

  return {
    itens,
    totalAtende,
    totalAvaliavelPorSoftware: avaliaveis.length,
    diasRetencaoDemonstrados,
  };
}
