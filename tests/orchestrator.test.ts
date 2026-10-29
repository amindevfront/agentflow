import { describe, expect, it } from "vitest";
import type { ExecutorLlm } from "@/lib/guardrails";
import type { Flow, FlowRun, HandoffTicket } from "@/types";
import {
  executarFluxo,
  montarPrompt,
  novoAcumuladorUso,
  type AcumuladorUso,
  type PortasExecucao,
} from "@/lib/server/orchestrator";
import { ErroApi } from "@/lib/server/http";
import { calcularRoi, ROI_CONFIG_PADRAO } from "@/lib/roi";

const FLOW_BASE: Flow = {
  id: "flow-1",
  workspaceId: "ws-1",
  nome: "Triagem de pedidos",
  gatilho: "webhook",
  origem: "loja online",
  status: "ocioso",
  atualizadoEm: "2026-03-15T00:00:00.000Z",
  steps: [{ id: "etapa-1", titulo: "Receber gatilho" }],
};

/**
 * Portas em memória — nenhuma delas toca em Firestore, Admin SDK ou rede.
 * Isso é o que permite provar, em teste, que a integração completa
 * (guardrails → acumulador de uso → RunCostMetrics → calcularRoi) produz
 * números reais e não-zerados, sem depender de infraestrutura externa.
 */
function criarPortasFalsas(flow: Flow = FLOW_BASE) {
  const flowRunsEscritos: FlowRun[] = [];
  const ticketsAbertos: HandoffTicket[] = [];
  const workspacePorUsuario = new Map<string, string>([["uid-dono", flow.workspaceId]]);

  const portas: PortasExecucao = {
    async lerFlow(flowId) {
      return flowId === flow.id ? flow : null;
    },
    async lerWorkspaceIdDoUsuario(uid) {
      return workspacePorUsuario.get(uid) ?? null;
    },
    async escreverFlowRun(run) {
      flowRunsEscritos.push(run);
    },
    async abrirTransbordo(entrada) {
      const ticket: HandoffTicket = {
        id: `hitl_${ticketsAbertos.length + 1}`,
        workspaceId: entrada.workspaceId,
        flowId: entrada.flowId,
        flowNome: entrada.flowNome,
        runId: entrada.runId,
        traceId: entrada.solicitacao.traceId,
        motivo: "guardrail-revisao",
        status: "aberto",
        prioridade: "p2",
        severidade: entrada.solicitacao.severidade,
        violacoes: entrada.solicitacao.violacoes,
        payloadMascarado: entrada.solicitacao.payloadMascarado,
        criadoEm: new Date().toISOString(),
        criadoPor: entrada.criadoPor,
        slaExpiraEm: new Date(Date.now() + 3_600_000).toISOString(),
        atribuidoPara: null,
        atribuidoEm: null,
      };
      ticketsAbertos.push(ticket);
      return ticket;
    },
  };

  return { portas, flowRunsEscritos, ticketsAbertos };
}

/** Executor determinístico: devolve uma resposta fixa e registra uso fixo de tokens. */
function criarExecutorFalso(
  tokensEntrada: number,
  tokensSaida: number,
  custoUsd: number,
  resposta = "Pedido processado com sucesso."
): (acumulador: AcumuladorUso) => ExecutorLlm {
  return (acumulador) => {
    acumulador.modelo = "modelo-de-teste";
    return async () => {
      acumulador.tokensEntrada += tokensEntrada;
      acumulador.tokensSaida += tokensSaida;
      acumulador.custoUsd += custoUsd;
      acumulador.chamadas += 1;
      return resposta;
    };
  };
}

describe("montarPrompt", () => {
  it("inclui o contexto do fluxo e preserva marcadores de PII intactos", () => {
    const prompt = montarPrompt(FLOW_BASE, "Cliente [[PII:CPF:1]] solicitou reembolso.");
    expect(prompt).toContain(FLOW_BASE.nome);
    expect(prompt).toContain(FLOW_BASE.gatilho);
    expect(prompt).toContain("[[PII:CPF:1]]");
  });

  // Auto-Feedback de Conversão: `contextoConversao` é o canal real pelo qual
  // os desfechos comerciais registrados na Neural Inbox chegam ao prompt da
  // próxima execução do mesmo workspace/nicho (ver `@/lib/inbox/conversionFeedback`).
  it("omite o bloco de contexto de conversão quando ausente (retrocompatibilidade)", () => {
    const prompt = montarPrompt(FLOW_BASE, "payload qualquer");
    expect(prompt).not.toContain("Contexto de conversão");
  });

  it("injeta o contexto de conversão quando fornecido", () => {
    const prompt = montarPrompt(
      FLOW_BASE,
      "payload qualquer",
      "68% fechados, 25% perdidos por preço, 7% perdidos por falta de agenda."
    );
    expect(prompt).toContain("Contexto de conversão");
    expect(prompt).toContain("68% fechados");
  });

  it("não injeta nada quando o contexto de conversão é null ou string vazia", () => {
    expect(montarPrompt(FLOW_BASE, "payload", null)).not.toContain("Contexto de conversão");
    expect(montarPrompt(FLOW_BASE, "payload", "")).not.toContain("Contexto de conversão");
  });
});

describe("executarFluxo — integração completa (guardrails → métrica → ROI)", () => {
  it("produz um FlowRun concluído com métrica real e não-zerada", async () => {
    const { portas, flowRunsEscritos } = criarPortasFalsas();

    const resultado = await executarFluxo({
      flowId: FLOW_BASE.id,
      payload: "Pedido PED-001 recebido para processamento.",
      usuario: { uid: "uid-dono" },
      criarExecutor: criarExecutorFalso(150, 60, 0.0021),
      portas,
    });

    expect(resultado.bloqueado).toBe(false);
    expect(resultado.transbordo).toBe(false);
    expect(resultado.run.status).toBe("concluido");

    // A métrica não pode estar zerada — é exatamente a falha que esta
    // integração corrige (painel de ROI sem dados reais).
    expect(resultado.run.metrica?.tokensEntrada).toBe(150);
    expect(resultado.run.metrica?.tokensSaida).toBe(60);
    expect(resultado.run.metrica?.custoModeloUsd).toBeCloseTo(0.0021, 6);
    expect(resultado.run.metrica?.intervencaoHumana).toBe(false);
    expect(flowRunsEscritos).toHaveLength(1);
    expect(flowRunsEscritos[0]).toBe(resultado.run);
  });

  it("alimenta calcularRoi com números reais, não estimados", async () => {
    const { portas } = criarPortasFalsas();

    const { run } = await executarFluxo({
      flowId: FLOW_BASE.id,
      payload: "Pedido PED-002 recebido.",
      usuario: { uid: "uid-dono" },
      criarExecutor: criarExecutorFalso(1000, 400, 0.01),
      portas,
    });

    const snapshot = calcularRoi({
      execucoes: [run],
      config: ROI_CONFIG_PADRAO,
      referencia: new Date(run.iniciadoEm),
    });

    expect(snapshot.tokensTotais).toBe(1400);
    expect(snapshot.custoIaBrl).toBeGreaterThan(0);
    expect(snapshot.execucoesSemTelemetria).toBe(0);
    expect(snapshot.cobertura).toBe(1);
    expect(snapshot.horasEconomizadasBrutas).toBeGreaterThan(0);
  });

  it("mascara PII do payload antes de enviá-lo ao executor", async () => {
    const { portas } = criarPortasFalsas();
    let payloadRecebidoPeloExecutor = "";

    const criarExecutorEspiao = (acumulador: AcumuladorUso): ExecutorLlm => {
      acumulador.modelo = "modelo-de-teste";
      return async (payloadSanitizado) => {
        payloadRecebidoPeloExecutor = payloadSanitizado;
        acumulador.tokensEntrada += 10;
        acumulador.tokensSaida += 5;
        acumulador.chamadas += 1;
        return "ok";
      };
    };

    await executarFluxo({
      flowId: FLOW_BASE.id,
      payload: "Cliente com CPF 529.982.247-25 solicitou reembolso.",
      usuario: { uid: "uid-dono" },
      criarExecutor: criarExecutorEspiao,
      portas,
    });

    expect(payloadRecebidoPeloExecutor).not.toContain("529.982.247-25");
    expect(payloadRecebidoPeloExecutor).toContain("[[PII:CPF:1]]");
  });

  it("rejeita a execução quando o usuário não pertence ao workspace do fluxo", async () => {
    const { portas } = criarPortasFalsas();

    await expect(
      executarFluxo({
        flowId: FLOW_BASE.id,
        payload: "qualquer coisa",
        usuario: { uid: "uid-intruso" },
        criarExecutor: criarExecutorFalso(10, 5, 0.0001),
        portas,
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("devolve 404 para um fluxo inexistente", async () => {
    const { portas } = criarPortasFalsas();

    await expect(
      executarFluxo({
        flowId: "flow-fantasma",
        payload: "qualquer coisa",
        usuario: { uid: "uid-dono" },
        criarExecutor: criarExecutorFalso(10, 5, 0.0001),
        portas,
      })
    ).rejects.toBeInstanceOf(ErroApi);
  });

  it("abre ticket de transbordo quando o guardrail bloqueia a entrada, e marca intervençãoHumana", async () => {
    const { portas, ticketsAbertos } = criarPortasFalsas();

    const resultado = await executarFluxo({
      flowId: FLOW_BASE.id,
      // Credencial no payload é severidade crítica → veredito bloqueado na
      // política padrão, o que aciona `aoTransbordar` antes de chamar o executor.
      payload: "token sk-ant-abcdefghijklmnopqrstuvwxyz0123",
      usuario: { uid: "uid-dono" },
      criarExecutor: criarExecutorFalso(999, 999, 999),
      portas,
    });

    expect(resultado.bloqueado).toBe(true);
    expect(resultado.run.status).toBe("falhou");
    expect(resultado.run.metrica?.intervencaoHumana).toBe(true);
    // O executor nunca deveria ter sido chamado — entrada bloqueada não chega
    // a sair para o provedor de LLM.
    expect(resultado.run.metrica?.tokensEntrada).toBe(0);
    expect(ticketsAbertos).toHaveLength(1);
    expect(resultado.ticketsAbertos).toHaveLength(1);
  });

  it("usa a política padrão (uma amostra) e contabiliza exatamente essa chamada", async () => {
    // `executarFluxo` sempre resolve a política "padrao" (amostrasConsistencia:
    // 1) — não há, hoje, um conceito de "fluxo crítico" no modelo de dados de
    // `Flow` (ver limitação documentada em `orchestratorAdmin.ts`). Este teste
    // fixa esse comportamento: exatamente uma chamada ao executor, cujo uso é
    // integralmente refletido na métrica — nenhuma chamada "fantasma" e
    // nenhuma perda de contagem.
    const { portas } = criarPortasFalsas();
    let chamadasExecutor = 0;

    const criarExecutorComContador = (acumulador: AcumuladorUso): ExecutorLlm => {
      acumulador.modelo = "modelo-de-teste";
      return async () => {
        chamadasExecutor += 1;
        acumulador.tokensEntrada += 100;
        acumulador.tokensSaida += 40;
        acumulador.chamadas += 1;
        return "Pedido confirmado e processado.";
      };
    };

    const resultado = await executarFluxo({
      flowId: FLOW_BASE.id,
      payload: "Pedido de alto valor.",
      usuario: { uid: "uid-dono" },
      criarExecutor: criarExecutorComContador,
      portas,
    });

    expect(chamadasExecutor).toBe(1);
    expect(resultado.run.metrica?.tokensEntrada).toBe(100);
    expect(resultado.run.metrica?.tokensSaida).toBe(40);
  });
});

describe("novoAcumuladorUso", () => {
  it("começa zerado", () => {
    const acumulador = novoAcumuladorUso();
    expect(acumulador).toEqual({ tokensEntrada: 0, tokensSaida: 0, custoUsd: 0, chamadas: 0 });
  });
});
