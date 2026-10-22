// Políticas de guardrail: o que é tolerado em cada nó do fluxo.
//
// Uma política é um dado, não código. Isso permite que a mesma build atenda um
// nó de triagem permissivo e um nó de emissão de nota fiscal intransigente, e
// que a configuração vigente no momento de uma decisão seja auditável.

import type { GuardrailPolicy, GuardrailSeverity, GuardrailVerdict } from "@/types";

export const ORDEM_SEVERIDADE: GuardrailSeverity[] = ["info", "baixa", "media", "alta", "critica"];

export function pesoSeveridade(severidade: GuardrailSeverity): number {
  return ORDEM_SEVERIDADE.indexOf(severidade);
}

export function maiorSeveridade(severidades: GuardrailSeverity[]): GuardrailSeverity {
  return severidades.reduce<GuardrailSeverity>(
    (maior, atual) => (pesoSeveridade(atual) > pesoSeveridade(maior) ? atual : maior),
    "info"
  );
}

const ORDEM_VEREDITO: GuardrailVerdict[] = ["permitido", "mascarado", "transbordo", "bloqueado"];

/** Vereditos são escalonados: o mais restritivo sempre prevalece. */
export function vereditoMaisRestritivo(a: GuardrailVerdict, b: GuardrailVerdict): GuardrailVerdict {
  return ORDEM_VEREDITO.indexOf(a) >= ORDEM_VEREDITO.indexOf(b) ? a : b;
}

/**
 * Política padrão — aplicada a qualquer nó sem configuração própria.
 *
 * Calibrada para ser utilizável: mascara PII sempre, mas só interrompe a
 * execução diante de evidência forte. Um guardrail que bloqueia demais é
 * desligado pela operação, e um guardrail desligado não protege nada.
 */
export const POLITICA_PADRAO: GuardrailPolicy = {
  id: "padrao",
  critico: false,
  mascararPii: true,
  piiPermitida: [],
  // Valores abaixo de R$ 1.000 raramente identificam alguém isoladamente.
  limiarValorSensivel: 1000,
  bloquearPiiNaSaida: true,
  exigirFundamentacao: false,
  minGroundedness: 0.6,
  minConsistencia: 0.6,
  amostrasConsistencia: 1,
  maxRepeticaoNgram: 0.35,
  maxVisitasPorNo: 3,
  detectarPromptInjection: true,
  maxCaracteresPayload: 200_000,
  acaoPorSeveridade: {
    info: "permitido",
    baixa: "mascarado",
    media: "mascarado",
    alta: "transbordo",
    critica: "bloqueado",
  },
};

/**
 * Política para nós críticos — onde um erro tem custo irreversível
 * (pagamento, emissão fiscal, comunicação com cliente final, escrita em
 * sistema de registro).
 *
 * Diferenças centrais: exige fundamentação, coleta múltiplas amostras para
 * checagem estocástica e trata severidade média como motivo de transbordo.
 */
export const POLITICA_NO_CRITICO: GuardrailPolicy = {
  ...POLITICA_PADRAO,
  id: "no-critico",
  critico: true,
  limiarValorSensivel: 0,
  exigirFundamentacao: true,
  minGroundedness: 0.85,
  minConsistencia: 0.8,
  amostrasConsistencia: 3,
  maxRepeticaoNgram: 0.2,
  maxVisitasPorNo: 2,
  acaoPorSeveridade: {
    info: "permitido",
    baixa: "mascarado",
    media: "transbordo",
    alta: "transbordo",
    critica: "bloqueado",
  },
};

/** Política permissiva para sandbox e simulador — nunca para produção. */
export const POLITICA_SANDBOX: GuardrailPolicy = {
  ...POLITICA_PADRAO,
  id: "sandbox",
  critico: false,
  bloquearPiiNaSaida: false,
  acaoPorSeveridade: {
    info: "permitido",
    baixa: "mascarado",
    media: "mascarado",
    alta: "mascarado",
    critica: "transbordo",
  },
};

export const POLITICAS_PREDEFINIDAS: Record<string, GuardrailPolicy> = {
  padrao: POLITICA_PADRAO,
  "no-critico": POLITICA_NO_CRITICO,
  sandbox: POLITICA_SANDBOX,
};

const LIMITES_NUMERICOS: Array<{ campo: keyof GuardrailPolicy; min: number; max: number }> = [
  { campo: "limiarValorSensivel", min: 0, max: 1_000_000_000 },
  { campo: "minGroundedness", min: 0, max: 1 },
  { campo: "minConsistencia", min: 0, max: 1 },
  { campo: "amostrasConsistencia", min: 1, max: 7 },
  { campo: "maxRepeticaoNgram", min: 0, max: 1 },
  { campo: "maxVisitasPorNo", min: 1, max: 50 },
  // Piso utilizável, não 1: limitar a 1 caractere faria uma configuração
  // malformada bloquear todo payload, contrariando o propósito do limite.
  { campo: "maxCaracteresPayload", min: 1024, max: 5_000_000 },
];

function limitar(valor: number, min: number, max: number): number {
  if (!Number.isFinite(valor)) return min;
  return Math.min(max, Math.max(min, valor));
}

/**
 * Resolve a política efetiva de um nó.
 *
 * Toda configuração vinda do Firestore é tratada como entrada não confiável:
 * valores fora de faixa são limitados em vez de rejeitados, para que uma
 * configuração malformada nunca derrube a execução de um fluxo em produção —
 * ela apenas volta ao limite seguro mais próximo.
 */
export function resolverPolitica(
  base: GuardrailPolicy | string | undefined,
  sobrescritas: Partial<GuardrailPolicy> = {}
): GuardrailPolicy {
  const politicaBase =
    typeof base === "string" ? POLITICAS_PREDEFINIDAS[base] ?? POLITICA_PADRAO : base ?? POLITICA_PADRAO;

  const combinada: GuardrailPolicy = {
    ...politicaBase,
    ...sobrescritas,
    acaoPorSeveridade: {
      ...politicaBase.acaoPorSeveridade,
      ...(sobrescritas.acaoPorSeveridade ?? {}),
    },
    piiPermitida: sobrescritas.piiPermitida ?? politicaBase.piiPermitida,
  };

  for (const { campo, min, max } of LIMITES_NUMERICOS) {
    const atual = combinada[campo];
    if (typeof atual === "number") {
      (combinada[campo] as number) = limitar(atual, min, max);
    }
  }

  if (combinada.orcamentoTokens !== undefined) {
    combinada.orcamentoTokens = limitar(combinada.orcamentoTokens, 1, 100_000_000);
  }

  // Um nó crítico nunca herda tolerância de PII na saída, qualquer que seja a
  // sobrescrita: esse é o invariante que a política não pode negociar.
  if (combinada.critico) {
    combinada.bloquearPiiNaSaida = true;
  }

  return combinada;
}

/** Traduz a severidade observada em ação, segundo a política. */
export function acaoPara(politica: GuardrailPolicy, severidade: GuardrailSeverity): GuardrailVerdict {
  return politica.acaoPorSeveridade[severidade] ?? POLITICA_PADRAO.acaoPorSeveridade[severidade];
}
