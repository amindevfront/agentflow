import { describe, expect, it } from "vitest";
import {
  construirResumoExecutivoClinico,
  detectarGatilhoConfirmacaoAgendamento,
  extrairHistoricoResumido,
  extrairObjecaoMapeada,
  extrairQueixaPrincipal,
} from "@/lib/server/clinicaAltoPadrao";

describe("detectarGatilhoConfirmacaoAgendamento", () => {
  it("detecta confirmação de agendamento em variações comuns", () => {
    expect(detectarGatilhoConfirmacaoAgendamento("Pode agendar para sexta-feira.")).toBe(true);
    expect(detectarGatilhoConfirmacaoAgendamento("Quero agendar a avaliação.")).toBe(true);
    expect(detectarGatilhoConfirmacaoAgendamento("Confirmo o agendamento da consulta.")).toBe(true);
    expect(detectarGatilhoConfirmacaoAgendamento("Vamos agendar então!")).toBe(true);
  });

  it("não acusa mensagens sem confirmação de agendamento", () => {
    expect(detectarGatilhoConfirmacaoAgendamento("Quais procedimentos vocês fazem?")).toBe(false);
    expect(detectarGatilhoConfirmacaoAgendamento("")).toBe(false);
  });
});

describe("extrairQueixaPrincipal", () => {
  it("identifica procedimento/queixa mencionado", () => {
    expect(extrairQueixaPrincipal(["Gostaria de fazer um preenchimento labial."])).toMatch(/preenchimento/i);
    expect(extrairQueixaPrincipal(["Tenho bastante flacidez no abdômen."])).toMatch(/flacidez/i);
  });

  it("devolve null quando nenhum procedimento/queixa é mencionado", () => {
    expect(extrairQueixaPrincipal(["Qual o horário de vocês?"])).toBeNull();
  });
});

describe("extrairHistoricoResumido", () => {
  it("identifica procedimento anterior relatado", () => {
    expect(extrairHistoricoResumido(["Já fiz botox há dois anos em outra clínica."])).toMatch(/j[áa]\s+fiz/i);
  });

  it("identifica alergia relatada", () => {
    expect(extrairHistoricoResumido(["Sou alérgica a lidocaína."])).toMatch(/al[ée]rgica/i);
  });

  it("devolve null quando nenhum histórico é mencionado", () => {
    expect(extrairHistoricoResumido(["Quero saber mais sobre o procedimento."])).toBeNull();
  });
});

describe("extrairObjecaoMapeada (clínica)", () => {
  it("identifica medo/ansiedade", () => {
    expect(extrairObjecaoMapeada(["Confesso que tenho medo de fazer isso."])).toBe(
      "Medo/ansiedade em relação ao procedimento"
    );
  });

  it("identifica preocupação com tempo de recuperação", () => {
    expect(extrairObjecaoMapeada(["A recuperação muito longa me preocupa."])).toBe(
      "Preocupação com tempo de recuperação"
    );
  });

  it("identifica preço acima do orçamento", () => {
    expect(extrairObjecaoMapeada(["Achei muito caro para o meu orçamento."])).toBe(
      "Preço acima do orçamento esperado"
    );
  });

  it("devolve null quando nenhuma objeção é identificada", () => {
    expect(extrairObjecaoMapeada(["Adorei a explicação, vamos seguir!"])).toBeNull();
  });
});

describe("construirResumoExecutivoClinico", () => {
  it("monta o card completo quando todos os sinais estão presentes", () => {
    const resumo = construirResumoExecutivoClinico({
      nomePaciente: "Carla",
      mensagensClienteRecentes: [
        "Gostaria de fazer harmonização facial.",
        "Já fiz botox antes em outra clínica.",
        "Confesso que tenho medo da recuperação.",
      ],
    });

    expect(resumo.nome).toBe("Carla");
    expect(resumo.queixaPrincipal).toMatch(/harmoniza[çc][ãa]o facial/i);
    expect(resumo.historicoResumido).toMatch(/j[áa]\s+fiz/i);
    expect(resumo.objecaoMapeada).toBe("Medo/ansiedade em relação ao procedimento");
  });

  it("deixa campos ausentes como null, nunca inventa um valor (Artigo IV — No Invention)", () => {
    const resumo = construirResumoExecutivoClinico({
      nomePaciente: "Visitante do site",
      mensagensClienteRecentes: ["Oi, gostaria de mais informações."],
    });

    expect(resumo.queixaPrincipal).toBeNull();
    expect(resumo.historicoResumido).toBeNull();
    expect(resumo.objecaoMapeada).toBeNull();
  });
});
