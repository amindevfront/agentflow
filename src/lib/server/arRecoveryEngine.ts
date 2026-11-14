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
      if (decisao.acao !== "enviar-cobranca" && decisao.acao !== "escalar-humano") continue;

      const refDocumento = db.collection(COLECAO).doc(documento.id);
      const agoraIso = referencia.toISOString();

      // Reivindica o documento numa transação que RELÊ o estado atual antes
      // de aplicar a mudança — se duas execuções do tick rodarem em
      // paralelo (retry duplicado da Vercel, dois crons simultâneos), a
      // segunda encontra o estado já diferente do que leu na varredura e
      // desiste sem repetir o efeito (cobrança/escalonamento) para o mesmo
      // documento. Mesmo padrão de `processarTickSacShieldSla`
      // (`./sacShieldHandoffMonitor`). Os efeitos colaterais (crédito de ROI,
      // abertura de ticket HITL) ficam DELIBERADAMENTE fora da transação —
      // uma transação do Firestore pode ser reexecutada internamente em
      // contenção, e um efeito não-idempotente dentro dela rodaria de novo a
      // cada tentativa.
      //
      // Bug real corrigido aqui: a reivindicação comparava SÓ `status`, que
      // não muda entre lembretes sucessivos de um documento já
      // `em-cobranca` — só `tentativasCobranca` muda. Resultado: duas
      // execuções concorrentes do tick, ambas vendo o mesmo documento
      // `em-cobranca` com a MESMA contagem de tentativas na varredura,
      // passavam as duas pela guarda (`atual.status === documento.status`
      // continua verdadeiro), e cada uma incrementava `tentativasCobranca`
      // e creditava ROI — dois lembretes e dois créditos para a MESMA
      // janela de atraso. Comparar também `tentativasCobranca` fecha essa
      // janela: qualquer cobrança já aplicada por outra execução (que
      // sempre incrementa este contador) agora é detectada aqui.
      const reivindicado = await db.runTransaction(async (tx) => {
        const snapAtual = await tx.get(refDocumento);
        if (!snapAtual.exists) return false;
        const atual = snapAtual.data() as DocumentoPendente;
        if (atual.status !== documento.status || atual.tentativasCobranca !== documento.tentativasCobranca) {
          return false;
        }

        if (decisao.acao === "enviar-cobranca") {
          tx.update(refDocumento, {
            status: "em-cobranca",
            tentativasCobranca: atual.tentativasCobranca + 1,
            ultimaCobrancaEm: agoraIso,
          });
        } else {
          tx.update(refDocumento, { status: "escalado" });
        }
        return true;
      });

      if (!reivindicado) continue;

      if (decisao.acao === "enviar-cobranca") {
        await registrarGanhoOperacionalAdmin({
          workspaceId,
          origem: "ar-recovery-engine",
          descricao: `Follow-up de cobrança sugerido — ${documento.referencia}`,
          agora: referencia,
        });
        cobrancasEnviadas += 1;
      } else {
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
        escalonamentosAbertos += 1;
      }
    } catch (erro) {
      console.error(`[ar-recovery] falha ao processar documento ${documento.id}:`, erro);
    }
  }

  return { documentosVerificados: documentos.length, cobrancasEnviadas, escalonamentosAbertos };
}
