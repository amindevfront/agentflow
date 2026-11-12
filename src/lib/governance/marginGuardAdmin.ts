// Motor de Pre-Deal Compliance & Margin Guard — persistência e selo de
// auditoria. SERVER-ONLY (Admin SDK).
//
// Contraparte server-side de `./marginGuard` (puro, isomórfico). Sela o
// evento `guardrail.risco-fiscal-margem.prevenido` na MESMA trilha
// Hash-Chain do resto da auditoria (`@/lib/server/auditChainStore`) — mesmo
// padrão de `channelReputationShieldAdmin.ts`/`sacShieldHandoffMonitor.ts`:
// um evento gerado pelo próprio motor (sem sessão de usuário), com
// `ator: "sistema"`, selado diretamente via Admin SDK, nunca pela rota HTTP
// `/api/audit/seal` (que exige um usuário autenticado).

import type { AuditEventBody } from "@/types";
import type { RiscoPrevenidoEstimado } from "@/types";
import { executarTransacaoDeSelo } from "@/lib/server/auditChainStore";
import { chaveAuditoria } from "@/lib/server/env";
import { firestoreAdmin } from "@/lib/server/firebaseAdmin";

export interface RegistrarRiscoPrevenidoAdminInput {
  workspaceId: string;
  ticketId: string;
  traceId?: string;
  risco: RiscoPrevenidoEstimado;
}

/**
 * Sela o evento de auditoria do risco prevenido — nunca lançado para o
 * chamador: o ticket já foi persistido (ver `abrirTransbordoAdmin` em
 * `@/lib/server/hitlStore`), perder este selo é um incidente de
 * observabilidade, não motivo para reverter o handoff. Mesmo racional de
 * `notificarConnectHub`.
 */
export async function registrarRiscoPrevenidoAdmin(entrada: RegistrarRiscoPrevenidoAdminInput): Promise<void> {
  const db = firestoreAdmin();
  const corpo: AuditEventBody = {
    tipo: "guardrail.risco-fiscal-margem.prevenido",
    resultado: "negado",
    workspaceId: entrada.workspaceId,
    ator: "sistema",
    recurso: `hitlTickets/${entrada.ticketId}`,
    traceId: entrada.traceId,
    severidade: "critica",
    detalhes: {
      regras: entrada.risco.regras.join("; "),
      prejuizoEstimadoBrl: entrada.risco.prejuizoEstimadoBrl,
    },
    ocorridoEm: new Date().toISOString(),
  };

  const chaveHmac = await chaveAuditoria();
  await db.runTransaction((tx) => executarTransacaoDeSelo(tx, db, entrada.workspaceId, corpo, chaveHmac));
}

export interface RiscoPrevenidoAgregado {
  totalTickets: number;
  prejuizoEstimadoTotalBrl: number;
}

/**
 * Agrega o Risk Shield de um workspace — lido a partir de `hitlTickets` (já
 * persistidos com `riscoPrevenido` por `abrirTransbordoAdmin`), para o
 * indicador "Passivo & Multas Prevenidas (Risk Shield)" do Relatório
 * Executivo. Nunca lança: uma falha de leitura degrada para zero, mesmo
 * contrato de resiliência de `obterMetricasPipelineVerticalAdmin`
 * (`@/lib/server/roiDashboard`).
 */
export async function obterRiscoPrevenidoAgregadoAdmin(workspaceId: string): Promise<RiscoPrevenidoAgregado> {
  try {
    const snap = await firestoreAdmin()
      .collection("hitlTickets")
      .where("workspaceId", "==", workspaceId)
      .get();

    let totalTickets = 0;
    let prejuizoEstimadoTotalBrl = 0;
    for (const doc of snap.docs) {
      const risco = (doc.data() as { riscoPrevenido?: RiscoPrevenidoEstimado }).riscoPrevenido;
      if (risco) {
        totalTickets += 1;
        prejuizoEstimadoTotalBrl += risco.prejuizoEstimadoBrl;
      }
    }
    return { totalTickets, prejuizoEstimadoTotalBrl };
  } catch (erro) {
    console.error(`[margin-guard] falha ao agregar risco prevenido do workspace ${workspaceId}:`, erro);
    return { totalTickets: 0, prejuizoEstimadoTotalBrl: 0 };
  }
}
