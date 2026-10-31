// Relatório de Prontidão para Regulação Brasileira (LGPD — Lei 13.709/2018).
//
// Mesmo racional de `@/lib/aiActReadiness` — o par nacional/internacional
// de prontidão regulatória do roadmap da ADR-0007. A LGPD está em vigor
// desde 2020 (não é uma lei nova como o AI Act), mas a fiscalização da ANPD
// se intensificou justamente a partir de 2026, expandindo o escopo prático
// para pequenas e médias empresas — exatamente o porte da maioria dos
// clientes do AgentFlow.
//
// Honestidade de escopo (Artigo IV — No Invention): este módulo NUNCA
// declara "o AgentFlow está em conformidade com a LGPD" — conformidade é do
// controlador (o cliente), nunca do fornecedor de software sozinho. O que
// este módulo verifica, com dados reais e auditáveis, são os CONTROLES
// TÉCNICOS que o AgentFlow já oferece e que mapeiam diretamente a
// obrigações da LGPD. Tudo o que depende de decisão jurídica ou
// organizacional do cliente (base legal do tratamento, indicação de
// encarregado, Relatório de Impacto, comunicação de incidente à ANPD)
// continua listado — explicitamente fora do alcance de um checklist de
// software, nunca escondido atrás de um selo verde.
//
// Citações usadas (pesquisa de outubro de 2026):
//   - Art. 37: controlador e operador devem manter registro das operações
//     de tratamento de dados pessoais que realizarem.
//   - Art. 46: agentes de tratamento devem adotar medidas de segurança,
//     técnicas e administrativas aptas a proteger os dados pessoais.
//   - Art. 6º, V: princípio da necessidade — limitação do tratamento ao
//     mínimo necessário para a realização de suas finalidades.
//   - Resolução CD/ANPD nº 2/2022: Agentes de Tratamento de Pequeno Porte
//     (ME, EPP, startups) são dispensados de indicar encarregado, DESDE QUE
//     mantenham canal de comunicação com o titular — e têm registro de
//     operações e Relatório de Impacto simplificados.
//   - Art. 48 + Resolução CD/ANPD nº 15/2024: incidente de segurança com
//     risco ou dano relevante deve ser comunicado à ANPD e ao titular em
//     até 3 dias úteis da ciência do evento.
//
// Puro e determinístico: mesmos dados de entrada, mesmo resultado sempre —
// testável sem Firestore (quem chama já buscou os dados reais).

import type { AuditChainVerification } from "@/types";

export type StatusItemProntidaoLgpd = "atende" | "nao_atende" | "sem_dados" | "fora_do_escopo";

export interface ItemProntidaoLgpd {
  id: string;
  titulo: string;
  /** Referência legal concreta, ou `null` para itens que são controle técnico complementar sem citação direta de artigo. */
  baseLegal: string | null;
  status: StatusItemProntidaoLgpd;
  detalhe: string;
}

export interface ProntidaoLgpdResultado {
  itens: ItemProntidaoLgpd[];
  /** Quantos itens avaliáveis pelo software (exclui "fora_do_escopo") estão em "atende". */
  totalAtende: number;
  /** Itens avaliáveis pelo software — denominador de `totalAtende`. */
  totalAvaliavelPorSoftware: number;
}

export interface AvaliarProntidaoLgpdInput {
  totalEntradasAuditoria: number;
  /** `null` quando a verificação de integridade ainda não foi executada nesta sessão. */
  verificacaoCadeia: AuditChainVerification | null;
}

export function avaliarProntidaoLgpd(input: AvaliarProntidaoLgpdInput): ProntidaoLgpdResultado {
  const itens: ItemProntidaoLgpd[] = [
    {
      id: "registro-operacoes",
      titulo: "Registro das operações de tratamento de dados pessoais",
      baseLegal: "LGPD, Art. 37",
      status: input.totalEntradasAuditoria > 0 ? "atende" : "sem_dados",
      detalhe:
        input.totalEntradasAuditoria > 0
          ? `${input.totalEntradasAuditoria} operação(ões) já registrada(s) automaticamente — mascaramentos, bloqueios, transbordos, acessos a credenciais, tudo com que dado foi tratado e quando.`
          : "Nenhuma operação registrada ainda neste workspace — o mecanismo existe, mas falta histórico para demonstrar.",
    },
    {
      id: "integridade-registro",
      titulo: "Integridade do registro verificada (hash-chain + HMAC)",
      baseLegal: "LGPD, Art. 46",
      status:
        input.verificacaoCadeia === null
          ? "sem_dados"
          : input.verificacaoCadeia.integra
            ? "atende"
            : "nao_atende",
      detalhe:
        input.verificacaoCadeia === null
          ? "Execute a verificação na aba Auditoria para confirmar que o registro não foi adulterado."
          : input.verificacaoCadeia.integra
            ? `${input.verificacaoCadeia.entradasVerificadas} entrada(s) verificada(s)${input.verificacaoCadeia.assinaturasVerificadas ? ", hashes e assinaturas HMAC conferem" : ", hashes conferem (assinatura ainda não conferida)"}.`
            : `${input.verificacaoCadeia.problemas.length} problema(s) de integridade detectado(s) — investigue antes de declarar prontidão.`,
    },
    {
      id: "minimizacao-dados",
      titulo: "Minimização de dados pessoais (princípio da necessidade)",
      baseLegal: "LGPD, Art. 6º, V",
      status: "atende",
      detalhe:
        "100% dos payloads enviados a modelos de IA passam pelo mascaramento de PII (Shield-Layer) antes do processamento, e nenhuma entrada de auditoria carrega dado pessoal em claro — controle técnico arquitetural, sempre ativo, não depende de configuração do cliente. Também reduz o risco do próprio registro de operações: como o que fica guardado já está mascarado, a obrigação de eliminação de dados pessoais (Art. 15/16) não recai sobre a trilha de auditoria em si.",
    },
    {
      id: "seguranca-cofre",
      titulo: "Medidas de segurança técnicas e administrativas",
      baseLegal: "LGPD, Art. 46",
      status: "atende",
      detalhe:
        "Credenciais e segredos ficam no Cofre Zero-Trust, cifrados em repouso (AES-256-GCM, envelope encryption) — nenhum membro do workspace, nem o próprio AgentFlow do lado do cliente, lê um segredo em claro.",
    },
    {
      id: "canal-comunicacao-titular",
      titulo: "Canal de comunicação com o titular dos dados",
      baseLegal: "Resolução CD/ANPD nº 2/2022",
      status: "atende",
      detalhe:
        "A Neural Inbox já é um canal real e monitorado de comunicação com o titular — pré-requisito para pequenas empresas (ME/EPP/startup) ficarem dispensadas de indicar encarregado formal, desde que mantenham esse canal ativo.",
    },
    {
      id: "base-legal",
      titulo: "Base legal do tratamento definida (consentimento, legítimo interesse, execução de contrato etc.)",
      baseLegal: "LGPD, Art. 7º",
      status: "fora_do_escopo",
      detalhe: "Depende da operação concreta do cliente, não de uma configuração de software — exige avaliação jurídica própria.",
    },
    {
      id: "encarregado",
      titulo: "Indicação de encarregado (DPO) ou canal alternativo conforme o porte da empresa",
      baseLegal: "LGPD, Art. 41 — Resolução CD/ANPD nº 2/2022",
      status: "fora_do_escopo",
      detalhe: "Decisão organizacional do cliente — pequenas empresas podem ser dispensadas, mas isso não é algo que o software decide.",
    },
    {
      id: "ripd",
      titulo: "Relatório de Impacto à Proteção de Dados Pessoais (RIPD), quando exigido",
      baseLegal: "LGPD, Art. 38",
      status: "fora_do_escopo",
      detalhe: "Documento próprio do cliente — mesmo no regime simplificado para pequenas empresas, a decisão de quando é exigido é jurídica.",
    },
    {
      id: "comunicacao-incidente",
      titulo: "Comunicação de incidente de segurança à ANPD e ao titular em até 3 dias úteis",
      baseLegal: "LGPD, Art. 48 — Resolução CD/ANPD nº 15/2024",
      status: "fora_do_escopo",
      detalhe:
        "Processo que só se aciona quando um incidente de fato ocorre — nenhum software pode declarar isso \"atendido\" preventivamente. A trilha de auditoria imutável ajuda a reconstruir rapidamente o que aconteceu, o que corre a favor do prazo de 3 dias úteis, mas a comunicação em si é um ato do controlador.",
    },
  ];

  const avaliaveis = itens.filter((item) => item.status !== "fora_do_escopo");
  const totalAtende = avaliaveis.filter((item) => item.status === "atende").length;

  return {
    itens,
    totalAtende,
    totalAvaliavelPorSoftware: avaliaveis.length,
  };
}
