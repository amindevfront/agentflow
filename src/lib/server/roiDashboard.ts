// Painel de ROI e Impacto Comercial — Atribuição de Pipeline Financeiro por
// Vertical. SERVER-ONLY.
//
// Diferente de `@/lib/roi` (que mede CUSTO EVITADO — horas humanas, OpEx,
// Tax Shield), este módulo mede OPORTUNIDADE GERADA: traduz atendimentos,
// leads qualificados de madrugada e agendamentos confirmados em um valor
// de PIPELINE estimado, agrupado por vertical — a pergunta do C-Level não é
// só "quanto economizamos", é "quanto negócio isso está gerando".
//
// Honestidade do número (mesma regra de `@/lib/roi` e de
// `@/lib/inbox/revenueRescue`): `calcularReceitaRecuperadaMadrugada`
// (`@/lib/inbox/revenueRescue`) deliberadamente NUNCA atribui um valor em
// R$ a uma conversa, porque não existe, no modelo de dados, um valor de
// negócio por conversa — e inventar um multiplicador silencioso ali
// quebraria a confiança do painel na primeira auditoria. A diferença aqui é
// que o valor NÃO é inventado silenciosamente: é um parâmetro CONFIGURÁVEL
// por vertical (`VALOR_MEDIO_PIPELINE_PADRAO_BRL`), documentado como
// estimativa de referência e sobrescrevível por workspace — exatamente o
// mesmo desenho de `RoiConfig.custoHoraOperadorBrl` em `@/lib/roi`. Todo
// campo derivado leva "Estimado" no nome para nunca ser lido como fato
// auditado.
//
// Só os três Módulos Verticais com protocolo de confirmação de agendamento
// implementado (`@/lib/server/hitlStore`, `MOTIVOS_AGENDAMENTO_VALIDADO`)
// têm um valor de pipeline por padrão — os demais nichos ficam em zero até
// um Vertical equivalente ser construído para eles (Artigo IV — No Invention).

import type { Conversation, HandoffTicket, NicheKey, RoiPeriodo } from "@/types";
import { foraDoExpediente, type JanelaExpediente } from "@/lib/inbox/revenueRescue";
import { periodoMesAtual } from "@/lib/roi";
import { NICHE_ORDER } from "@/lib/niches";
import { construirTabelaPipelinePadrao } from "@/modules/registry";
import { MOTIVOS_AGENDAMENTO_VALIDADO } from "./hitlStore";
import { firestoreAdmin } from "./firebaseAdmin";

/**
 * Janela de madrugada — mais estrita que `EXPEDIENTE_PADRAO`
 * (`@/lib/inbox/revenueRescue`, que inclui toda noite e fim de semana):
 * aqui é especificamente a faixa 0h–6h, o recorte que o Módulo Vertical 1
 * usa como exemplo ("leads noturnos/madrugada... buscando imóveis").
 * Ajustável por chamador, nunca hardcoded sem alternativa.
 */
export const JANELA_MADRUGADA: JanelaExpediente = {
  inicioHora: 6,
  fimHora: 24, // `foraDoExpediente` marca [fimHora, 24) + [0, inicioHora) como fora — aqui o alvo é só [0,6).
  diasUteis: [0, 1, 2, 3, 4, 5, 6],
};

/**
 * Valor médio ESTIMADO de pipeline (oportunidade em aberto, não receita
 * realizada) representado por um agendamento confirmado, por vertical —
 * valores de partida conservadores, cada workspace deve recalibrar ao seu
 * próprio ticket médio real (mesmo espírito de `ROI_CONFIG_PADRAO` em
 * `@/lib/roi`). Nichos sem protocolo de confirmação de agendamento
 * implementado ficam em 0 — nenhum valor é inventado para eles.
 *
 * Derivado do Registro de Módulos Verticais (`@/modules/registry`): o valor
 * de cada gaveta é definido uma única vez em `VerticalModuleDefinition.valorMedioPipelineBrl`
 * e esta tabela só o projeta no formato `Record<NicheKey, number>` que os
 * consumidores abaixo já esperavam antes desta gaveta existir — mesmos
 * valores de sempre, fonte única agora.
 *
 * Escopo deliberado: as gavetas de back-office (`document-ai-vault`,
 * `sheet-reconciliation`, `ar-recovery-engine`, `spot-driver-onboarding`)
 * NÃO entram aqui — `NICHE_ORDER`
 * (fonte desta tabela) só lista nichos de INDÚSTRIA, e `obterMetricasPipelineVerticalAdmin`
 * abaixo só lê `Workspace.setor` (nunca `modulosAtivos`). Isso é correto, não
 * uma lacuna: back-office não gera OPORTUNIDADE DE VENDA (este painel), gera
 * HORAS ECONOMIZADAS — métrica que já flui para `@/lib/roi`/`BusinessROIWidget`
 * via `@/lib/server/backOfficeRoi` (um `FlowRun` concluído por operação).
 */
export const VALOR_MEDIO_PIPELINE_PADRAO_BRL: Record<NicheKey, number> = construirTabelaPipelinePadrao(NICHE_ORDER);

function dentroDoPeriodo(iso: string | undefined, periodo: RoiPeriodo): boolean {
  if (!iso) return false;
  const instante = new Date(iso).getTime();
  if (!Number.isFinite(instante)) return false;
  return instante >= new Date(periodo.inicio).getTime() && instante <= new Date(periodo.fim).getTime();
}

export interface MetricasPipelineVertical {
  workspaceId: string;
  setor: NicheKey;
  /** Conversas da Neural Inbox dentro do período, qualquer desfecho. */
  atendimentos: number;
  /** Conversas cujo primeiro contato do cliente caiu na janela de madrugada E tiveram ao menos uma mensagem do cliente. */
  leadsQualificadosMadrugada: number;
  /** Tickets HITL com motivo de confirmação de agendamento/visita/reunião (Módulos Verticais 1-3), não cancelados. */
  agendamentosConfirmados: number;
  /** Valor médio (R$) efetivamente usado nesta agregação — o configurado, ou o padrão da vertical. */
  valorMedioPipelineUsadoBrl: number;
  /** `agendamentosConfirmados × valorMedioPipelineUsadoBrl` — SEMPRE um valor estimado, nunca receita realizada. */
  pipelineEstimadoBrl: number;
}

export interface CalcularMetricasPipelineVerticalInput {
  workspaceId: string;
  setor: NicheKey;
  conversas: Conversation[];
  tickets: HandoffTicket[];
  periodo?: RoiPeriodo;
  /** Sobrescreve `VALOR_MEDIO_PIPELINE_PADRAO_BRL[setor]` — mesmo padrão de override de `RoiConfig`. */
  valorMedioPipelineBrl?: number;
  janelaMadrugada?: JanelaExpediente;
  referencia?: Date;
}

/**
 * Calcula as métricas de pipeline de um único workspace — função pura,
 * mesma garantia de `calcularRoi` (`@/lib/roi`): dado o mesmo input, o
 * resultado é sempre idêntico e auditável.
 */
export function calcularMetricasPipelineVertical(
  input: CalcularMetricasPipelineVerticalInput
): MetricasPipelineVertical {
  const referencia = input.referencia ?? new Date();
  const periodo = input.periodo ?? periodoMesAtual(referencia);
  const janela = input.janelaMadrugada ?? JANELA_MADRUGADA;

  const conversasPeriodo = input.conversas.filter((c) => dentroDoPeriodo(c.criadaEm, periodo));

  // `foraDoExpediente` devolve `true` quando o instante cai FORA de
  // `[inicioHora, fimHora)`. Com `JANELA_MADRUGADA` configurada como
  // [6h, 24h) (todos os dias "úteis", então o teste de dia da semana nunca
  // dispara), "fora do expediente" é exatamente o complemento: [0h, 6h) —
  // ou seja, `foraDoExpediente(data, JANELA_MADRUGADA)` JÁ É o teste "está
  // de madrugada", sem precisar negar.
  const leadsQualificadosMadrugada = conversasPeriodo.filter(
    (c) => (c.totalMensagensCliente ?? 0) > 0 && foraDoExpediente(new Date(c.criadaEm), janela)
  ).length;

  const agendamentosConfirmados = input.tickets.filter(
    (t) =>
      t.workspaceId === input.workspaceId &&
      dentroDoPeriodo(t.criadoEm, periodo) &&
      t.status !== "cancelado" &&
      MOTIVOS_AGENDAMENTO_VALIDADO.has(t.motivo)
  ).length;

  const valorMedioPipelineUsadoBrl =
    input.valorMedioPipelineBrl ?? VALOR_MEDIO_PIPELINE_PADRAO_BRL[input.setor] ?? 0;

  return {
    workspaceId: input.workspaceId,
    setor: input.setor,
    atendimentos: conversasPeriodo.length,
    leadsQualificadosMadrugada,
    agendamentosConfirmados,
    valorMedioPipelineUsadoBrl,
    pipelineEstimadoBrl: agendamentosConfirmados * valorMedioPipelineUsadoBrl,
  };
}

export interface MetricasPipelineVerticalAgregada {
  setor: NicheKey;
  workspacesContribuintes: number;
  atendimentos: number;
  leadsQualificadosMadrugada: number;
  agendamentosConfirmados: number;
  pipelineEstimadoBrl: number;
}

export interface RoiDashboardCLevelSnapshot {
  porVertical: MetricasPipelineVerticalAgregada[];
  atendimentosTotais: number;
  leadsQualificadosMadrugadaTotais: number;
  agendamentosConfirmadosTotais: number;
  pipelineTotalEstimadoBrl: number;
  periodo: RoiPeriodo;
  geradoEm: string;
}

/**
 * Agrega métricas de pipeline de múltiplos workspaces por vertical — a
 * visão "painel do C-Level" propriamente dita (ex.: uma agência gerindo
 * vários workspaces de clientes em verticais diferentes). Função pura:
 * nenhuma leitura de Firestore aqui, só agregação.
 */
export function agregarPipelinePorVertical(
  metricasPorWorkspace: MetricasPipelineVertical[],
  periodo: RoiPeriodo,
  agora: Date = new Date()
): RoiDashboardCLevelSnapshot {
  const porSetor = new Map<NicheKey, MetricasPipelineVerticalAgregada>();

  for (const metrica of metricasPorWorkspace) {
    const atual = porSetor.get(metrica.setor) ?? {
      setor: metrica.setor,
      workspacesContribuintes: 0,
      atendimentos: 0,
      leadsQualificadosMadrugada: 0,
      agendamentosConfirmados: 0,
      pipelineEstimadoBrl: 0,
    };

    porSetor.set(metrica.setor, {
      setor: metrica.setor,
      workspacesContribuintes: atual.workspacesContribuintes + 1,
      atendimentos: atual.atendimentos + metrica.atendimentos,
      leadsQualificadosMadrugada: atual.leadsQualificadosMadrugada + metrica.leadsQualificadosMadrugada,
      agendamentosConfirmados: atual.agendamentosConfirmados + metrica.agendamentosConfirmados,
      pipelineEstimadoBrl: atual.pipelineEstimadoBrl + metrica.pipelineEstimadoBrl,
    });
  }

  const porVertical = [...porSetor.values()].sort((a, b) => b.pipelineEstimadoBrl - a.pipelineEstimadoBrl);

  return {
    porVertical,
    atendimentosTotais: metricasPorWorkspace.reduce((acc, m) => acc + m.atendimentos, 0),
    leadsQualificadosMadrugadaTotais: metricasPorWorkspace.reduce((acc, m) => acc + m.leadsQualificadosMadrugada, 0),
    agendamentosConfirmadosTotais: metricasPorWorkspace.reduce((acc, m) => acc + m.agendamentosConfirmados, 0),
    pipelineTotalEstimadoBrl: metricasPorWorkspace.reduce((acc, m) => acc + m.pipelineEstimadoBrl, 0),
    periodo,
    geradoEm: agora.toISOString(),
  };
}

/**
 * Lê conversas + tickets do workspace e o `setor` configurado, via Admin
 * SDK, e calcula as métricas de pipeline. Separado de
 * `calcularMetricasPipelineVertical` (pura) para que a lógica de negócio
 * continue testável sem Firestore — mesmo desenho de
 * `executarFluxo`/`executarFluxoReal` em `@/lib/server/orchestrator(Admin)`.
 *
 * Contrato de resiliência (bug real em produção: a aba "Oportunidade &
 * Pipeline" respondia HTTP 500 — ver `/api/roi-dashboard`): esta função
 * NUNCA deixa uma falha pontual de leitura (rede instável, Admin SDK
 * indisponível, etc.) escapar como exceção — degrada para `null`
 * (`disponivel: false`, o mesmo estado normal de "workspace sem setor"), e
 * loga o motivo real no servidor para diagnóstico. Antes, só
 * `obterDashboardCLevelAdmin` (que itera vários workspaces) tinha esse
 * try/catch por fora; o caminho direto usado por `/api/roi-dashboard`
 * (um único workspace) não tinha proteção nenhuma e propagava qualquer
 * exceção até o catch-all genérico de `comGuarda` → 500 para o dono do
 * negócio. A garantia agora vive na própria função, para qualquer chamador.
 */
export async function obterMetricasPipelineVerticalAdmin(
  workspaceId: string,
  opcoes: { periodo?: RoiPeriodo; valorMedioPipelineBrl?: number; referencia?: Date } = {}
): Promise<MetricasPipelineVertical | null> {
  try {
    const db = firestoreAdmin();

    const workspaceSnap = await db.collection("workspaces").doc(workspaceId).get();
    if (!workspaceSnap.exists) return null;
    const setor = (workspaceSnap.data() as { setor?: unknown }).setor;
    if (typeof setor !== "string") return null;

    const [conversasSnap, ticketsSnap] = await Promise.all([
      db.collection("conversations").where("workspaceId", "==", workspaceId).get(),
      db.collection("hitlTickets").where("workspaceId", "==", workspaceId).get(),
    ]);

    return calcularMetricasPipelineVertical({
      workspaceId,
      setor: setor as NicheKey,
      // Nunca conta conversa de demonstração do Simulador de Payload do
      // Sandbox (`origemSandbox`) como pipeline real — mesma regra do
      // caminho client-side (`subscribeConversations`, `@/lib/inbox/firestore`).
      conversas: conversasSnap.docs
        .map((d) => d.data() as Conversation)
        .filter((c) => !c.origemSandbox),
      tickets: ticketsSnap.docs.map((d) => d.data() as HandoffTicket),
      periodo: opcoes.periodo,
      valorMedioPipelineBrl: opcoes.valorMedioPipelineBrl,
      referencia: opcoes.referencia,
    });
  } catch (erro) {
    console.error(`[roi-dashboard] falha ao calcular métricas de pipeline do workspace ${workspaceId}:`, erro);
    return null;
  }
}

/**
 * Monta o Painel de ROI do C-Level para um conjunto de workspaces — lê cada
 * um via `obterMetricasPipelineVerticalAdmin` e agrega por vertical.
 * Workspaces sem `setor` configurado ou inexistentes são ignorados (best-
 * effort), nunca derrubam o painel inteiro por um workspace malformado.
 */
export async function obterDashboardCLevelAdmin(
  workspaceIds: string[],
  opcoes: { periodo?: RoiPeriodo; referencia?: Date } = {}
): Promise<RoiDashboardCLevelSnapshot> {
  const referencia = opcoes.referencia ?? new Date();
  const periodo = opcoes.periodo ?? periodoMesAtual(referencia);

  const resultados = await Promise.all(
    workspaceIds.map(async (workspaceId) => {
      try {
        return await obterMetricasPipelineVerticalAdmin(workspaceId, { periodo, referencia });
      } catch (erro) {
        console.error(`[roi-dashboard] falha ao ler métricas do workspace ${workspaceId}:`, erro);
        return null;
      }
    })
  );

  const metricas = resultados.filter((m): m is MetricasPipelineVertical => m !== null);
  return agregarPipelinePorVertical(metricas, periodo, referencia);
}
