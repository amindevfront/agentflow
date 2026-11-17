import { describe, expect, it } from "vitest";
import {
  construirResumoExecutivoHandoff,
  detectarGatilhoAgendamentoVisita,
  extrairFaixaOrcamento,
  extrairImovelInteresse,
  detectarIntencaoCompraExplicita,
  exigeHandoverHumano,
  extrairObjecaoMapeada,
} from "@/lib/server/imobiliarioAltoPadrao";

describe("detectarGatilhoAgendamentoVisita", () => {
  it("detecta pedido de visita presencial em variações comuns", () => {
    expect(detectarGatilhoAgendamentoVisita("Quero agendar uma visita para sábado.")).toBe(true);
    expect(detectarGatilhoAgendamentoVisita("Posso marcar uma visita ainda essa semana?")).toBe(true);
    expect(detectarGatilhoAgendamentoVisita("Gostaria de conhecer o imóvel pessoalmente.")).toBe(true);
    expect(detectarGatilhoAgendamentoVisita("Será que posso ir ver o apartamento?")).toBe(true);
  });

  it("não acusa mensagens sem intenção de visita", () => {
    expect(detectarGatilhoAgendamentoVisita("Qual a metragem desse apartamento?")).toBe(false);
    expect(detectarGatilhoAgendamentoVisita("")).toBe(false);
  });
});

describe("extrairObjecaoMapeada", () => {
  it("identifica objeção de preço", () => {
    expect(extrairObjecaoMapeada(["Achei muito caro para o que oferece."])).toBe(
      "Preço acima do orçamento esperado"
    );
  });

  it("identifica indecisão", () => {
    expect(extrairObjecaoMapeada(["Vou pensar e te dou um retorno."])).toBe("Indecisão / ainda não decidiu");
  });

  it("identifica comparação com concorrente", () => {
    expect(extrairObjecaoMapeada(["Estou comparando com outra opção na mesma região."])).toBe(
      "Comparando com outra opção/concorrente"
    );
  });

  it("identifica dificuldade de financiamento", () => {
    expect(extrairObjecaoMapeada(["Infelizmente não consegui o financiamento no banco."])).toBe(
      "Dificuldade de financiamento/crédito"
    );
  });

  it("devolve null quando nenhuma objeção é identificada (nunca inventa)", () => {
    expect(extrairObjecaoMapeada(["Adorei o imóvel, vamos seguir!"])).toBeNull();
    expect(extrairObjecaoMapeada([])).toBeNull();
  });
});

describe("extrairImovelInteresse", () => {
  it("identifica tipo de imóvel mencionado", () => {
    expect(extrairImovelInteresse(["Procuro uma cobertura com vista para o mar."])).toMatch(/cobertura/i);
  });

  it("identifica bairro/destino de alto padrão", () => {
    expect(extrairImovelInteresse(["Quero algo na Praia Brava."])).toMatch(/praia brava/i);
  });

  it("devolve null quando nenhum tipo/bairro é mencionado", () => {
    expect(extrairImovelInteresse(["Qual o valor do condomínio?"])).toBeNull();
  });
});

describe("extrairFaixaOrcamento", () => {
  it("extrai faixa com 'entre X e Y'", () => {
    expect(extrairFaixaOrcamento(["Procuro algo entre 1 e 1,5 milhão."])).toMatch(/entre 1 e 1,5 milh/i);
  });

  it("extrai faixa com 'até X'", () => {
    expect(extrairFaixaOrcamento(["Meu orçamento é até 800 mil."])).toMatch(/até 800 mil/i);
  });

  it("extrai faixa com 'na faixa de X'", () => {
    expect(extrairFaixaOrcamento(["Estou na faixa de 2 milhões."])).toMatch(/na faixa de 2 milh/i);
  });

  it("nunca extrai um valor exato em R$ — isso é PII mascarada antes de chegar aqui", () => {
    // O placeholder é o que realmente chega aqui em produção (mascaramento já
    // ocorreu); nenhum padrão de faixa por extenso casa com ele.
    expect(extrairFaixaOrcamento(["Meu orçamento é [[PII:VALOR-FINANCEIRO:1]]."])).toBeNull();
  });

  it("devolve null quando nenhuma faixa é mencionada", () => {
    expect(extrairFaixaOrcamento(["Quero saber mais sobre o condomínio."])).toBeNull();
  });
});

describe("construirResumoExecutivoHandoff", () => {
  it("monta o card completo quando todos os sinais estão presentes", () => {
    const resumo = construirResumoExecutivoHandoff({
      nomeCliente: "Marina",
      mensagensClienteRecentes: [
        "Procuro uma cobertura na Praia Brava, até 1,5 milhão.",
        "Achei um pouco caro, vou pensar melhor.",
      ],
    });

    expect(resumo.nome).toBe("Marina");
    expect(resumo.imovelInteresse).toMatch(/cobertura/i);
    expect(resumo.faixaOrcamento).toMatch(/1,5 milh/i);
    expect(resumo.objecaoMapeada).toBe("Preço acima do orçamento esperado");
  });

  it("deixa campos ausentes como null, nunca inventa um valor (Artigo IV — No Invention)", () => {
    const resumo = construirResumoExecutivoHandoff({
      nomeCliente: "Visitante do site",
      mensagensClienteRecentes: ["Oi, gostaria de mais informações."],
    });

    expect(resumo.faixaOrcamento).toBeNull();
    expect(resumo.imovelInteresse).toBeNull();
    expect(resumo.objecaoMapeada).toBeNull();
  });
});

describe("detectarIntencaoCompraExplicita", () => {
  it("detecta pedido de proposta formal em variacoes comuns", () => {
    expect(detectarIntencaoCompraExplicita(["Pode me enviar uma proposta?"])?.categoria).toBe("proposta-formal");
    expect(detectarIntencaoCompraExplicita(["Quero proposta comercial por escrito"])?.categoria).toBe(
      "proposta-formal"
    );
    expect(detectarIntencaoCompraExplicita(["manda a minuta do contrato"])?.categoria).toBe("proposta-formal");
  });

  it("detecta negociacao de condicao/estrutura de pagamento", () => {
    expect(detectarIntencaoCompraExplicita(["qual o indexador do saldo devedor, INCC?"])?.categoria).toBe(
      "condicao-pagamento"
    );
    expect(detectarIntencaoCompraExplicita(["Quero entender as condicoes de pagamento"])?.categoria).toBe(
      "condicao-pagamento"
    );
    expect(detectarIntencaoCompraExplicita(["da pra parcelar a entrada?"])?.categoria).toBe("condicao-pagamento");
  });

  it("detecta pedido de reserva ou intencao de fechamento", () => {
    expect(detectarIntencaoCompraExplicita(["Quero reservar essa unidade"])?.categoria).toBe("reserva-unidade");
    expect(detectarIntencaoCompraExplicita(["vou fechar, me diz o proximo passo"])?.categoria).toBe(
      "reserva-unidade"
    );
  });

  it("devolve o trecho que disparou o gatilho — trilha de explicabilidade do handover", () => {
    const intencao = detectarIntencaoCompraExplicita(["Boa noite", "Pode me enviar uma proposta formal?"]);
    expect(intencao?.trechoDetectado.toLowerCase()).toContain("proposta");
    expect(intencao?.rotulo.length).toBeGreaterThan(0);
  });

  it("NAO dispara em interesse comum — pedir visita ou perguntar metragem nao e negociacao", () => {
    expect(detectarIntencaoCompraExplicita(["Quero agendar uma visita sabado"])).toBeNull();
    expect(detectarIntencaoCompraExplicita(["Qual a metragem da cobertura?"])).toBeNull();
    expect(detectarIntencaoCompraExplicita(["Tem vista para o mar?"])).toBeNull();
    expect(detectarIntencaoCompraExplicita([])).toBeNull();
    expect(detectarIntencaoCompraExplicita([""])).toBeNull();
  });

  it("exigeHandoverHumano espelha o detector — uma regra de negocio, um lugar", () => {
    expect(exigeHandoverHumano(["Quero reservar a unidade 1203"])).toBe(true);
    expect(exigeHandoverHumano(["Qual o horario de visitacao do decorado?"])).toBe(false);
  });

  it("varre todas as mensagens, nao so a ultima", () => {
    const mensagens = ["Pode mandar a proposta?", "Obrigado!", "Ate mais"];
    expect(exigeHandoverHumano(mensagens)).toBe(true);
  });
});
