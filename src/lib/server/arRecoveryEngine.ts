// Gaveta de Back-office — AR Recovery Engine — processador de tick
// (Admin SDK).
//
// SERVER-ONLY: o núcleo de decisão puro (`calcularDiasAtraso`,
// `decidirProximaAcaoCobranca`, etc.) vive em `@/lib/arRecoveryEngine`
// (isomórfico, consumido também pelo painel `ArRecoveryStatusPanel`) — este
// arquivo só adiciona o IO (Admin SDK, HITL, crédito de ROI). Mesma
// separação "decisão" × "IO" de `./sacShieldHandoffMonitor`
// (`detectarTicketsEmViolacaoRegulatoria` puro + `processarTickSacShieldSla`
// com efeito).
//
// "Agente autônomo em background" aqui significa, honestamente: um endpoint
// (`/api/ar-recovery/tick`) chamado repetidamente por um scheduler externo
// (Cloud Scheduler/cron), nunca um processo que roda sozinho dentro do
// Node — mesma limitação já documentada para `processarTickSacShieldSla`/
// `processarTickCampanhas`.

import type { DocumentoPendente } from "@/types";
import { calcularDiasAtraso, construirResumoExecutivoCobranca, decidirProximaAcaoCobranca } from "@/lib/arRecoveryEngine";
import { abrirTransbordoAdmin } from "./hitlStore";
import { registrarGanhoOperacionalAdmin } from "./backOfficeRoi";
import { firestoreAdmin } from "./firebaseAdmin";

const COLECAO = "documentosPendentes";

export interface ResultadoTickArRecoveryEngine {
  documentosVerificados: number;
  cobrancasEnviadas: number;
  escalonamentosAbertos: number;
}

export interface OpcoesTickArRecoveryEngine {
  referencia?: Date;
  maxTentativasAutomaticas?: number;
}

/**
 * Varre os documentos pendentes/em-cobrança do workspace e aplica a
 * decisão de cada um — cada documento roda isoladamente (um erro não
 * impede os demais), mesmo racional de `processarTickSacShieldSla`.
 */
export async function processarTickArRecoveryEngine(
  workspaceId: string,
  opcoes: OpcoesTickArRecoveryEngine = {}
): Promise<ResultadoTickArRecoveryEngine> {
  const db = firestoreAdmin();
  const referencia = opcoes.referencia ?? new Date();

  const snap = await db
    .collection(COLECAO)
    .where("workspaceId", "==", workspaceId)
    .where("status", "in", ["pendente", "em-cobranca"])
    .get();

  const documentos = snap.docs.map((d) => d.data() as DocumentoPendente);

  let cobrancasEnviadas = 0;
  let escalonamentosAbertos = 0;

  for (const documento of documentos) {
    try {
      const decisao = decidirProximaAcaoCobranca(documento, referencia, opcoes.maxTentativasAutomaticas);
      const refDocumento = db.collection(COLECAO).doc(documento.id);

      if (decisao.acao === "enviar-cobranca") {
        const agoraIso = referencia.toISOString();
        await refDocumento.update({
          status: "em-cobranca",
          tentativasCobranca: documento.tentativasCobranca + 1,
          ultimaCobrancaEm: agoraIso,
        });
        await registrarGanhoOperacionalAdmin({
          workspaceId,
          origem: "ar-recovery-engine",
          descricao: `Follow-up de cobrança sugerido — ${documento.referencia}`,
          agora: referencia,
        });
        cobrancasEnviadas += 1;
      } else if (decisao.acao === "escalar-humano") {
        const diasAtraso = calcularDiasAtraso(documento, referencia);
        await abrirTransbordoAdmin({
          solicitacao: {
            traceId: `ar_recovery_${documento.id}`,
            politicaId: "imobiliario-alto-padrao",
            severidade: "media",
            veredito: "transbordo",
            violacoes: [
              {
                regra: "cobranca-documento-pendente",
                severidade: "media",
                mensagem: decisao.motivo,
              },
            ],
            payloadMascarado: `Documento ${documento.referencia} — ${decisao.motivo}`,
          },
          flowId: documento.id,
          flowNome: `AR Recovery Engine — ${documento.referencia}`,
          motivoForcado: "cobranca-documento-pendente",
          resumoExecutivoCobranca: construirResumoExecutivoCobranca(documento, diasAtraso),
          workspaceId,
          criadoPor: "sistema",
        });
        await refDocumento.update({ status: "escalado" });
        escalonamentosAbertos += 1;
      }
    } catch (erro) {
      console.error(`[ar-recovery] falha ao processar documento ${documento.id}:`, erro);
    }
  }

  return { documentosVerificados: documentos.length, cobrancasEnviadas, escalonamentosAbertos };
}
