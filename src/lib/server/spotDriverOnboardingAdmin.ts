// Gaveta de Back-office — Fleet & SPOT Driver Onboarding — processador de
// tick (Admin SDK).
//
// SERVER-ONLY: o núcleo de decisão puro (`decidirProximaAcaoOnboardingSpot`,
// `construirResumoExecutivoMotoristaSpot`, etc.) vive em
// `@/lib/spotDriverOnboarding` (isomórfico, consumido também pelo painel
// `SpotFleetStatusPanel`) — este arquivo só adiciona o IO (Admin SDK, HITL,
// crédito de ROI). Mesma separação "decisão" × "IO" de
// `@/lib/server/arRecoveryEngine`.
//
// "Agente autônomo em background" aqui significa, honestamente, a mesma
// coisa que em `arRecoveryEngine.ts`: um endpoint
// (`/api/spot-driver/tick`) chamado repetidamente por um scheduler externo
// (Cloud Scheduler/cron) ou, no futuro, pela própria ingestão de mensagem
// do WhatsApp/Telegram — este módulo é agnóstico de QUEM dispara o tick.
//
// Escopo deliberado (Artigo IV — No Invention): a recepção conversacional
// 24/7 via WhatsApp/Telegram (perguntar documento por documento ao
// motorista) NÃO está implementada neste módulo — ela reaproveitaria a
// mesma ingestão real já hardenizada em `@/lib/server/telegramBotAdmin` e
// `@/lib/server/whatsappCloudApiAdmin`, mas conectar isso exige decidir COMO
// uma mensagem de texto/foto se torna um `DocumentoMotoristaSpot` validado
// (OCR/extração), o que este módulo não inventa sem um extrator real. O que
// este arquivo garante, de ponta a ponta e de verdade, é: a partir de um
// dossiê já atualizado (`@/lib/motoristasSpot`, hoje por cadastro manual no
// painel — o mesmo degrau que `ArRecoveryStatusPanel` usa para o AR
// Recovery Engine), o Shield-Layer decide, bloqueia/escala e credita ROI
// real.

import type { DossieMotoristaSpot } from "@/types";
import { construirResumoExecutivoMotoristaSpot, decidirProximaAcaoOnboardingSpot } from "@/lib/spotDriverOnboarding";
import { abrirTransbordoAdmin } from "./hitlStore";
import { registrarGanhoOperacionalAdmin } from "./backOfficeRoi";
import { firestoreAdmin } from "./firebaseAdmin";

const COLECAO = "motoristasSpot";

export interface ResultadoTickSpotDriverOnboarding {
  dossiesVerificados: number;
  escalonamentosAbertos: number;
  aprovacoesPendentesAbertas: number;
}

export interface OpcoesTickSpotDriverOnboarding {
  referencia?: Date;
}

/**
 * Varre os dossiês do workspace ainda não decididos (sem `aprovadoEm`) e
 * aplica a decisão de cada um — cada dossiê roda isoladamente (um erro não
 * impede os demais), mesmo racional de `processarTickArRecoveryEngine`.
 */
export async function processarTickSpotDriverOnboardingAdmin(
  workspaceId: string,
  opcoes: OpcoesTickSpotDriverOnboarding = {}
): Promise<ResultadoTickSpotDriverOnboarding> {
  const db = firestoreAdmin();
  const referencia = opcoes.referencia ?? new Date();

  const snap = await db.collection(COLECAO).where("workspaceId", "==", workspaceId).get();
  const dossies = snap.docs.map((d) => d.data() as DossieMotoristaSpot).filter((d) => !d.aprovadoEm);

  let escalonamentosAbertos = 0;
  let aprovacoesPendentesAbertas = 0;

  for (const dossie of dossies) {
    try {
      const decisao = decidirProximaAcaoOnboardingSpot(dossie);
      if (decisao.acao === "aguardar-documentos") continue;

      const refDossie = db.collection(COLECAO).doc(dossie.id);
      const agoraIso = referencia.toISOString();

      // Reivindica o dossiê numa transação que RELÊ o estado atual antes de
      // marcar `ticketAbertoEm` — mesmo padrão de `processarTickArRecoveryEngine`:
      // se duas execuções do tick rodarem em paralelo, a segunda encontra
      // `ticketAbertoEm` já preenchido (ou `status` já diferente) e desiste
      // sem abrir um segundo ticket para o mesmo dossiê.
      const reivindicado = await db.runTransaction(async (tx) => {
        const snapAtual = await tx.get(refDossie);
        if (!snapAtual.exists) return false;
        const atual = snapAtual.data() as DossieMotoristaSpot;
        if (atual.ticketAbertoEm || atual.status !== dossie.status || atual.aprovadoEm) return false;

        tx.update(refDossie, { ticketAbertoEm: agoraIso });
        return true;
      });

      if (!reivindicado) continue;

      const resumoExecutivoMotoristaSpot = construirResumoExecutivoMotoristaSpot(dossie);

      if (decisao.acao === "escalar-documentacao-irregular") {
        await abrirTransbordoAdmin({
          solicitacao: {
            traceId: `spot_driver_${dossie.id}`,
            politicaId: "no-critico",
            severidade: "critica",
            veredito: "bloqueado",
            violacoes: [{ regra: "motorista-documentacao-irregular", severidade: "critica", mensagem: decisao.motivo }],
            payloadMascarado: `Motorista SPOT ${dossie.nomeMotorista} — ${decisao.motivo}`,
          },
          flowId: dossie.id,
          flowNome: `Fleet & SPOT Driver Onboarding — ${dossie.nomeMotorista}`,
          motivoForcado: "motorista-documentacao-irregular",
          resumoExecutivoMotoristaSpot,
          workspaceId,
          criadoPor: "sistema",
        });
        escalonamentosAbertos += 1;
      } else {
        await abrirTransbordoAdmin({
          solicitacao: {
            traceId: `spot_driver_${dossie.id}`,
            politicaId: "no-critico",
            severidade: "baixa",
            veredito: "transbordo",
            violacoes: [],
            payloadMascarado: `Motorista SPOT ${dossie.nomeMotorista} — dossiê pronto para aprovação.`,
          },
          flowId: dossie.id,
          flowNome: `Fleet & SPOT Driver Onboarding — ${dossie.nomeMotorista}`,
          motivoForcado: "dossie-motorista-pronto-aprovacao",
          resumoExecutivoMotoristaSpot,
          workspaceId,
          criadoPor: "sistema",
        });
        aprovacoesPendentesAbertas += 1;

        await registrarGanhoOperacionalAdmin({
          workspaceId,
          origem: "spot-driver-onboarding",
          descricao: `Triagem documental concluída — ${dossie.nomeMotorista}`,
          agora: referencia,
        });
      }
    } catch (erro) {
      console.error(`[spot-driver-onboarding] falha ao processar dossiê ${dossie.id}:`, erro);
    }
  }

  return { dossiesVerificados: dossies.length, escalonamentosAbertos, aprovacoesPendentesAbertas };
}
