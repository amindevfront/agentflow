// Relatório de Prontidão Internacional (GDPR — União Europeia — e Privacidade
// nos EUA) — par da Expansão Enterprise Global, mesmo racional de
// `@/lib/lgpdReadiness`/`@/lib/aiActReadiness`.
//
// Honestidade de escopo (Artigo IV — No Invention), idêntica à do módulo de
// LGPD: NUNCA declara "o AgentFlow está em conformidade com GDPR/CCPA" —
// conformidade é do controlador/business (o cliente), nunca do fornecedor de
// software sozinho. O que estes dois avaliadores verificam, com dados reais
// e auditáveis, são os CONTROLES TÉCNICOS que o AgentFlow já oferece e que
// mapeiam diretamente a obrigações de cada regime.
//
// Por que GDPR e "US Privacy" (nunca "CCPA" solto) são módulos separados, não
// um genérico: `@/lib/jurisdiction.ts` já documenta por que "CCPA" nunca é um
// rótulo seguro de usar sozinho — é uma lei ESTADUAL da Califórnia, com
// escopo e limiares de faturamento próprios, não federal; outros estados dos
// EUA têm leis de privacidade próprias e diferentes (Virgínia/VCDPA,
// Colorado/CPA, etc.). Por isso o checklist americano aqui é deliberadamente
// SEM citação de artigo/seção específica — descreve direitos que aparecem,
// em alguma forma, na maioria dessas leis estaduais (acesso, exclusão,
// opt-out de venda/compartilhamento), sem fingir que "atende CCPA" é uma
// frase com significado único e verificável por software.
//
// Citações GDPR usadas (artigos estáveis desde 2018, sem mudança de numeração):
//   - Art. 30: registro das atividades de tratamento.
//   - Art. 32: segurança do tratamento (medidas técnicas e organizacionais).
//   - Art. 5(1)(c): minimização de dados.
//   - Art. 6: base legal do tratamento.
//   - Art. 37: designação do Encarregado de Proteção de Dados (DPO).
//   - Art. 35: Avaliação de Impacto sobre a Proteção de Dados (DPIA).
//   - Art. 33: notificação de violação à autoridade em até 72 horas.
//
// Puro e determinístico — mesmo padrão de `avaliarProntidaoLgpd`.

import type { AuditChainVerification } from "@/types";

export type StatusItemProntidaoInternacional = "atende" | "nao_atende" | "sem_dados" | "fora_do_escopo";

export interface ItemProntidaoInternacional {
  id: string;
  titulo: string;
  /** Referência legal concreta, ou `null` quando a citação específica varia demais entre jurisdições pra ser honesta aqui. */
  baseLegal: string | null;
  status: StatusItemProntidaoInternacional;
  detalhe: string;
}

export interface ProntidaoInternacionalResultado {
  itens: ItemProntidaoInternacional[];
  totalAtende: number;
  totalAvaliavelPorSoftware: number;
}

export interface AvaliarProntidaoInternacionalInput {
  totalEntradasAuditoria: number;
  /** `null` quando a verificação de integridade ainda não foi executada nesta sessão. */
  verificacaoCadeia: AuditChainVerification | null;
}

function calcularResultado(itens: ItemProntidaoInternacional[]): ProntidaoInternacionalResultado {
  const avaliaveis = itens.filter((item) => item.status !== "fora_do_escopo");
  const totalAtende = avaliaveis.filter((item) => item.status === "atende").length;
  return { itens, totalAtende, totalAvaliavelPorSoftware: avaliaveis.length };
}

export function avaliarProntidaoGdpr(input: AvaliarProntidaoInternacionalInput): ProntidaoInternacionalResultado {
  return calcularResultado([
    {
      id: "registro-tratamento",
      titulo: "Registro das atividades de tratamento",
      baseLegal: "GDPR, Art. 30",
      status: input.totalEntradasAuditoria > 0 ? "atende" : "sem_dados",
      detalhe:
        input.totalEntradasAuditoria > 0
          ? `${input.totalEntradasAuditoria} operação(ões) já registrada(s) automaticamente — mascaramentos, bloqueios, transbordos, acessos a credenciais.`
          : "Nenhuma operação registrada ainda neste workspace — o mecanismo existe, mas falta histórico para demonstrar.",
    },
    {
      id: "integridade-registro",
      titulo: "Integridade do registro verificada (hash-chain + HMAC)",
      baseLegal: "GDPR, Art. 32",
      status:
        input.verificacaoCadeia === null ? "sem_dados" : input.verificacaoCadeia.integra ? "atende" : "nao_atende",
      detalhe:
        input.verificacaoCadeia === null
          ? "Execute a verificação na aba Auditoria para confirmar que o registro não foi adulterado."
          : input.verificacaoCadeia.integra
            ? `${input.verificacaoCadeia.entradasVerificadas} entrada(s) verificada(s)${input.verificacaoCadeia.assinaturasVerificadas ? ", hashes e assinaturas HMAC conferem" : ", hashes conferem (assinatura ainda não conferida)"}.`
            : `${input.verificacaoCadeia.problemas.length} problema(s) de integridade detectado(s) — investigue antes de declarar prontidão.`,
    },
    {
      id: "minimizacao-dados",
      titulo: "Minimização de dados pessoais",
      baseLegal: "GDPR, Art. 5(1)(c)",
      status: "atende",
      detalhe:
        "100% dos payloads enviados a modelos de IA passam pelo mascaramento de PII (Shield-Layer) antes do processamento — controle técnico arquitetural, sempre ativo, não depende de configuração do cliente.",
    },
    {
      id: "seguranca-cofre",
      titulo: "Medidas técnicas e organizacionais de segurança",
      baseLegal: "GDPR, Art. 32",
      status: "atende",
      detalhe:
        "Credenciais e segredos ficam no Cofre Zero-Trust, cifrados em repouso (AES-256-GCM, envelope encryption) — nenhum membro do workspace lê um segredo em claro.",
    },
    {
      id: "canal-comunicacao-titular",
      titulo: "Canal de comunicação com o titular dos dados",
      baseLegal: null,
      status: "atende",
      detalhe: "A Neural Inbox já é um canal real e monitorado de comunicação com o titular dos dados.",
    },
    {
      id: "base-legal",
      titulo: "Base legal do tratamento definida",
      baseLegal: "GDPR, Art. 6",
      status: "fora_do_escopo",
      detalhe: "Depende da operação concreta do cliente, não de uma configuração de software — exige avaliação jurídica própria.",
    },
    {
      id: "dpo",
      titulo: "Designação de Encarregado de Proteção de Dados (DPO), quando exigida",
      baseLegal: "GDPR, Art. 37",
      status: "fora_do_escopo",
      detalhe: "Decisão organizacional do cliente, condicionada ao volume/natureza do tratamento — não é algo que o software decide.",
    },
    {
      id: "dpia",
      titulo: "Avaliação de Impacto sobre a Proteção de Dados (DPIA), quando exigida",
      baseLegal: "GDPR, Art. 35",
      status: "fora_do_escopo",
      detalhe: "Documento próprio do cliente — a decisão de quando é exigida é jurídica, não técnica.",
    },
    {
      id: "notificacao-violacao",
      titulo: "Notificação de violação de dados à autoridade em até 72 horas",
      baseLegal: "GDPR, Art. 33",
      status: "fora_do_escopo",
      detalhe:
        "Processo que só se aciona quando um incidente de fato ocorre — nenhum software pode declarar isso \"atendido\" preventivamente. A trilha de auditoria imutável ajuda a reconstruir rapidamente o que aconteceu, a favor do prazo de 72h, mas a notificação em si é um ato do controlador.",
    },
  ]);
}

export function avaliarProntidaoUsPrivacy(
  input: AvaliarProntidaoInternacionalInput
): ProntidaoInternacionalResultado {
  return calcularResultado([
    {
      id: "registro-operacoes",
      titulo: "Registro auditável das operações de tratamento de dados",
      baseLegal: null,
      status: input.totalEntradasAuditoria > 0 ? "atende" : "sem_dados",
      detalhe:
        input.totalEntradasAuditoria > 0
          ? `${input.totalEntradasAuditoria} operação(ões) já registrada(s) automaticamente — base para responder uma solicitação de acesso do consumidor com dados reais, não suposição.`
          : "Nenhuma operação registrada ainda neste workspace — o mecanismo existe, mas falta histórico para demonstrar.",
    },
    {
      id: "integridade-registro",
      titulo: "Integridade do registro verificada (hash-chain + HMAC)",
      baseLegal: null,
      status:
        input.verificacaoCadeia === null ? "sem_dados" : input.verificacaoCadeia.integra ? "atende" : "nao_atende",
      detalhe:
        input.verificacaoCadeia === null
          ? "Execute a verificação na aba Auditoria para confirmar que o registro não foi adulterado."
          : input.verificacaoCadeia.integra
            ? `${input.verificacaoCadeia.entradasVerificadas} entrada(s) verificada(s)${input.verificacaoCadeia.assinaturasVerificadas ? ", hashes e assinaturas HMAC conferem" : ", hashes conferem (assinatura ainda não conferida)"}.`
            : `${input.verificacaoCadeia.problemas.length} problema(s) de integridade detectado(s) — investigue antes de declarar prontidão.`,
    },
    {
      id: "minimizacao-dados",
      titulo: "Minimização de informação pessoal processada",
      baseLegal: null,
      status: "atende",
      detalhe:
        "100% dos payloads enviados a modelos de IA passam pelo mascaramento de PII (Shield-Layer) antes do processamento — reduz diretamente o volume de \"personal information\" exposta, princípio presente na maioria das leis estaduais de privacidade dos EUA.",
    },
    {
      id: "seguranca-cofre",
      titulo: "Salvaguardas de segurança razoáveis sobre dados sensíveis",
      baseLegal: null,
      status: "atende",
      detalhe:
        "Credenciais e segredos ficam no Cofre Zero-Trust, cifrados em repouso (AES-256-GCM, envelope encryption) — nenhum membro do workspace lê um segredo em claro.",
    },
    {
      id: "canal-comunicacao-consumidor",
      titulo: "Canal de comunicação com o consumidor",
      baseLegal: null,
      status: "atende",
      detalhe: "A Neural Inbox já é um canal real e monitorado de comunicação com o consumidor.",
    },
    {
      id: "direito-saber",
      titulo: "Direito do consumidor de saber quais dados são coletados (\"right to know\")",
      baseLegal: null,
      status: "fora_do_escopo",
      detalhe:
        "A divulgação do que é coletado e por quê é feita na política de privacidade do CLIENTE, não decidida pelo software — este aplicativo não escolhe o que o negócio do cliente coleta.",
    },
    {
      id: "direito-exclusao",
      titulo: "Processo de atendimento a solicitação de exclusão (\"right to delete\")",
      baseLegal: null,
      status: "fora_do_escopo",
      detalhe:
        "Diferente do reset de ambiente de teste (Configurações → Zona de risco, que zera dados de PRÁTICA do workspace inteiro), uma solicitação de exclusão de um consumidor específico é um processo de atendimento que o cliente precisa operar — não há automação de \"apagar uma pessoa\" nesta versão.",
    },
    {
      id: "opt-out-venda",
      titulo: "Mecanismo de opt-out de venda/compartilhamento de informação pessoal",
      baseLegal: null,
      status: "fora_do_escopo",
      detalhe:
        "O AgentFlow não vende nem compartilha dados de clientes com terceiros — mas se o NEGÓCIO do cliente vende dados por fora, o mecanismo de opt-out é dele, não do software.",
    },
    {
      id: "notificacao-violacao-eua",
      titulo: "Notificação de violação de dados (prazo varia por estado)",
      baseLegal: null,
      status: "fora_do_escopo",
      detalhe:
        "Processo que só se aciona quando um incidente de fato ocorre, com prazo e destinatário que variam por estado — a trilha de auditoria imutável ajuda a reconstruir o que aconteceu, mas a notificação em si é um ato do controlador.",
    },
  ]);
}
