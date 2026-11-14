import { describe, expect, it } from "vitest";
import {
  MINUTOS_ECONOMIZADOS_POR_ORIGEM,
  ORIGENS_BACK_OFFICE_CREDITAVEIS_PELO_CLIENTE,
  construirFlowRunGanhoOperacional,
} from "@/lib/server/backOfficeRoi";

const AGORA = new Date("2026-03-15T12:00:00.000Z");

describe("MINUTOS_ECONOMIZADOS_POR_ORIGEM", () => {
  it("define um valor positivo e conservador para cada gaveta de back-office", () => {
    for (const minutos of Object.values(MINUTOS_ECONOMIZADOS_POR_ORIGEM)) {
      expect(minutos).toBeGreaterThan(0);
      expect(minutos).toBeLessThan(60);
    }
  });
});

describe("ORIGENS_BACK_OFFICE_CREDITAVEIS_PELO_CLIENTE", () => {
  it("nunca inclui uma gaveta com tick/Admin SDK próprio — essas só creditam via seu próprio tick, nunca por um membro comum chamando a rota do cliente", () => {
    expect(ORIGENS_BACK_OFFICE_CREDITAVEIS_PELO_CLIENTE).not.toContain("ar-recovery-engine");
    expect(ORIGENS_BACK_OFFICE_CREDITAVEIS_PELO_CLIENTE).not.toContain("spot-driver-onboarding");
  });

  it("inclui exatamente as gavetas sem tick próprio, onde o clique do operador É a operação concluída", () => {
    expect([...ORIGENS_BACK_OFFICE_CREDITAVEIS_PELO_CLIENTE].sort()).toEqual(["document-ai-vault", "sheet-reconciliation"]);
  });

  it("toda origem creditável pelo cliente tem uma entrada correspondente na tabela de minutos", () => {
    for (const origem of ORIGENS_BACK_OFFICE_CREDITAVEIS_PELO_CLIENTE) {
      expect(MINUTOS_ECONOMIZADOS_POR_ORIGEM[origem]).toBeGreaterThan(0);
    }
  });
});

describe("construirFlowRunGanhoOperacional", () => {
  it("monta um FlowRun concluído, zero-touch, com os minutos da tabela de referência (não do chamador)", () => {
    const run = construirFlowRunGanhoOperacional({
      workspaceId: "ws-1",
      origem: "document-ai-vault",
      descricao: "Análise de contrato X",
      agora: AGORA,
    });

    expect(run.workspaceId).toBe("ws-1");
    expect(run.status).toBe("concluido");
    expect(run.steps).toHaveLength(1);
    expect(run.steps[0].status).toBe("concluido");
    expect(run.metrica?.minutosManuaisEvitados).toBe(MINUTOS_ECONOMIZADOS_POR_ORIGEM["document-ai-vault"]);
    expect(run.metrica?.intervencaoHumana).toBe(false);
    expect(run.metrica?.tokensEntrada).toBe(0);
    expect(run.metrica?.tokensSaida).toBe(0);
  });

  it("nunca deixa o chamador inflar o próprio ganho operacional — minutos vêm sempre da tabela do servidor", () => {
    const run = construirFlowRunGanhoOperacional({
      workspaceId: "ws-1",
      origem: "sheet-reconciliation",
      descricao: "Registro reconciliado",
      agora: AGORA,
    });
    expect(run.metrica?.minutosManuaisEvitados).toBe(MINUTOS_ECONOMIZADOS_POR_ORIGEM["sheet-reconciliation"]);
  });

  it("gera um id/flowId distinto por chamada, mesmo para a mesma origem", () => {
    const run1 = construirFlowRunGanhoOperacional({ workspaceId: "ws-1", origem: "ar-recovery-engine", descricao: "a", agora: AGORA });
    const run2 = construirFlowRunGanhoOperacional({ workspaceId: "ws-1", origem: "ar-recovery-engine", descricao: "b", agora: AGORA });
    expect(run1.id).not.toBe(run2.id);
  });
});
