import { describe, expect, it } from "vitest";
import type { ExecutorLlm } from "@/lib/guardrails";
import type { EpisodioReplay, ResultadoVariante, VarianteDePrompt } from "@/lib/server/promptSimulator";
import {
  agregarResultadoVariante,
  compararVariantes,
  criarClassificadorPorPalavrasChave,
  executarSimulacaoAB,
  simularVariante,
} from "@/lib/server/promptSimulator";

function episodio(parcial: Partial<EpisodioReplay> = {}): EpisodioReplay {
  return {
    conversationId: "conv-1",
    canal: "whatsapp",
    payloadMascarado: "Quero saber o preço do procedimento.",
    desfechoReal: null,
    ...parcial,
  };
}

const VARIANTE_A: VarianteDePrompt = { id: "a", rotulo: "Variante A — direta" };
const VARIANTE_B: VarianteDePrompt = { id: "b", rotulo: "Variante B — consultiva" };

/** Executor determinístico: devolve respostas pré-programadas em sequência, por episódio. */
function criarExecutorFalso(respostas: string[]): ExecutorLlm {
  let indice = 0;
  return async () => {
    const resposta = respostas[indice] ?? respostas.at(-1) ?? "";
    indice += 1;
    return resposta;
  };
}

const CLASSIFICAR_POR_AGENDAR = criarClassificadorPorPalavrasChave(["agendar", "agende"]);

describe("criarClassificadorPorPalavrasChave", () => {
  it("reconhece a palavra-chave independente de maiúsculas/minúsculas", () => {
    expect(CLASSIFICAR_POR_AGENDAR("Vamos AGENDAR sua consulta?")).toBe(true);
  });

  it("devolve falso quando nenhuma palavra-chave aparece na resposta", () => {
    expect(CLASSIFICAR_POR_AGENDAR("Qual sua dúvida?")).toBe(false);
  });

  it("ignora palavras-chave vazias ou só com espaços", () => {
    const classificar = criarClassificadorPorPalavrasChave(["  ", "agendar"]);
    expect(classificar("Posso agendar para você.")).toBe(true);
  });
});

describe("agregarResultadoVariante", () => {
  it("calcula a taxa de conversão simulada sobre o total de episódios", () => {
    const resultado = agregarResultadoVariante(VARIANTE_A, [
      { conversationId: "c1", varianteId: "a", respostaSimulada: "x", convergiuParaConversao: true, desfechoReal: null },
      { conversationId: "c2", varianteId: "a", respostaSimulada: "x", convergiuParaConversao: false, desfechoReal: null },
      { conversationId: "c3", varianteId: "a", respostaSimulada: "x", convergiuParaConversao: true, desfechoReal: null },
      { conversationId: "c4", varianteId: "a", respostaSimulada: "x", convergiuParaConversao: true, desfechoReal: null },
    ]);

    expect(resultado.totalEpisodios).toBe(4);
    expect(resultado.totalConvergiuParaConversao).toBe(3);
    expect(resultado.taxaConversaoSimulada).toBe(0.75);
  });

  it("devolve taxa zero sem lançar quando não há episódios", () => {
    const resultado = agregarResultadoVariante(VARIANTE_A, []);
    expect(resultado.totalEpisodios).toBe(0);
    expect(resultado.taxaConversaoSimulada).toBe(0);
    expect(resultado.concordanciaComDesfechoReal).toBeNull();
  });

  it("calcula a concordância com o desfecho real apenas sobre episódios fechados", () => {
    const resultado = agregarResultadoVariante(VARIANTE_A, [
      { conversationId: "c1", varianteId: "a", respostaSimulada: "x", convergiuParaConversao: true, desfechoReal: "fechado-venda" },
      { conversationId: "c2", varianteId: "a", respostaSimulada: "x", convergiuParaConversao: false, desfechoReal: "fechado-venda" },
      { conversationId: "c3", varianteId: "a", respostaSimulada: "x", convergiuParaConversao: false, desfechoReal: "perdido-preco" },
    ]);

    expect(resultado.concordanciaComDesfechoReal).toBe(0.5);
  });

  it("devolve concordância nula quando nenhum episódio da amostra foi fechado-venda", () => {
    const resultado = agregarResultadoVariante(VARIANTE_A, [
      { conversationId: "c1", varianteId: "a", respostaSimulada: "x", convergiuParaConversao: true, desfechoReal: "perdido-preco" },
    ]);

    expect(resultado.concordanciaComDesfechoReal).toBeNull();
  });
});

function resultado(parcial: Partial<ResultadoVariante>): ResultadoVariante {
  return {
    varianteId: "a",
    rotulo: "Variante",
    totalEpisodios: 10,
    totalConvergiuParaConversao: 5,
    taxaConversaoSimulada: 0.5,
    concordanciaComDesfechoReal: null,
    ...parcial,
  };
}

describe("compararVariantes", () => {
  it("devolve null com menos de duas variantes", () => {
    expect(compararVariantes([resultado({})])).toBeNull();
  });

  it("devolve null quando qualquer variante não atinge a amostra mínima", () => {
    const a = resultado({ varianteId: "a", totalEpisodios: 10, taxaConversaoSimulada: 0.8 });
    const b = resultado({ varianteId: "b", totalEpisodios: 2, taxaConversaoSimulada: 0.1 });

    expect(compararVariantes([a, b])).toBeNull();
  });

  it("devolve null em caso de empate exato entre as duas melhores variantes", () => {
    const a = resultado({ varianteId: "a", totalEpisodios: 10, taxaConversaoSimulada: 0.6 });
    const b = resultado({ varianteId: "b", totalEpisodios: 10, taxaConversaoSimulada: 0.6 });

    expect(compararVariantes([a, b])).toBeNull();
  });

  it("aponta a variante vencedora com amostra suficiente e diferença inequívoca", () => {
    const a = resultado({ varianteId: "a", rotulo: "A", totalEpisodios: 10, taxaConversaoSimulada: 0.8 });
    const b = resultado({ varianteId: "b", rotulo: "B", totalEpisodios: 10, taxaConversaoSimulada: 0.5 });

    const veredito = compararVariantes([a, b]);

    expect(veredito).not.toBeNull();
    expect(veredito!.varianteGanhadora.varianteId).toBe("a");
    expect(veredito!.margemPontosPercentuais).toBe(30);
  });

  it("escolhe a melhor entre três ou mais variantes", () => {
    const a = resultado({ varianteId: "a", totalEpisodios: 10, taxaConversaoSimulada: 0.4 });
    const b = resultado({ varianteId: "b", totalEpisodios: 10, taxaConversaoSimulada: 0.9 });
    const c = resultado({ varianteId: "c", totalEpisodios: 10, taxaConversaoSimulada: 0.6 });

    const veredito = compararVariantes([a, b, c]);

    expect(veredito!.varianteGanhadora.varianteId).toBe("b");
  });
});

describe("simularVariante", () => {
  it("chama o executor uma vez por episódio e classifica cada resposta simulada", async () => {
    const episodios = [episodio({ conversationId: "c1" }), episodio({ conversationId: "c2" })];
    const executor = criarExecutorFalso(["Vamos agendar sua avaliação.", "Qual sua dúvida?"]);

    const { resultado: agregado, porEpisodio } = await simularVariante(
      episodios,
      VARIANTE_A,
      executor,
      CLASSIFICAR_POR_AGENDAR
    );

    expect(porEpisodio).toHaveLength(2);
    expect(porEpisodio[0].convergiuParaConversao).toBe(true);
    expect(porEpisodio[1].convergiuParaConversao).toBe(false);
    expect(agregado.taxaConversaoSimulada).toBe(0.5);
  });
});

describe("executarSimulacaoAB", () => {
  it("roda todas as variantes contra o mesmo dataset e aponta a vencedora", async () => {
    const episodios = Array.from({ length: 6 }, (_, i) => episodio({ conversationId: `c${i}` }));

    const respostasPorVariante: Record<string, string> = {
      a: "Vamos agendar sua avaliação agora mesmo.",
      b: "Qual sua dúvida sobre o procedimento?",
    };

    const criarExecutor = (variante: VarianteDePrompt): ExecutorLlm => async () =>
      respostasPorVariante[variante.id];

    const resultadoAB = await executarSimulacaoAB(
      episodios,
      [VARIANTE_A, VARIANTE_B],
      criarExecutor,
      CLASSIFICAR_POR_AGENDAR
    );

    expect(resultadoAB.porVariante).toHaveLength(2);
    expect(resultadoAB.porEpisodio).toHaveLength(12);
    expect(resultadoAB.veredito).not.toBeNull();
    expect(resultadoAB.veredito!.varianteGanhadora.varianteId).toBe("a");
  });

  it("devolve veredito nulo quando a amostra de episódios é insuficiente", async () => {
    const episodios = [episodio()];
    const criarExecutor = (): ExecutorLlm => async () => "Vamos agendar.";

    const resultadoAB = await executarSimulacaoAB(
      episodios,
      [VARIANTE_A, VARIANTE_B],
      criarExecutor,
      CLASSIFICAR_POR_AGENDAR
    );

    expect(resultadoAB.veredito).toBeNull();
  });
});
