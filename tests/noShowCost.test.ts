import { describe, expect, it } from "vitest";
import type { Appointment } from "@/types";
import { calcularCustoAgendaVazia } from "@/lib/noShowCost";

function criarAgendamento(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: `appt_${Math.random()}`,
    workspaceId: "default",
    conversationId: null,
    pacienteNome: "Cliente Teste",
    procedimento: "Procedimento Teste",
    dataHora: new Date(2026, 0, 10, 10, 0, 0).toISOString(),
    status: "agendado",
    confirmacao24hEnviadaEm: null,
    confirmacao2hEnviadaEm: null,
    posAtendimentoEnviadoEm: null,
    criadoEm: new Date(2026, 0, 1).toISOString(),
    criadoPor: "uid_1",
    ...overrides,
  };
}

describe("calcularCustoAgendaVazia", () => {
  it("devolve zeros quando não há agendamentos", () => {
    const resultado = calcularCustoAgendaVazia([]);
    expect(resultado.totalNoShow).toBe(0);
    expect(resultado.custoNoShowBrl).toBe(0);
    expect(resultado.taxaNoShow).toBe(0);
    expect(resultado.nivelAlerta).toBe("saudavel");
  });

  it("soma o custo apenas dos no-shows com valorProcedimentoBrl configurado", () => {
    const agendamentos = [
      criarAgendamento({ status: "no-show", valorProcedimentoBrl: 300 }),
      criarAgendamento({ status: "no-show", valorProcedimentoBrl: 500 }),
      criarAgendamento({ status: "no-show" }), // sem valor configurado — não entra no custo
      criarAgendamento({ status: "realizado", valorProcedimentoBrl: 400 }),
    ];
    const resultado = calcularCustoAgendaVazia(agendamentos);
    expect(resultado.totalNoShow).toBe(3);
    expect(resultado.custoNoShowBrl).toBe(800);
    expect(resultado.agendamentosSemValorConfigurado).toBe(1);
    expect(resultado.cobertura).toBeCloseTo(2 / 3, 4);
  });

  it("nunca soma cancelamentos ao custo, mesmo com valor configurado", () => {
    const agendamentos = [criarAgendamento({ status: "cancelado", valorProcedimentoBrl: 1000 })];
    const resultado = calcularCustoAgendaVazia(agendamentos);
    expect(resultado.totalCancelados).toBe(1);
    expect(resultado.custoNoShowBrl).toBe(0);
  });

  it("taxa de no-show exclui cancelamentos do denominador", () => {
    const agendamentos = [
      criarAgendamento({ status: "no-show" }),
      criarAgendamento({ status: "realizado" }),
      criarAgendamento({ status: "realizado" }),
      criarAgendamento({ status: "cancelado" }),
    ];
    const resultado = calcularCustoAgendaVazia(agendamentos);
    // 1 no-show sobre (1 no-show + 2 realizados) = 33,33%, não sobre os 4 totais.
    expect(resultado.taxaNoShow).toBeCloseTo(1 / 3, 4);
  });

  it.each([
    [0.05, "saudavel"],
    [0.15, "atencao"],
    [0.25, "critico"],
  ] as Array<[number, "saudavel" | "atencao" | "critico"]>)(
    "classifica nível de alerta pela taxa de no-show (%s)",
    (taxaAlvo, nivelEsperado) => {
      const totalRealizados = 100;
      const totalNoShow = Math.round((taxaAlvo * totalRealizados) / (1 - taxaAlvo));
      const agendamentos = [
        ...Array.from({ length: totalRealizados }, () => criarAgendamento({ status: "realizado" })),
        ...Array.from({ length: totalNoShow }, () => criarAgendamento({ status: "no-show" })),
      ];
      const resultado = calcularCustoAgendaVazia(agendamentos);
      expect(resultado.nivelAlerta).toBe(nivelEsperado);
    }
  );
});
