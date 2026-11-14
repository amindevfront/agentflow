// Ponte de ROI das Gavetas de Back-office — Full-Scope Enterprise Operations.
//
// SERVER-ONLY (Admin SDK). `flowRuns` só pode ser escrito pelo motor de
// orquestração via Admin SDK (`allow write: if false` em `firestore.rules`),
// então creditar "horas economizadas" de uma gaveta de back-office precisa
// passar por aqui — nunca por uma escrita direta do cliente.
//
// Design deliberado: cada operação de back-office (documento analisado,
// registro reconciliado, follow-up de cobrança enviado) é registrada como
// um `FlowRun` CONCLUÍDO com `metrica.minutosManuaisEvitados` — o mesmo
// campo que qualquer fluxo de automação já usa (ver `RunCostMetrics` em
// `@/types`). Isso significa que `calcularRoi`/`BusinessROIWidget`
// (`@/lib/roi`) já refletem o ganho operacional IMEDIATAMENTE, sem nenhuma
// mudança no motor de ROI ou no widget: a "Unificação financeira" que
// `calcularRoi` já documenta (fluxos + conversas + campanhas) ganha uma
// quarta fonte de dados sem precisar saber que ela existe.
//
// Honestidade do número: os minutos por operação são uma tabela de
// REFERÊNCIA fixa no servidor (`MINUTOS_ECONOMIZADOS_POR_ORIGEM`), nunca um
// valor que o cliente informa livremente — do contrário, qualquer chamador
// poderia inflar o próprio ROI só variando o corpo da requisição. Mesma
// disciplina de `VALOR_MEDIO_PIPELINE_PADRAO_BRL` (`@/lib/server/roiDashboard`):
// um valor de partida conservador e documentado, nunca confiado do cliente.

import type { FlowRun, FlowRunStep } from "@/types";
import { firestoreAdmin } from "./firebaseAdmin";

export type OrigemBackOffice = "document-ai-vault" | "sheet-reconciliation" | "ar-recovery-engine" | "spot-driver-onboarding";

/**
 * Minutos manuais ESTIMADOS evitados por operação, por gaveta — valores de
 * partida conservadores (mesmo espírito de `ROI_CONFIG_PADRAO` em
 * `@/lib/roi`): cada workspace real deve recalibrar ao seu próprio processo.
 *
 *  - Document AI Vault: tempo médio de um analista lendo um contrato e
 *    extraindo manualmente as cláusulas críticas.
 *  - Sheet Reconciliation: tempo médio de localizar e atualizar manualmente
 *    um registro em uma planilha a partir de uma conversa de atendimento.
 *  - AR Recovery Engine: tempo médio de redigir e disparar manualmente um
 *    follow-up de cobrança (sem contar o tempo de decisão/negociação, que
 *    continua humano quando o caso é escalado).
 *  - Fleet & SPOT Driver Onboarding: tempo médio de um auxiliar
 *    administrativo conferindo manualmente CNH/CRLV/ANTT/Comprovante de
 *    Residência de um motorista terceirizado e decidindo liberar a frota —
 *    ver `MINUTOS_ECONOMIZADOS_POR_MOTORISTA_SPOT` em
 *    `@/lib/server/spotDriverOnboardingAdmin` (mesmo valor, reexportado aqui
 *    só para a tabela ficar completa por origem).
 */
export const MINUTOS_ECONOMIZADOS_POR_ORIGEM: Record<OrigemBackOffice, number> = {
  "document-ai-vault": 20,
  "sheet-reconciliation": 4,
  "ar-recovery-engine": 6,
  "spot-driver-onboarding": 15,
};

const NOME_GAVETA: Record<OrigemBackOffice, string> = {
  "document-ai-vault": "Document AI Vault",
  "sheet-reconciliation": "Sheet Reconciliation",
  "ar-recovery-engine": "AR Recovery Engine",
  "spot-driver-onboarding": "Fleet & SPOT Driver Onboarding",
};

/**
 * Origens que QUALQUER membro autenticado do workspace pode creditar via
 * `/api/back-office/ganho-operacional` — as duas gavetas sem tick/Admin SDK
 * próprio, onde o clique do operador NA HORA é a própria "operação
 * concluída" (análise de contrato, reconciliação de registro).
 *
 * `ar-recovery-engine` e `spot-driver-onboarding` ficam de FORA desta lista
 * deliberadamente: o crédito legítimo delas já é 100% automático via seus
 * próprios ticks Admin SDK (`processarTickArRecoveryEngine`/
 * `processarTickSpotDriverOnboardingAdmin`), que só creditam depois de
 * validar estado real (limite de tentativas de cobrança, documentação
 * obrigatória completa/válida). Se essas duas origens fossem aceitas aqui
 * também, qualquer membro do workspace (não precisa ser admin) poderia
 * fabricar "horas economizadas" de AR Recovery/Spot Driver só chamando esta
 * rota repetidamente pelo navegador — sem nenhuma cobrança real enviada,
 * nenhum motorista realmente triado — quebrando exatamente a "honestidade
 * do número" que este arquivo promete no cabeçalho.
 */
export const ORIGENS_BACK_OFFICE_CREDITAVEIS_PELO_CLIENTE: readonly OrigemBackOffice[] = [
  "document-ai-vault",
  "sheet-reconciliation",
];

function novoIdRun(): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `backoffice_${aleatorio}`;
}

export interface RegistrarGanhoOperacionalInput {
  workspaceId: string;
  origem: OrigemBackOffice;
  /** Rótulo da operação concluída, exibido no histórico de execuções — nunca dado sensível/PII. */
  descricao: string;
  agora?: Date;
}

/**
 * Credita o ganho operacional de uma gaveta de back-office como um
 * `FlowRun` concluído — função pura na montagem do registro, só a
 * persistência (`firestoreAdmin().collection("flowRuns")`) é efeito de IO.
 */
export function construirFlowRunGanhoOperacional(entrada: RegistrarGanhoOperacionalInput): FlowRun {
  const agora = entrada.agora ?? new Date();
  const agoraIso = agora.toISOString();
  const passo: FlowRunStep = {
    id: "1",
    titulo: entrada.descricao,
    status: "concluido",
    timestamp: agoraIso,
  };

  return {
    id: novoIdRun(),
    workspaceId: entrada.workspaceId,
    flowId: `${entrada.origem}:${passo.id}`,
    flowNome: `${NOME_GAVETA[entrada.origem]} — ${entrada.descricao}`,
    status: "concluido",
    iniciadoEm: agoraIso,
    steps: [passo],
    metrica: {
      tokensEntrada: 0,
      tokensSaida: 0,
      minutosManuaisEvitados: MINUTOS_ECONOMIZADOS_POR_ORIGEM[entrada.origem],
      intervencaoHumana: false,
      concluidoEm: agoraIso,
    },
  };
}

/** Persiste via Admin SDK — bypassa `firestore.rules` por desenho (ver cabeçalho do módulo). */
export async function registrarGanhoOperacionalAdmin(entrada: RegistrarGanhoOperacionalInput): Promise<FlowRun> {
  const run = construirFlowRunGanhoOperacional(entrada);
  await firestoreAdmin().collection("flowRuns").doc(run.id).set(run);
  return run;
}
