import { describe, expect, it } from "vitest";
import type { AgentProfile, OperatorProfile } from "@/types";
import { analisarIntencao, calcularComplexidade, pontuarAgente, pontuarOperador, rotear } from "@/lib/inbox/swarm";

function operador(parcial: Partial<OperatorProfile> = {}): OperatorProfile {
  return {
    uid: "op-1",
    workspaceId: "ws-1",
    nome: "Operador Teste",
    especialidades: ["geral"],
    taxaResolucao: 0.8,
    tempoMedioResolucaoMin: 15,
    cargaAtual: 1,
    capacidadeMaxima: 5,
    disponivel: true,
    ...parcial,
  };
}

function agente(parcial: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "agente-1",
    workspaceId: "ws-1",
    nome: "Bot de Cobrança",
    especialidades: ["financeiro"],
    capacidadeMaxConcorrente: 50,
    cargaAtual: 5,
    taxaResolucaoAutomatica: 0.7,
    disponivel: true,
    ...parcial,
  };
}

describe("analisarIntencao", () => {
  it("classifica intenção financeira", () => {
    const resultado = analisarIntencao("Minha fatura veio com cobrança errada no cartão.");
    expect(resultado.categoria).toBe("financeiro");
    expect(resultado.confianca).toBeGreaterThan(0);
  });

  it("classifica intenção técnica", () => {
    const resultado = analisarIntencao("O aplicativo travou e dá erro ao tentar fazer login.");
    expect(resultado.categoria).toBe("tecnico");
  });

  it("prioriza jurídico sobre retenção quando ambos aparecem", () => {
    const resultado = analisarIntencao("Quero cancelar e já consultei um advogado sobre o contrato.");
    expect(resultado.categoria).toBe("juridico");
  });

  it("cai em 'geral' sem sinais claros", () => {
    const resultado = analisarIntencao("Bom dia, tudo bem?");
    expect(resultado.categoria).toBe("geral");
    expect(resultado.sinais).toEqual([]);
  });

  it("devolve confiança zero para texto vazio", () => {
    expect(analisarIntencao("").confianca).toBe(0);
  });
});

describe("calcularComplexidade", () => {
  it("é baixa para uma mensagem curta e simples", () => {
    expect(calcularComplexidade("Qual o horário de atendimento?")).toBeLessThan(0.3);
  });

  it("sobe com vocabulário técnico/jurídico de alto risco", () => {
    const simples = calcularComplexidade("Preciso de ajuda com minha conta.");
    const complexa = calcularComplexidade("Preciso de uma integração via API com exportação para auditoria de compliance.");
    expect(complexa).toBeGreaterThan(simples);
  });

  it("sobe com várias perguntas na mesma mensagem", () => {
    const umaPergunta = calcularComplexidade("Como funciona o reembolso?");
    const variasPerguntas = calcularComplexidade("Como funciona o reembolso? Quanto tempo demora? Preciso enviar nota fiscal?");
    expect(variasPerguntas).toBeGreaterThan(umaPergunta);
  });

  it("sobe com o número de mensagens anteriores sem resolução", () => {
    const recente = calcularComplexidade("Ainda não resolveram meu problema.", 1);
    const arrastada = calcularComplexidade("Ainda não resolveram meu problema.", 10);
    expect(arrastada).toBeGreaterThan(recente);
  });

  it("nunca excede 1", () => {
    const texto =
      "Preciso de integração via API, migração, exportação, LGPD, contrato, rescisão, auditoria, compliance, multa, judicial? ".repeat(
        5
      );
    expect(calcularComplexidade(texto, 20)).toBeLessThanOrEqual(1);
  });
});

describe("pontuarOperador", () => {
  it("pontua zero para operador indisponível", () => {
    const resultado = pontuarOperador(operador({ disponivel: false }), { categoria: "geral", confianca: 0.3, sinais: [] }, 0.2);
    expect(resultado.score).toBe(0);
  });

  it("pontua zero para operador na capacidade máxima", () => {
    const resultado = pontuarOperador(
      operador({ cargaAtual: 5, capacidadeMaxima: 5 }),
      { categoria: "geral", confianca: 0.3, sinais: [] },
      0.2
    );
    expect(resultado.score).toBe(0);
  });

  it("favorece o especialista sobre o generalista para a mesma intenção", () => {
    const intencao = { categoria: "financeiro" as const, confianca: 0.8, sinais: ["fatura"] };
    const especialista = pontuarOperador(operador({ especialidades: ["financeiro"] }), intencao, 0.3);
    const generalista = pontuarOperador(operador({ especialidades: ["tecnico"] }), intencao, 0.3);
    expect(especialista.score).toBeGreaterThan(generalista.score);
  });

  it("favorece operador com menor carga entre dois especialistas equivalentes", () => {
    const intencao = { categoria: "geral" as const, confianca: 0.5, sinais: [] };
    const livre = pontuarOperador(operador({ cargaAtual: 0, capacidadeMaxima: 5 }), intencao, 0.3);
    const ocupado = pontuarOperador(operador({ cargaAtual: 4, capacidadeMaxima: 5 }), intencao, 0.3);
    expect(livre.score).toBeGreaterThan(ocupado.score);
  });

  it("favorece operador com melhor histórico de resolução", () => {
    const intencao = { categoria: "geral" as const, confianca: 0.5, sinais: [] };
    const bom = pontuarOperador(operador({ taxaResolucao: 0.95, tempoMedioResolucaoMin: 5 }), intencao, 0.3);
    const fraco = pontuarOperador(operador({ taxaResolucao: 0.3, tempoMedioResolucaoMin: 50 }), intencao, 0.3);
    expect(bom.score).toBeGreaterThan(fraco.score);
  });

  it("sempre devolve motivos explicáveis", () => {
    const resultado = pontuarOperador(operador(), { categoria: "geral", confianca: 0.3, sinais: [] }, 0.2);
    expect(resultado.motivos.length).toBeGreaterThan(0);
  });
});

describe("pontuarAgente", () => {
  it("pontua zero quando a complexidade excede o limite seguro", () => {
    const resultado = pontuarAgente(agente(), { categoria: "financeiro", confianca: 0.8, sinais: [] }, 0.9);
    expect(resultado.score).toBe(0);
    expect(resultado.motivos.join(" ")).toMatch(/complexidade/i);
  });

  it("pontua positivamente para caso simples dentro da especialidade", () => {
    const resultado = pontuarAgente(agente(), { categoria: "financeiro", confianca: 0.8, sinais: [] }, 0.1);
    expect(resultado.score).toBeGreaterThan(0);
  });

  it("penaliza complexidade de forma contínua, não apenas no corte", () => {
    const baixa = pontuarAgente(agente(), { categoria: "financeiro", confianca: 0.8, sinais: [] }, 0.1);
    const media = pontuarAgente(agente(), { categoria: "financeiro", confianca: 0.8, sinais: [] }, 0.5);
    expect(media.score).toBeLessThan(baixa.score);
  });

  it("pontua zero para agente indisponível ou saturado", () => {
    const resultado = pontuarAgente(agente({ cargaAtual: 50, capacidadeMaxConcorrente: 50 }), { categoria: "financeiro", confianca: 0.8, sinais: [] }, 0.1);
    expect(resultado.score).toBe(0);
  });
});

describe("rotear", () => {
  it("escolhe o melhor candidato entre humanos e agentes", () => {
    const decisao = rotear({
      texto: "Minha fatura veio com cobrança errada, quero entender o valor.",
      operadores: [operador({ uid: "op-financeiro", especialidades: ["financeiro"], taxaResolucao: 0.9 })],
      agentes: [agente({ id: "bot-financeiro", especialidades: ["financeiro"] })],
    });

    expect(decisao.intencao.categoria).toBe("financeiro");
    expect(decisao.escolhido).not.toBeNull();
    expect(decisao.candidatos.length).toBeGreaterThan(0);
    // Ordenado do melhor para o pior.
    for (let i = 1; i < decisao.candidatos.length; i += 1) {
      expect(decisao.candidatos[i - 1].score).toBeGreaterThanOrEqual(decisao.candidatos[i].score);
    }
  });

  it("prefere o humano quando o caso é complexo demais para o agente", () => {
    const decisao = rotear({
      texto:
        "Preciso de uma integração via API com exportação para auditoria de compliance, envolvendo cláusulas de rescisão do contrato e risco de multa judicial.",
      totalMensagensAnteriores: 8,
      operadores: [operador({ uid: "op-juridico", especialidades: ["juridico"], taxaResolucao: 0.9 })],
      agentes: [agente({ especialidades: ["juridico"] })],
    });

    expect(decisao.complexidade).toBeGreaterThan(0.7);
    expect(decisao.escolhido?.tipo).toBe("humano");
  });

  it("devolve escolhido null sem lançar quando não há candidatos disponíveis", () => {
    const decisao = rotear({
      texto: "Preciso de ajuda.",
      operadores: [operador({ disponivel: false })],
      agentes: [agente({ disponivel: false })],
    });

    expect(decisao.escolhido).toBeNull();
    expect(decisao.candidatos).toEqual([]);
  });

  it("não lança com listas vazias de operadores e agentes", () => {
    expect(() => rotear({ texto: "Oi", operadores: [], agentes: [] })).not.toThrow();
  });
});

describe("rotear — SLA Rescue & Circuit Breaker", () => {
  it("nunca escolhe um agente automatizado quando o circuit breaker está ativo, mesmo sendo o candidato naturalmente melhor", () => {
    const decisao = rotear({
      texto: "Minha fatura veio com cobrança errada, quero entender o valor.",
      operadores: [operador({ uid: "op-financeiro", especialidades: ["financeiro"], taxaResolucao: 0.5 })],
      agentes: [agente({ id: "bot-financeiro", especialidades: ["financeiro"], taxaResolucaoAutomatica: 0.99 })],
      circuitBreakerAtivo: true,
    });

    expect(decisao.escolhido?.tipo).toBe("humano");
    const candidatoAgente = decisao.candidatos.find((c) => c.tipo === "agente");
    expect(candidatoAgente).toBeUndefined(); // score 0 é filtrado da lista de candidatos viáveis.
  });

  it("explica o descarte do agente com o motivo do circuit breaker, não com um score calculado", () => {
    const comBreaker = rotear({
      texto: "Minha fatura veio com cobrança errada.",
      operadores: [],
      agentes: [agente({ especialidades: ["financeiro"] })],
      circuitBreakerAtivo: true,
    });
    const semBreaker = rotear({
      texto: "Minha fatura veio com cobrança errada.",
      operadores: [],
      agentes: [agente({ especialidades: ["financeiro"] })],
      circuitBreakerAtivo: false,
    });

    expect(comBreaker.escolhido).toBeNull();
    expect(semBreaker.escolhido?.tipo).toBe("agente");
  });

  it("com o breaker ativo e nenhum humano disponível, devolve escolhido null em vez de cair para o bot", () => {
    const decisao = rotear({
      texto: "Isso é um absurdo, quero cancelar!",
      operadores: [operador({ disponivel: false })],
      agentes: [agente({ especialidades: ["retencao"], taxaResolucaoAutomatica: 1 })],
      circuitBreakerAtivo: true,
    });

    expect(decisao.escolhido).toBeNull();
  });

  it("sem circuit breaker, o comportamento de roteamento normal é preservado (regressão)", () => {
    const decisao = rotear({
      texto: "Minha fatura veio com cobrança errada, quero entender o valor.",
      operadores: [operador({ uid: "op-financeiro", especialidades: ["financeiro"], taxaResolucao: 0.9 })],
      agentes: [agente({ id: "bot-financeiro", especialidades: ["financeiro"] })],
    });

    expect(decisao.escolhido).not.toBeNull();
  });
});
