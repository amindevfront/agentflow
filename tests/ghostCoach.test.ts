import { describe, expect, it } from "vitest";
import { construirPromptGhostCoach, interpretarRespostaGhostCoach } from "@/lib/server/ghostCoach";

describe("construirPromptGhostCoach", () => {
  it("inclui o payload mascarado, o motivo e a severidade", () => {
    const prompt = construirPromptGhostCoach({
      payloadMascarado: "Cliente perguntou sobre o CPF [[PII:CPF:1]].",
      motivo: "frustracao-critica",
      severidade: "critica",
    });

    expect(prompt).toContain("[[PII:CPF:1]]");
    expect(prompt).toContain("frustracao-critica");
    expect(prompt).toContain("critica");
    expect(prompt).toContain("RESPOSTA:");
    expect(prompt).toContain("OBJEÇÃO:");
  });

  it("inclui a saída mascarada quando presente, e a omite quando ausente", () => {
    const comSaida = construirPromptGhostCoach({
      payloadMascarado: "x",
      saidaMascarada: "Resposta automática anterior",
      motivo: "guardrail-revisao",
      severidade: "alta",
    });
    expect(comSaida).toContain("Resposta automática anterior");

    const semSaida = construirPromptGhostCoach({
      payloadMascarado: "x",
      motivo: "guardrail-revisao",
      severidade: "alta",
    });
    expect(semSaida).not.toContain("Última resposta automática");
  });

  it("inclui o contexto episódico quando presente, e o omite quando ausente", () => {
    const comHistorico = construirPromptGhostCoach({
      payloadMascarado: "x",
      motivo: "agendamento-visita-presencial",
      severidade: "media",
      contextoEpisodico: "Histórico cross-channel deste cliente: 3 interações em 2 canais.",
    });
    expect(comHistorico).toContain("Histórico cross-channel deste cliente");

    const semHistorico = construirPromptGhostCoach({
      payloadMascarado: "x",
      motivo: "agendamento-visita-presencial",
      severidade: "media",
    });
    expect(semHistorico).not.toContain("Histórico cross-channel");
  });

  it("instrui o idioma do rascunho quando idiomaResposta é informado e diferente de 'pt' (Expansão Global)", () => {
    const emIngles = construirPromptGhostCoach({
      payloadMascarado: "x",
      motivo: "frustracao-critica",
      severidade: "critica",
      idiomaResposta: "en",
    });
    expect(emIngles).toContain("inglês");
    // Os marcadores de parsing continuam literalmente em português mesmo com idioma de resposta diferente.
    expect(emIngles).toContain("RESPOSTA:");
    expect(emIngles).toContain("OBJEÇÃO:");

    const emEspanhol = construirPromptGhostCoach({
      payloadMascarado: "x",
      motivo: "frustracao-critica",
      severidade: "critica",
      idiomaResposta: "es",
    });
    expect(emEspanhol).toContain("espanhol");
  });

  it("não adiciona instrução de idioma quando idiomaResposta é 'pt' ou ausente (comportamento original preservado)", () => {
    const semIdioma = construirPromptGhostCoach({
      payloadMascarado: "x",
      motivo: "frustracao-critica",
      severidade: "critica",
    });
    const comPt = construirPromptGhostCoach({
      payloadMascarado: "x",
      motivo: "frustracao-critica",
      severidade: "critica",
      idiomaResposta: "pt",
    });
    expect(semIdioma).toBe(comPt);
    expect(semIdioma).not.toContain("Escreva o CONTEÚDO");
  });
});

describe("interpretarRespostaGhostCoach", () => {
  it("separa resposta sugerida e argumento de objeção no formato esperado", () => {
    const interpretado = interpretarRespostaGhostCoach(
      "RESPOSTA: Entendo sua preocupação, vou te ajudar com isso.\nOBJEÇÃO: O cliente acha caro — destaque o valor agregado do serviço."
    );

    expect(interpretado.respostaSugerida).toBe("Entendo sua preocupação, vou te ajudar com isso.");
    expect(interpretado.argumentoObjecao).toBe("O cliente acha caro — destaque o valor agregado do serviço.");
  });

  it("tolera texto extra antes dos marcadores", () => {
    const interpretado = interpretarRespostaGhostCoach(
      "Aqui está minha sugestão:\nRESPOSTA: Olá! Vamos resolver isso juntos.\nOBJEÇÃO: Indecisão — ofereça uma garantia."
    );
    expect(interpretado.respostaSugerida).toBe("Olá! Vamos resolver isso juntos.");
    expect(interpretado.argumentoObjecao).toBe("Indecisão — ofereça uma garantia.");
  });

  it("degrada graciosamente quando o modelo não segue o formato — texto inteiro vira respostaSugerida", () => {
    const interpretado = interpretarRespostaGhostCoach("Apenas uma resposta livre, sem marcadores.");
    expect(interpretado.respostaSugerida).toBe("Apenas uma resposta livre, sem marcadores.");
    expect(interpretado.argumentoObjecao).toBe("");
  });

  it("degrada graciosamente quando os marcadores aparecem fora de ordem", () => {
    const interpretado = interpretarRespostaGhostCoach("OBJEÇÃO: algo\nRESPOSTA: outra coisa");
    expect(interpretado.respostaSugerida).toBe("OBJEÇÃO: algo\nRESPOSTA: outra coisa");
    expect(interpretado.argumentoObjecao).toBe("");
  });

  it("nunca lança, mesmo com texto vazio", () => {
    expect(() => interpretarRespostaGhostCoach("")).not.toThrow();
    const interpretado = interpretarRespostaGhostCoach("");
    expect(interpretado.respostaSugerida).toBe("");
  });
});
