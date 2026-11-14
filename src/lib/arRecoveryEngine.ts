// Gaveta de Back-office — AR Recovery Engine (Motor de Cobrança e
// Follow-up de Papelada).
//
// Núcleo PURO e ISOMÓRFICO (sem Firestore, sem Admin SDK) — roda tanto no
// painel de status (`ArRecoveryStatusPanel`, "use client") quanto no
// processador de tick Admin SDK (`@/lib/server/arRecoveryEngine`, que
// importa estas funções). Mesma separação de `@/modules/registry` (puro) ×
// `@/modules/registry.client` (UI) — aqui a fronteira é "decisão" × "IO".
//
// "Mensagens humanizadas via HITL": o motor NUNCA envia a mensagem de
// cobrança diretamente ao devedor. Dentro do limite de tentativas
// automáticas, o documento é marcado "em-cobranca" e o ganho operacional é
// creditado — e `gerarMensagemCobrancaHumanizada` fica disponível para o
// operador revisar/copiar/disparar manualmente no `ArRecoveryStatusPanel`
// (painel standalone de Governança — esta gaveta tem `temInboxExtras: false`,
// então NUNCA é a Neural Inbox que mostra isto), mesmo espírito de
// `SugestaoGhostCoach` ("nunca enviada automaticamente ao cliente — é um
// rascunho para o operador revisar"). Esgotadas as tentativas, o motor
// ESCALA para um ticket HITL real (`cobranca-documento-pendente`), para
// decisão humana.

import type { DecisaoArRecovery, DocumentoPendente, NivelUrgenciaCobranca, ResumoExecutivoCobranca } from "@/types";
import type { Idioma } from "@/lib/jurisdiction";

/** Dias de atraso em relação ao vencimento — negativo significa "ainda não venceu". */
export function calcularDiasAtraso(documento: Pick<DocumentoPendente, "vencimentoEm">, referencia = new Date()): number {
  const vencimento = new Date(documento.vencimentoEm).getTime();
  if (!Number.isFinite(vencimento)) return 0;
  return Math.floor((referencia.getTime() - vencimento) / (24 * 60 * 60 * 1000));
}

/**
 * Classifica a urgência por dias de atraso — tiers progressivos, mesmo
 * racional de `severidadePorHoras` (`@/lib/shipments`): o tom da cobrança
 * endurece conforme o atraso cresce, nunca no primeiro contato.
 */
export function classificarUrgenciaCobranca(diasAtraso: number): NivelUrgenciaCobranca {
  if (diasAtraso < 0) return "no-prazo";
  if (diasAtraso <= 7) return "atencao";
  if (diasAtraso <= 30) return "atraso";
  return "critico";
}

/**
 * Mensagem humanizada SUGERIDA — tom progressivo por urgência, nunca uma
 * promessa de perdão/desconto/renegociação (isso é exatamente o que o
 * Guardrail de Proteção de Caixa, reaproveitado por esta gaveta via
 * `POLITICA_IMOBILIARIO_ALTO_PADRAO`, bloqueia na saída real do modelo —
 * aqui a mensagem já nasce dentro do limite, por template, não por IA
 * generativa). Bilíngue (PT/EN) — Expansão Enterprise Global.
 */
export function gerarMensagemCobrancaHumanizada(
  documento: Pick<DocumentoPendente, "devedorNome" | "referencia">,
  nivel: NivelUrgenciaCobranca,
  idioma: Idioma = "pt"
): string {
  const nome = documento.devedorNome || (idioma === "en" ? "there" : "tudo bem");
  if (idioma === "en") {
    switch (nivel) {
      case "atencao":
        return `Hi ${nome}, just a friendly reminder that document ${documento.referencia} is now due. Let us know if you need anything to complete it.`;
      case "atraso":
        return `Hi ${nome}, document ${documento.referencia} is still pending. Could you share an update on when we can expect it?`;
      case "critico":
        return `Hi ${nome}, document ${documento.referencia} remains significantly overdue. Please reach out so we can resolve this together as soon as possible.`;
      default:
        return `Hi ${nome}, document ${documento.referencia} is on file and not yet due — no action needed yet.`;
    }
  }
  switch (nivel) {
    case "atencao":
      return `Oi ${nome}, passando para lembrar que o documento ${documento.referencia} venceu agora. Precisa de algo para dar andamento?`;
    case "atraso":
      return `Oi ${nome}, o documento ${documento.referencia} ainda está pendente. Pode nos dar uma previsão?`;
    case "critico":
      return `Oi ${nome}, o documento ${documento.referencia} está com atraso significativo. Pode nos retornar para resolvermos isso o quanto antes?`;
    default:
      return `Oi ${nome}, o documento ${documento.referencia} está registrado e ainda não venceu — nenhuma ação necessária por agora.`;
  }
}

/** Limite de tentativas automáticas antes de escalar para decisão humana — configurável, valor de partida conservador. */
export const MAX_TENTATIVAS_AUTOMATICAS_PADRAO = 3;

/**
 * Decide a próxima ação do motor para um documento — função pura, mesmo
 * contrato de `detectarTicketsEmViolacaoRegulatoria`
 * (`@/lib/server/sacShieldHandoffMonitor`). Documentos pagos/cancelados/já
 * escalados nunca geram nova ação (idempotente).
 */
export function decidirProximaAcaoCobranca(
  documento: DocumentoPendente,
  referencia = new Date(),
  maxTentativasAutomaticas = MAX_TENTATIVAS_AUTOMATICAS_PADRAO
): DecisaoArRecovery {
  if (documento.status === "pago" || documento.status === "cancelado" || documento.status === "escalado") {
    return { acao: "aguardar", motivo: `Documento já está "${documento.status}" — nenhuma ação pendente.`, nivel: "no-prazo" };
  }

  const diasAtraso = calcularDiasAtraso(documento, referencia);
  const nivel = classificarUrgenciaCobranca(diasAtraso);

  if (nivel === "no-prazo") {
    return { acao: "aguardar", motivo: "Documento ainda dentro do prazo de vencimento.", nivel };
  }

  if (documento.tentativasCobranca >= maxTentativasAutomaticas) {
    return {
      acao: "escalar-humano",
      motivo: `${documento.tentativasCobranca} tentativa(s) automática(s) esgotadas sem resolução (${diasAtraso} dia(s) de atraso).`,
      nivel,
    };
  }

  return {
    acao: "enviar-cobranca",
    motivo: `${diasAtraso} dia(s) de atraso — tentativa automática ${documento.tentativasCobranca + 1} de ${maxTentativasAutomaticas}.`,
    nivel,
  };
}

/** Mesmo princípio de `ResumoExecutivoHandoff.faixaOrcamento`: nunca o valor exato, sempre uma faixa por extenso. */
function faixaValorPorExtenso(valorBrl: number): string {
  if (valorBrl < 1_000) return "até R$ 1 mil";
  if (valorBrl < 10_000) return "entre R$ 1 mil e R$ 10 mil";
  if (valorBrl < 50_000) return "entre R$ 10 mil e R$ 50 mil";
  return "acima de R$ 50 mil";
}

/** Card do Handoff com Resumo Executivo de Cobrança — mesmo princípio de "campo ausente fica null" dos demais `ResumoExecutivo*`. */
export function construirResumoExecutivoCobranca(
  documento: DocumentoPendente,
  diasAtraso: number
): ResumoExecutivoCobranca {
  return {
    devedorNome: documento.devedorNome || null,
    referenciaDocumento: documento.referencia || null,
    diasAtraso,
    tentativasAnteriores: documento.tentativasCobranca,
    faixaValor: documento.valorBrl != null ? faixaValorPorExtenso(documento.valorBrl) : null,
  };
}
