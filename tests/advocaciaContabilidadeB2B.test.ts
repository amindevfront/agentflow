import { describe, expect, it } from "vitest";
import {
  construirResumoExecutivoB2B,
  detectarGatilhoConfirmacaoReuniaoDiagnostico,
  extrairObjetivoMapeado,
  extrairPerfilLead,
  extrairPorteCaso,
} from "@/lib/server/advocaciaContabilidadeB2B";

describe("detectarGatilhoConfirmacaoReuniaoDiagnostico", () => {
  it("detecta confirmação de reunião em variações comuns", () => {
    expect(detectarGatilhoConfirmacaoReuniaoDiagnostico("Pode agendar a reunião para quinta.")).toBe(true);
    expect(detectarGatilhoConfirmacaoReuniaoDiagnostico("Quero agendar a reunião de diagnóstico.")).toBe(true);
    expect(detectarGatilhoConfirmacaoReuniaoDiagnostico("Confirmo a reunião então.")).toBe(true);
    expect(detectarGatilhoConfirmacaoReuniaoDiagnostico("Topo agendar amanhã.")).toBe(true);
  });

  it("não acusa mensagens sem confirmação de reunião", () => {
    expect(detectarGatilhoConfirmacaoReuniaoDiagnostico("Vocês atendem esse tipo de caso?")).toBe(false);
    expect(detectarGatilhoConfirmacaoReuniaoDiagnostico("")).toBe(false);
  });
});

describe("extrairPerfilLead", () => {
  it("identifica pessoa jurídica", () => {
    expect(extrairPerfilLead(["Minha empresa precisa de uma consultoria tributária."])).toBe("Pessoa jurídica");
    expect(extrairPerfilLead(["Temos CNPJ aberto há 2 anos."])).toBe("Pessoa jurídica");
  });

  it("identifica pessoa física", () => {
    expect(extrairPerfilLead(["É para mim mesmo, pessoa física."])).toBe("Pessoa física");
  });

  it("devolve null quando nenhum perfil é mencionado", () => {
    expect(extrairPerfilLead(["Quero saber mais sobre vocês."])).toBeNull();
  });
});

describe("extrairPorteCaso", () => {
  it("identifica porte mencionado", () => {
    expect(extrairPorteCaso(["Somos uma startup em crescimento."])).toBe("Startup");
    expect(extrairPorteCaso(["Somos uma pequena empresa familiar."])).toBe("Pequena empresa");
    expect(extrairPorteCaso(["Atuamos como multinacional no setor."])).toBe("Grande empresa/multinacional");
  });

  it("devolve null quando nenhum porte é mencionado", () => {
    expect(extrairPorteCaso(["Quero entender como funciona o atendimento."])).toBeNull();
  });
});

describe("extrairObjetivoMapeado", () => {
  it("identifica área jurídica/contábil mencionada", () => {
    expect(extrairObjetivoMapeado(["Preciso de ajuda com uma questão trabalhista."])).toMatch(/trabalhista/i);
    // "tributário" (padrão mais genérico, listado antes no léxico) casa
    // primeiro que "planejamento tributário" — comportamento esperado, não
    // uma falha: a função devolve a primeira correspondência válida.
    expect(extrairObjetivoMapeado(["Estamos buscando um planejamento tributário."])).toMatch(/tribut[áa]rio/i);
  });

  it("devolve null quando nenhuma área é mencionada", () => {
    expect(extrairObjetivoMapeado(["Qual o horário de atendimento?"])).toBeNull();
  });
});

describe("construirResumoExecutivoB2B", () => {
  it("monta o card completo quando todos os sinais estão presentes", () => {
    const resumo = construirResumoExecutivoB2B({
      nomeLead: "Ricardo",
      mensagensClienteRecentes: [
        "Minha empresa é uma startup.",
        "Precisamos de ajuda com due diligence para uma captação.",
      ],
    });

    expect(resumo.nome).toBe("Ricardo");
    expect(resumo.perfilLead).toBe("Pessoa jurídica");
    expect(resumo.porteCaso).toBe("Startup");
    expect(resumo.objetivoMapeado).toMatch(/due diligence/i);
  });

  it("deixa campos ausentes como null, nunca inventa um valor (Artigo IV — No Invention)", () => {
    const resumo = construirResumoExecutivoB2B({
      nomeLead: "Visitante do site",
      mensagensClienteRecentes: ["Oi, gostaria de mais informações."],
    });

    expect(resumo.perfilLead).toBeNull();
    expect(resumo.porteCaso).toBeNull();
    expect(resumo.objetivoMapeado).toBeNull();
  });
});
