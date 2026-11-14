// Gaveta de Back-office — Fleet & SPOT Driver Onboarding (Logística/
// Transportadoras: Fadel, Comex, distribuidoras pesadas).
//
// Núcleo PURO e ISOMÓRFICO (sem Firestore, sem Admin SDK, sem rede) — roda
// tanto no painel de gestão de frota (`SpotFleetStatusPanel`, "use client")
// quanto no processador de tick Admin SDK
// (`@/lib/server/spotDriverOnboardingAdmin`, que importa estas funções).
// Mesma separação "decisão" × "IO" de `@/lib/arRecoveryEngine` ×
// `@/lib/server/arRecoveryEngine`.
//
// Mesma filosofia de todo detector determinístico deste código: léxico/
// regra de negócio explícita, sem IA generativa — auditável e reproduzível
// (Artigo IV — No Invention). Um documento ausente simplesmente aparece
// como pendência, nunca é inventado como "recebido".
//
// "Shield-Layer bloqueia cadastros irregulares": o bloqueio real é o
// resultado `vermelho` de `avaliarDossieMotoristaSpot` propagando para
// `decidirProximaAcaoOnboardingSpot` → `escalar-documentacao-irregular` →
// ticket HITL (`@/lib/server/spotDriverOnboardingAdmin`) — a liberação de
// frota nunca acontece silenciosamente com documentação vencida/irregular.

import type { DecisaoOnboardingSpot, DocumentoMotoristaSpot, DossieMotoristaSpot, TipoDocumentoMotoristaSpot } from "@/types";

/** Documentação obrigatória para liberação de frota SPOT — nenhum dossiê chega a `verde` sem os quatro. */
export const DOCUMENTOS_OBRIGATORIOS_SPOT: TipoDocumentoMotoristaSpot[] = ["cnh", "crlv", "antt", "comprovante-residencia"];

export const ROTULO_DOCUMENTO_SPOT: Record<TipoDocumentoMotoristaSpot, string> = {
  cnh: "CNH",
  crlv: "CRLV",
  antt: "ANTT",
  "comprovante-residencia": "Comprovante de Residência",
};

/** Documentos com data de validade monitorada — CRLV/Comprovante de Residência são validados por presença, não por vencimento. */
const DOCUMENTOS_COM_VALIDADE = new Set<TipoDocumentoMotoristaSpot>(["cnh", "antt"]);

/**
 * Custo operacional ESTIMADO evitado por motorista SPOT liberado sem
 * gargalo de pátio (caminhão/carreta parado aguardando liberação
 * documental) — valor de referência conservador e documentado, nunca
 * inventado a partir do contexto da conversa (mesma honestidade de
 * `VALOR_ESTIMADO_PREJUIZO_POR_REGRA_BRL`, `@/lib/governance/marginGuard`).
 * Cada transportadora deve recalibrar ao seu próprio custo de hora parada
 * de pátio/frota.
 */
export const CUSTO_EVITADO_GARGALO_PATIO_BRL = 450;

/**
 * Valida UM documento — função pura: dado o mesmo documento e a mesma data
 * de referência, o resultado é sempre idêntico. Nunca modifica o documento
 * recebido, devolve uma cópia já avaliada.
 */
export function validarDocumentoMotorista(
  documento: DocumentoMotoristaSpot,
  referencia: Date = new Date()
): DocumentoMotoristaSpot {
  if (documento.status === "pendente") {
    return { ...documento, motivoInvalido: null };
  }

  if (DOCUMENTOS_COM_VALIDADE.has(documento.tipo)) {
    if (!documento.validadeEm) {
      return {
        ...documento,
        status: "invalido",
        motivoInvalido: `${ROTULO_DOCUMENTO_SPOT[documento.tipo]} recebida sem data de validade informada.`,
      };
    }
    const validade = new Date(documento.validadeEm).getTime();
    if (!Number.isFinite(validade)) {
      return {
        ...documento,
        status: "invalido",
        motivoInvalido: `${ROTULO_DOCUMENTO_SPOT[documento.tipo]} com data de validade inválida.`,
      };
    }
    if (validade < referencia.getTime()) {
      const diasVencido = Math.floor((referencia.getTime() - validade) / (24 * 60 * 60 * 1000));
      return {
        ...documento,
        status: "invalido",
        motivoInvalido: `${ROTULO_DOCUMENTO_SPOT[documento.tipo]} vencida há ${diasVencido} dia(s).`,
      };
    }
  }

  return { ...documento, status: "valido", motivoInvalido: null };
}

export interface AvaliacaoDossieMotoristaSpot {
  status: DossieMotoristaSpot["status"];
  pendencias: string[];
}

/**
 * Avalia o conjunto de documentos de um dossiê e deriva o semáforo de
 * prontidão — mesmo racional de `classificarUrgenciaCobranca`
 * (`@/lib/arRecoveryEngine`): tiers progressivos, nunca um estado inventado.
 *
 *  - `vermelho`: ao menos um documento OBRIGATÓRIO está `invalido` —
 *    bloqueio de compliance, sempre a severidade mais alta.
 *  - `amarelo`: nenhum inválido, mas falta ao menos um documento obrigatório
 *    (ausente ou ainda `pendente`/`recebido` sem validação concluída).
 *  - `verde`: os quatro documentos obrigatórios estão `valido`.
 */
export function avaliarDossieMotoristaSpot(
  documentos: DocumentoMotoristaSpot[],
  referencia: Date = new Date()
): AvaliacaoDossieMotoristaSpot {
  const validados = documentos.map((d) => validarDocumentoMotorista(d, referencia));
  const porTipo = new Map(validados.map((d) => [d.tipo, d]));

  const pendencias: string[] = [];
  let temInvalido = false;
  let temFaltante = false;

  for (const tipo of DOCUMENTOS_OBRIGATORIOS_SPOT) {
    const doc = porTipo.get(tipo);
    if (!doc || doc.status === "pendente") {
      temFaltante = true;
      pendencias.push(`${ROTULO_DOCUMENTO_SPOT[tipo]} ainda não recebida.`);
      continue;
    }
    if (doc.status === "invalido") {
      temInvalido = true;
      pendencias.push(doc.motivoInvalido ?? `${ROTULO_DOCUMENTO_SPOT[tipo]} inválida.`);
      continue;
    }
    if (doc.status === "recebido") {
      temFaltante = true;
      pendencias.push(`${ROTULO_DOCUMENTO_SPOT[tipo]} recebida, aguardando validação.`);
    }
  }

  if (temInvalido) return { status: "vermelho", pendencias };
  if (temFaltante) return { status: "amarelo", pendencias };
  return { status: "verde", pendencias: [] };
}

/**
 * Decide a próxima ação do motor para um dossiê — função pura, mesmo
 * contrato de `decidirProximaAcaoCobranca` (`@/lib/arRecoveryEngine`).
 * Idempotente: um dossiê já aprovado, ou cujo ticket já foi aberto para a
 * transição atual, nunca gera uma nova ação (ver `ticketAbertoEm`).
 */
export function decidirProximaAcaoOnboardingSpot(dossie: DossieMotoristaSpot): DecisaoOnboardingSpot {
  if (dossie.aprovadoEm) {
    return { acao: "aguardar-documentos", motivo: "Cadastro já aprovado — nenhuma ação pendente." };
  }

  if (dossie.ticketAbertoEm) {
    return {
      acao: "aguardar-documentos",
      motivo: `Ticket já aberto para o status "${dossie.status}" em ${dossie.ticketAbertoEm} — aguardando decisão humana.`,
    };
  }

  if (dossie.status === "vermelho") {
    return {
      acao: "escalar-documentacao-irregular",
      motivo: `Documentação irregular: ${dossie.pendencias.join(" ")}`,
    };
  }

  if (dossie.status === "verde") {
    return {
      acao: "dossie-pronto-aprovacao",
      motivo: "Documentação obrigatória completa e válida — pronto para aprovação humana.",
    };
  }

  return {
    acao: "aguardar-documentos",
    motivo: `Triagem em andamento: ${dossie.pendencias.join(" ")}`,
  };
}

/**
 * Mensagem SUGERIDA para solicitar o próximo documento pendente ao
 * motorista — template fixo, nunca texto gerado por IA generativa (mesma
 * disciplina de `gerarMensagemCobrancaHumanizada`, que também nunca promete
 * nada fora do roteiro). BR-only: CNH/CRLV/ANTT/Comprovante de Residência
 * são conceitos do regime documental brasileiro, sem equivalente 1:1 em
 * outra jurisdição — inventar uma tradução sem a mesma exigência legal por
 * trás violaria o Artigo IV, mesmo racional de `detectarInformalidadeFiscal`
 * (`@/lib/guardrails/consistency`).
 */
export function gerarMensagemSolicitacaoDocumento(tipo: TipoDocumentoMotoristaSpot): string {
  return `Para liberar seu cadastro na frota SPOT, precisamos agora da sua ${ROTULO_DOCUMENTO_SPOT[tipo]}. Pode enviar uma foto legível?`;
}

/**
 * Card do Handoff com o Dossiê de Risco e Prontidão do Motorista SPOT —
 * mesmo princípio de "campo ausente fica null" dos demais `ResumoExecutivo*`.
 */
export function construirResumoExecutivoMotoristaSpot(dossie: DossieMotoristaSpot): {
  nomeMotorista: string;
  placaVeiculo: string | null;
  status: DossieMotoristaSpot["status"];
  pendencias: string[];
} {
  return {
    nomeMotorista: dossie.nomeMotorista,
    placaVeiculo: dossie.placaVeiculo ?? null,
    status: dossie.status,
    pendencias: dossie.pendencias,
  };
}
