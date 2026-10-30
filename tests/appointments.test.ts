import { describe, expect, it } from "vitest";
import type { Appointment, AppointmentStatus } from "@/types";
import {
  calcularCheckInsPosAtendimentoPendentes,
  calcularJanelasPendentes,
  textoConfirmacao,
  textoPosAtendimento,
} from "@/lib/appointments";

const AGORA = new Date(2026, 0, 10, 12, 0, 0);

function horasAFrente(horas: number): string {
  return new Date(AGORA.getTime() + horas * 60 * 60 * 1000).toISOString();
}

function criarAgendamento(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appt_1",
    workspaceId: "default",
    conversationId: "conv_1",
    pacienteNome: "Maria Souza",
    procedimento: "Consulta de retorno",
    dataHora: horasAFrente(23),
    status: "agendado",
    diretrizesPreparo: "Jejum de 8h.",
    confirmacao24hEnviadaEm: null,
    confirmacao2hEnviadaEm: null,
    posAtendimentoEnviadoEm: null,
    criadoEm: AGORA.toISOString(),
    criadoPor: "uid_1",
    ...overrides,
  };
}

describe("calcularJanelasPendentes", () => {
  it("precisa de confirmação 24h quando faltam 23h e ainda não foi enviada", () => {
    const resultado = calcularJanelasPendentes([criarAgendamento({ dataHora: horasAFrente(23) })], AGORA);
    expect(resultado.precisamConfirmacao24h).toHaveLength(1);
    expect(resultado.precisamConfirmacao2h).toHaveLength(0);
  });

  it("não precisa de confirmação 24h quando faltam mais de 24h", () => {
    const resultado = calcularJanelasPendentes([criarAgendamento({ dataHora: horasAFrente(25) })], AGORA);
    expect(resultado.precisamConfirmacao24h).toHaveLength(0);
  });

  it("não repete a confirmação 24h já enviada, mesmo dentro da janela", () => {
    const resultado = calcularJanelasPendentes(
      [criarAgendamento({ dataHora: horasAFrente(20), confirmacao24hEnviadaEm: AGORA.toISOString() })],
      AGORA
    );
    expect(resultado.precisamConfirmacao24h).toHaveLength(0);
  });

  it("precisa de confirmação 2h quando falta 1h e ainda não foi enviada", () => {
    const resultado = calcularJanelasPendentes(
      [criarAgendamento({ dataHora: horasAFrente(1), confirmacao24hEnviadaEm: AGORA.toISOString() })],
      AGORA
    );
    expect(resultado.precisamConfirmacao2h).toHaveLength(1);
  });

  it("um agendamento pode precisar das duas janelas ao mesmo tempo se nenhuma foi enviada e já está dentro de 2h", () => {
    const resultado = calcularJanelasPendentes([criarAgendamento({ dataHora: horasAFrente(1.5) })], AGORA);
    expect(resultado.precisamConfirmacao24h).toHaveLength(1);
    expect(resultado.precisamConfirmacao2h).toHaveLength(1);
  });

  it("ignora agendamentos já passados (sem janela de antecedência, é atraso)", () => {
    const resultado = calcularJanelasPendentes([criarAgendamento({ dataHora: horasAFrente(-1) })], AGORA);
    expect(resultado.precisamConfirmacao24h).toHaveLength(0);
    expect(resultado.precisamConfirmacao2h).toHaveLength(0);
  });

  it.each(["cancelado", "no-show", "realizado"] as AppointmentStatus[])(
    "nunca precisa de lembrete com status '%s', mesmo dentro da janela",
    (status) => {
      const resultado = calcularJanelasPendentes([criarAgendamento({ dataHora: horasAFrente(1), status })], AGORA);
      expect(resultado.precisamConfirmacao24h).toHaveLength(0);
      expect(resultado.precisamConfirmacao2h).toHaveLength(0);
    }
  );

  it("lista vazia não precisa de nenhuma janela", () => {
    const resultado = calcularJanelasPendentes([], AGORA);
    expect(resultado.precisamConfirmacao24h).toEqual([]);
    expect(resultado.precisamConfirmacao2h).toEqual([]);
  });
});

describe("textoConfirmacao", () => {
  it("a confirmação de 24h inclui as diretrizes de preparo quando presentes", () => {
    const texto = textoConfirmacao(criarAgendamento({ diretrizesPreparo: "Jejum de 8h." }), "24h");
    expect(texto).toContain("Jejum de 8h.");
  });

  it("a confirmação de 24h funciona sem diretrizes de preparo", () => {
    const texto = textoConfirmacao(criarAgendamento({ diretrizesPreparo: undefined }), "24h");
    expect(texto).not.toContain("undefined");
  });

  it("a confirmação de 2h não repete as diretrizes de preparo", () => {
    const texto = textoConfirmacao(criarAgendamento({ diretrizesPreparo: "Jejum de 8h." }), "2h");
    expect(texto).not.toContain("Jejum de 8h.");
  });

  it("sempre menciona o nome do paciente e o procedimento", () => {
    const agendamento = criarAgendamento({ pacienteNome: "João Pereira", procedimento: "Exame de imagem" });
    expect(textoConfirmacao(agendamento, "24h")).toContain("João Pereira");
    expect(textoConfirmacao(agendamento, "24h")).toContain("Exame de imagem");
  });
});

describe("calcularCheckInsPosAtendimentoPendentes", () => {
  it("não precisa de checagem antes de 48h do procedimento realizado", () => {
    const resultado = calcularCheckInsPosAtendimentoPendentes(
      [criarAgendamento({ status: "realizado", dataHora: horasAFrente(-47) })],
      AGORA
    );
    expect(resultado).toHaveLength(0);
  });

  it("precisa de checagem entre 48h e 72h depois do procedimento realizado", () => {
    const resultado = calcularCheckInsPosAtendimentoPendentes(
      [criarAgendamento({ status: "realizado", dataHora: horasAFrente(-50) })],
      AGORA
    );
    expect(resultado).toHaveLength(1);
  });

  it("não precisa de checagem depois de 72h — a janela ideal já passou", () => {
    const resultado = calcularCheckInsPosAtendimentoPendentes(
      [criarAgendamento({ status: "realizado", dataHora: horasAFrente(-73) })],
      AGORA
    );
    expect(resultado).toHaveLength(0);
  });

  it("não repete a checagem já enviada, mesmo dentro da janela", () => {
    const resultado = calcularCheckInsPosAtendimentoPendentes(
      [
        criarAgendamento({
          status: "realizado",
          dataHora: horasAFrente(-50),
          posAtendimentoEnviadoEm: AGORA.toISOString(),
        }),
      ],
      AGORA
    );
    expect(resultado).toHaveLength(0);
  });

  it.each(["agendado", "confirmado", "no-show", "cancelado"] as AppointmentStatus[])(
    "nunca precisa de checagem com status '%s', mesmo dentro da janela de tempo",
    (status) => {
      const resultado = calcularCheckInsPosAtendimentoPendentes(
        [criarAgendamento({ status, dataHora: horasAFrente(-50) })],
        AGORA
      );
      expect(resultado).toHaveLength(0);
    }
  );

  it("lista vazia não precisa de nenhuma checagem", () => {
    expect(calcularCheckInsPosAtendimentoPendentes([], AGORA)).toEqual([]);
  });
});

describe("textoPosAtendimento", () => {
  it("menciona o nome do paciente e o procedimento, e convida a relatar qualquer problema", () => {
    const texto = textoPosAtendimento(
      criarAgendamento({ pacienteNome: "Ana Lima", procedimento: "Procedimento estético" })
    );
    expect(texto).toContain("Ana Lima");
    expect(texto).toContain("Procedimento estético");
    expect(texto.toLowerCase()).toContain("desconforto");
  });
});
