import { describe, expect, it } from "vitest";
import {
  LIMIAR_FRUSTRACAO_CRITICA,
  analisarSentimentoMensagem,
  calcularFrustration,
  gerarExecutiveBrief,
} from "@/lib/sentiment/radar";

describe("analisarSentimentoMensagem", () => {
  it("não acusa nada em mensagem neutra", () => {
    const resultado = analisarSentimentoMensagem("Olá, gostaria de saber o status do meu pedido.");
    expect(resultado.score).toBe(0);
    expect(resultado.sinais).toEqual([]);
  });

  it("detecta risco de cancelamento", () => {
    const resultado = analisarSentimentoMensagem("Quero cancelar meu plano agora mesmo.");
    expect(resultado.score).toBeGreaterThan(0);
    expect(resultado.sinais).toContain("risco de cancelamento");
  });

  it("detecta ameaça regulatória/jurídica com peso alto", () => {
    const resultado = analisarSentimentoMensagem("Vou abrir uma reclamação no procon se isso não for resolvido.");
    expect(resultado.sinais).toContain("ameaça regulatória/jurídica");
    expect(resultado.score).toBeGreaterThanOrEqual(28);
  });

  it("detecta caixa alta apenas com letras suficientes", () => {
    const curto = analisarSentimentoMensagem("OK");
    expect(curto.sinais).not.toContain("texto em caixa alta");

    const longo = analisarSentimentoMensagem("ISSO NAO PODE CONTINUAR ACONTECENDO");
    expect(longo.sinais).toContain("texto em caixa alta");
  });

  it("detecta pontuação de ênfase repetida", () => {
    const resultado = analisarSentimentoMensagem("Isso é inaceitável!!! Preciso de uma resposta!!!");
    expect(resultado.sinais).toContain("pontuação de ênfase repetida");
  });

  it("marcadores de PII mascarada não distorcem o score", () => {
    const comPii = analisarSentimentoMensagem("Meu CPF é [[PII:CPF:1]], só isso.");
    expect(comPii.score).toBe(0);
  });

  it("nunca excede 100", () => {
    const resultado = analisarSentimentoMensagem(
      "CANCELAR CANCELAR CANCELAR!!! PROCON ADVOGADO PROCESSO NUNCA MAIS PÉSSIMO ABSURDO RIDÍCULO!!!"
    );
    expect(resultado.score).toBeLessThanOrEqual(100);
  });
});

describe("calcularFrustration", () => {
  it("devolve índice zero para conversa sem mensagens do cliente", () => {
    const resultado = calcularFrustration({ mensagensCliente: [], slaRespostaSegundos: 300 });
    expect(resultado.indice).toBe(0);
    expect(resultado.circuitBreakerAtivado).toBe(false);
  });

  it("pondera a mensagem mais recente mais que as antigas", () => {
    const comecouIrritado = calcularFrustration({
      mensagensCliente: ["Isso é um absurdo, péssimo atendimento!", "Ok, entendi, obrigado pela ajuda."],
      slaRespostaSegundos: 300,
    });
    const terminouIrritado = calcularFrustration({
      mensagensCliente: ["Ok, entendi, obrigado pela ajuda.", "Isso é um absurdo, péssimo atendimento!"],
      slaRespostaSegundos: 300,
    });
    expect(terminouIrritado.indice).toBeGreaterThan(comecouIrritado.indice);
  });

  it("aciona o circuit breaker acima do limiar crítico", () => {
    const resultado = calcularFrustration({
      mensagensCliente: [
        "Isso é um absurdo, vou cancelar e vou abrir reclamação no procon e chamar um advogado!!!",
      ],
      slaRespostaSegundos: 300,
    });
    expect(resultado.indice).toBeGreaterThanOrEqual(LIMIAR_FRUSTRACAO_CRITICA);
    expect(resultado.circuitBreakerAtivado).toBe(true);
  });

  it("não aciona o circuit breaker para mensagem neutra", () => {
    const resultado = calcularFrustration({
      mensagensCliente: ["Olá, bom dia, gostaria de saber o status do meu pedido."],
      slaRespostaSegundos: 300,
    });
    expect(resultado.circuitBreakerAtivado).toBe(false);
  });

  it("penaliza latência de resposta acima do SLA", () => {
    const semEspera = calcularFrustration({
      mensagensCliente: ["Ainda não recebi retorno sobre meu problema."],
      latenciaRespostaSegundos: 60,
      slaRespostaSegundos: 300,
    });
    const comEsperaLonga = calcularFrustration({
      mensagensCliente: ["Ainda não recebi retorno sobre meu problema."],
      latenciaRespostaSegundos: 3600,
      slaRespostaSegundos: 300,
    });
    expect(comEsperaLonga.indice).toBeGreaterThan(semEspera.indice);
    expect(comEsperaLonga.sinais).toContain("tempo de resposta acima do SLA");
  });

  it("não penaliza latência dentro do SLA", () => {
    const resultado = calcularFrustration({
      mensagensCliente: ["Tudo bem, obrigado."],
      latenciaRespostaSegundos: 100,
      slaRespostaSegundos: 300,
    });
    expect(resultado.sinais).not.toContain("tempo de resposta acima do SLA");
  });

  it("detecta reclamação repetida entre as duas últimas mensagens do cliente", () => {
    const resultado = calcularFrustration({
      mensagensCliente: [
        "Meu pedido não chegou e já faz uma semana.",
        "Meu pedido ainda não chegou, já faz uma semana inteira.",
      ],
      slaRespostaSegundos: 300,
    });
    expect(resultado.sinais).toContain("reclamação repetida sem solução");
  });

  it("não acusa repetição quando as mensagens são claramente diferentes", () => {
    const resultado = calcularFrustration({
      mensagensCliente: ["Qual o horário de funcionamento da loja?", "Vocês entregam no final de semana?"],
      slaRespostaSegundos: 300,
    });
    expect(resultado.sinais).not.toContain("reclamação repetida sem solução");
  });

  it("identifica tendência subindo quando a última mensagem piora", () => {
    const resultado = calcularFrustration({
      mensagensCliente: ["Oi, tudo bem?", "Isso é um absurdo, péssimo atendimento, quero cancelar!!!"],
      slaRespostaSegundos: 300,
    });
    expect(resultado.tendencia).toBe("subindo");
  });

  it("identifica tendência descendo quando a última mensagem melhora", () => {
    const resultado = calcularFrustration({
      mensagensCliente: ["Isso é um absurdo, péssimo atendimento, quero cancelar!!!", "Ah entendi, tudo bem então, obrigado."],
      slaRespostaSegundos: 300,
    });
    expect(resultado.tendencia).toBe("descendo");
  });

  it("nunca produz índice fora de [0, 100] mesmo no pior caso combinado", () => {
    const resultado = calcularFrustration({
      mensagensCliente: [
        "CANCELAR AGORA, PROCON, ADVOGADO, PROCESSO, NUNCA MAIS, PÉSSIMO, ABSURDO!!!",
        "CANCELAR AGORA, PROCON, ADVOGADO, PROCESSO, NUNCA MAIS, PÉSSIMO, ABSURDO!!!",
      ],
      latenciaRespostaSegundos: 999_999,
      slaRespostaSegundos: 60,
    });
    expect(resultado.indice).toBeLessThanOrEqual(100);
    expect(resultado.indice).toBeGreaterThanOrEqual(0);
  });
});

describe("gerarExecutiveBrief", () => {
  it("sempre produz um brief determinístico, mesmo sem sinais", () => {
    const resultado = calcularFrustration({ mensagensCliente: ["Oi, tudo bem?"], slaRespostaSegundos: 300 });
    const brief = gerarExecutiveBrief(resultado);
    expect(brief.origemIA).toBe(false);
    expect(brief.scriptsSugeridos.length).toBeGreaterThan(0);
    expect(brief.resumo).toContain(String(resultado.indice));
  });

  it("prioriza o motivo mais grave entre os sinais detectados", () => {
    const resultado = calcularFrustration({
      mensagensCliente: ["Isso está demorando muito, mas vou processar vocês no procon se precisar."],
      slaRespostaSegundos: 300,
    });
    const brief = gerarExecutiveBrief(resultado);
    expect(brief.motivoProvavel).toBe("ameaça regulatória/jurídica");
  });

  it("escolhe scripts coerentes com o motivo identificado", () => {
    const resultado = calcularFrustration({
      mensagensCliente: ["Quero cancelar minha assinatura imediatamente."],
      slaRespostaSegundos: 300,
    });
    const brief = gerarExecutiveBrief(resultado);
    expect(brief.motivoProvavel).toBe("risco de cancelamento");
    expect(brief.scriptsSugeridos.join(" ")).toMatch(/cancelamento|frustração/i);
  });
});
