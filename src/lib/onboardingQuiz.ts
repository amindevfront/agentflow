// Onboarding Cognitivo — Quiz dinâmico de setup por nicho.
//
// Três perguntas estratégicas moldam a configuração inicial do workspace:
//
//   a) Nicho/setor         → reaproveita `NICHE_PRESETS` (@/lib/niches) para
//                             sugerir playbooks — já existente, não duplicado.
//   b) Maior ralo de caixa → mapeado para ajustes concretos de política de
//                             guardrail (`PAIN_POINT_PRESETS`), aplicados via
//                             `Workspace.guardrailOverrides` (ver
//                             `GuardrailInspectorPanel`, que os lê como
//                             `sobrescritas` ao resolver a política padrão).
//                             Duas categorias não têm módulo dedicado nesta
//                             versão — o preset diz isso explicitamente em
//                             vez de fingir cobertura.
//   c) Região/idioma       → `REGIAO_PRESETS` define moeda e regime de
//                             encargos padrão do Tax Shield (BRL/CLT vs.
//                             USD/Payroll), além do regime legal de
//                             referência exibido na UI (LGPD vs. CCPA/GDPR).
//
// A derivação (`derivarAjustesDoQuiz`) é pura e testável sem Firestore; só
// `salvarRespostaQuiz` toca a rede, e o faz com cuidado: lê o `RoiConfig`
// atual antes de salvar, para nunca sobrescrever `custoHoraOperadorBrl` e
// as composições CLT/Payroll já customizadas pelo workspace com os valores
// padrão (ver a mesma ressalva em `salvarRoiConfig`, em `@/lib/roi`).

import type {
  GuardrailPolicy,
  Moeda,
  NicheKey,
  PainPointKey,
  RegiaoOperacao,
  RegimeEncargos,
  RoiConfig,
  Workspace,
} from "@/types";
import { NICHE_PRESETS } from "./niches";
import { DEFAULT_WORKSPACE_ID, patchWorkspace } from "./firestore";
import { lerRoiConfig, salvarRoiConfig } from "./roi";

export interface PainPointPreset {
  key: PainPointKey;
  label: string;
  descricao: string;
  guardrailOverrides: Partial<GuardrailPolicy>;
}

export const PAIN_POINT_PRESETS: Record<PainPointKey, PainPointPreset> = {
  "whatsapp-fora-horario": {
    key: "whatsapp-fora-horario",
    label: "Atrito no WhatsApp fora do horário",
    descricao:
      'Já endereçado pelo indicador "Receita recuperada de madrugada" na Neural Inbox — nenhum ajuste de guardrail necessário.',
    guardrailOverrides: {},
  },
  "no-show-agendamento": {
    key: "no-show-agendamento",
    label: "No-shows de agendamento",
    descricao:
      "Esta versão não tem um módulo dedicado de agendamento — acompanhe confirmações e reagendamentos via Fluxos ou Neural Inbox.",
    guardrailOverrides: {},
  },
  "passivo-clt-overtime": {
    key: "passivo-clt-overtime",
    label: "Medo de passivo trabalhista (CLT/overtime)",
    descricao:
      "Eleva violações de severidade média a revisão humana obrigatória — reduz o risco de uma promessa indevida do Compliance Preventivo passar sem revisão.",
    guardrailOverrides: {
      acaoPorSeveridade: {
        info: "permitido",
        baixa: "mascarado",
        media: "transbordo",
        alta: "transbordo",
        critica: "bloqueado",
      },
    },
  },
  "vazamento-pii": {
    key: "vazamento-pii",
    label: "Vazamento de dados pessoais (PII)",
    descricao:
      "Qualquer valor financeiro passa a ser tratado como sensível (limiar zerado), e PII reaparecendo na saída do modelo sempre bloqueia.",
    guardrailOverrides: {
      limiarValorSensivel: 0,
      bloquearPiiNaSaida: true,
    },
  },
  outro: {
    key: "outro",
    label: "Outro / nenhum em especial",
    descricao: "Sem ajuste automático de guardrail — a política padrão do workspace permanece em vigor.",
    guardrailOverrides: {},
  },
};

export const PAIN_POINT_ORDER: PainPointKey[] = [
  "whatsapp-fora-horario",
  "no-show-agendamento",
  "passivo-clt-overtime",
  "vazamento-pii",
  "outro",
];

export interface RegiaoPreset {
  key: RegiaoOperacao;
  label: string;
  descricao: string;
  moedaPadrao: Moeda;
  regimeEncargosPadrao: RegimeEncargos;
}

export const REGIAO_PRESETS: Record<RegiaoOperacao, RegiaoPreset> = {
  br: {
    key: "br",
    label: "Português · Brasil",
    descricao: "Conformidade de referência: LGPD. Moeda padrão: Real (R$) · encargos CLT.",
    moedaPadrao: "BRL",
    regimeEncargosPadrao: "clt-br",
  },
  global: {
    key: "global",
    label: "English · Global (US/UK)",
    descricao: "Reference compliance: CCPA/GDPR. Default currency: US Dollar (US$) · Payroll Tax.",
    moedaPadrao: "USD",
    regimeEncargosPadrao: "payroll-us-uk",
  },
};

export const REGIAO_ORDER: RegiaoOperacao[] = ["br", "global"];

export interface RespostaQuizOnboarding {
  setor: NicheKey;
  ralogDeCaixa: PainPointKey;
  regiaoOperacao: RegiaoOperacao;
}

export interface AjustesDoQuiz {
  workspacePatch: Pick<
    Workspace,
    "setor" | "playbooksSugeridos" | "regiaoOperacao" | "ralogDeCaixa" | "guardrailOverrides" | "quizRespondidoEm"
  >;
  roiConfigPatch: Pick<RoiConfig, "moedaExibicao" | "regimeEncargos">;
}

/**
 * Deriva, de forma pura, o que o quiz muda no workspace e no `RoiConfig`.
 * Separado de `salvarRespostaQuiz` para ser testável sem Firestore — dado o
 * mesmo input, o resultado é sempre o mesmo (mesma garantia de `calcularRoi`).
 */
export function derivarAjustesDoQuiz(resposta: RespostaQuizOnboarding, agora = new Date()): AjustesDoQuiz {
  const regiao = REGIAO_PRESETS[resposta.regiaoOperacao];
  const dorDeCaixa = PAIN_POINT_PRESETS[resposta.ralogDeCaixa];

  return {
    workspacePatch: {
      setor: resposta.setor,
      playbooksSugeridos: NICHE_PRESETS[resposta.setor].playbooksSugeridos,
      regiaoOperacao: resposta.regiaoOperacao,
      ralogDeCaixa: resposta.ralogDeCaixa,
      guardrailOverrides: dorDeCaixa.guardrailOverrides,
      quizRespondidoEm: agora.toISOString(),
    },
    roiConfigPatch: {
      moedaExibicao: regiao.moedaPadrao,
      regimeEncargos: regiao.regimeEncargosPadrao,
    },
  };
}

/**
 * Persiste a resposta do quiz.
 *
 * Lê o `RoiConfig` atual antes de salvar e mescla só `moedaExibicao`/
 * `regimeEncargos` por cima dele — nunca grava um `RoiConfig` parcial
 * diretamente (`salvarRoiConfig` reconstituiria os campos ausentes a partir
 * dos padrões de fábrica, apagando customizações já feitas pelo workspace,
 * como `custoHoraOperadorBrl` ou as composições CLT/Payroll ajustadas).
 */
export async function salvarRespostaQuiz(
  resposta: RespostaQuizOnboarding,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<AjustesDoQuiz> {
  const ajustes = derivarAjustesDoQuiz(resposta);
  const configAtual = await lerRoiConfig(workspaceId);

  await Promise.all([
    patchWorkspace(workspaceId, ajustes.workspacePatch),
    salvarRoiConfig({ ...configAtual, ...ajustes.roiConfigPatch }, workspaceId),
  ]);

  return ajustes;
}
