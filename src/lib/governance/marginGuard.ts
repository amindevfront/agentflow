// Motor de Pre-Deal Compliance & Margin Guard — estimador puro.
//
// Isomórfico: nenhuma dependência de Node ou Firestore aqui (a persistência
// e o selo de auditoria ficam em `./marginGuardAdmin`, SERVER-ONLY). Integra
// os Módulos Verticais de Imobiliário, Clínicas, Comércio Exterior/Logística
// B2B e E-commerce com a mesma Proteção de Margem e Conformidade
// Fiscal/Operacional, reaproveitando 100% do motor de guardrails existente
// (`@/lib/guardrails/consistency`) — este módulo só traduz uma violação já
// detectada em "quanto prejuízo isso evitou", para o indicador "Passivo &
// Multas Prevenidas (Risk Shield)" do Painel de Governança, do Relatório
// Executivo e do badge "Risco Evitado" da Neural Inbox.
//
// Honestidade do número (mesma regra de `@/lib/roi` e
// `@/lib/server/roiDashboard`): o valor nunca é inventado a partir do
// contexto da conversa — é uma tabela de referência FIXA e conservadora,
// documentada abaixo, nunca confiada de um campo que o cliente controla.
// Cada workspace deve recalibrar à sua própria exposição real (Artigo IV —
// No Invention).

import type { GuardrailRuleId, GuardrailViolation, RiscoPrevenidoEstimado } from "@/types";

/** Regras do Motor de Pre-Deal Compliance & Margin Guard — as únicas que alimentam este estimador. */
const REGRAS_RISK_SHIELD: readonly GuardrailRuleId[] = [
  "informalidade-fiscal-nao-autorizada",
  "desconto-acima-limite-sem-aprovacao",
];

/**
 * Valor estimado de prejuízo evitado (R$) por OCORRÊNCIA bloqueada, por
 * regra — valores de partida conservadores (mesmo espírito de
 * `MINUTOS_ECONOMIZADOS_POR_ORIGEM` em `@/lib/server/backOfficeRoi` e
 * `VALOR_MEDIO_PIPELINE_PADRAO_BRL` em `@/lib/server/roiDashboard`):
 *
 *  - `informalidade-fiscal-nao-autorizada`: referência de multa/autuação por
 *    omissão de receita em fiscalização de rotina (ordem de grandeza de um
 *    auto de infração simples, não um processo de grande porte) — cada
 *    workspace deve recalibrar ao seu próprio porte/regime tributário.
 *  - `desconto-acima-limite-sem-aprovacao`: referência de margem erodida por
 *    uma única venda com desconto fora da faixa configurada, em um ticket
 *    médio de porte médio-alto (compatível com os nichos que ligam este
 *    guardrail: Imobiliário, Clínicas, Comércio Exterior/Logística B2B,
 *    E-commerce de alto ticket).
 */
export const VALOR_ESTIMADO_PREJUIZO_POR_REGRA_BRL: Record<
  "informalidade-fiscal-nao-autorizada" | "desconto-acima-limite-sem-aprovacao",
  number
> = {
  "informalidade-fiscal-nao-autorizada": 15_000,
  "desconto-acima-limite-sem-aprovacao": 3_000,
};

function ehRegraRiskShield(regra: GuardrailRuleId): regra is keyof typeof VALOR_ESTIMADO_PREJUIZO_POR_REGRA_BRL {
  return (REGRAS_RISK_SHIELD as readonly string[]).includes(regra);
}

/**
 * Estima o prejuízo evitado por um conjunto de violações — função pura,
 * mesma garantia de `calcularRoi` (`@/lib/roi`): dado o mesmo input, o
 * resultado é sempre idêntico e auditável. Devolve `null` quando nenhuma
 * violação pertence ao Motor de Pre-Deal Compliance & Margin Guard — a
 * ausência do campo `riscoPrevenido` no ticket (ver `HandoffTicket`) já
 * comunica isso, sem precisar de um valor zero artificial.
 */
export function estimarRiscoPrevenido(violacoes: GuardrailViolation[]): RiscoPrevenidoEstimado | null {
  const relevantes = violacoes.filter((v) => ehRegraRiskShield(v.regra));
  if (relevantes.length === 0) return null;

  // Soma por REGRA única, não por violação: duas violações da mesma regra no
  // mesmo bloqueio (ex.: "sem nota" + "por fora" na mesma frase) são o MESMO
  // incidente de informalidade fiscal, não dois — contar cada padrão de
  // léxico separadamente infla o número sem corresponder a um prejuízo real
  // adicional (mesma disciplina de "Honestidade do número" do resto do módulo).
  const regras = [...new Set(relevantes.map((v) => v.regra))] as Array<
    keyof typeof VALOR_ESTIMADO_PREJUIZO_POR_REGRA_BRL
  >;
  const categorias = [...new Set(relevantes.map((v) => v.mensagem))];
  const prejuizoEstimadoBrl = regras.reduce((acc, regra) => acc + VALOR_ESTIMADO_PREJUIZO_POR_REGRA_BRL[regra], 0);

  return { regras, categorias, prejuizoEstimadoBrl };
}
