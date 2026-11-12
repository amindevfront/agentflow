import { describe, expect, it } from "vitest";
import {
  detectarDescontoAcimaDoLimite,
  detectarInformalidadeFiscal,
  inspecionarSaida,
  PiiVault,
  POLITICA_PROTECAO_MARGEM_FISCAL,
  POLITICAS_PREDEFINIDAS,
} from "@/lib/guardrails";
import { estimarRiscoPrevenido, VALOR_ESTIMADO_PREJUIZO_POR_REGRA_BRL } from "@/lib/governance/marginGuard";
import type { GuardrailViolation } from "@/types";

describe("detectarInformalidadeFiscal (Motor de Pre-Deal Compliance & Margin Guard)", () => {
  it("detecta venda/pagamento sem nota fiscal", () => {
    expect(detectarInformalidadeFiscal("Pode fazer sem nota, sai mais barato pra você.").suspeito).toBe(true);
    expect(detectarInformalidadeFiscal("Não precisa de nota fiscal, eu confio em você.").suspeito).toBe(true);
  });

  it("detecta pagamento informal/não declarado (por fora, caixa dois)", () => {
    expect(detectarInformalidadeFiscal("Esse valor a gente resolve por fora.").suspeito).toBe(true);
    expect(detectarInformalidadeFiscal("É tudo caixa dois, não entra no sistema.").suspeito).toBe(true);
  });

  it("detecta mistura indevida de pessoa física/jurídica", () => {
    expect(detectarInformalidadeFiscal("Posso emitir pra outro CNPJ seu, se preferir.").suspeito).toBe(true);
    expect(detectarInformalidadeFiscal("Aí você passa como pessoa física, fica mais simples.").suspeito).toBe(true);
  });

  it("não acusa uma conversa comercial normal", () => {
    const resultado = detectarInformalidadeFiscal("Vou emitir a nota fiscal e te envio o boleto hoje.");
    expect(resultado.suspeito).toBe(false);
    expect(resultado.descricoes).toEqual([]);
  });
});

describe("detectarDescontoAcimaDoLimite (Motor de Pre-Deal Compliance & Margin Guard)", () => {
  it("acusa desconto em português acima do limite configurado", () => {
    const resultado = detectarDescontoAcimaDoLimite("Consigo fechar com 30% de desconto pra você.", 15);
    expect(resultado.suspeito).toBe(true);
    expect(resultado.descricoes[0]).toContain("30%");
  });

  it("acusa desconto em inglês acima do limite (workspaces US/EU)", () => {
    expect(detectarDescontoAcimaDoLimite("I can offer a 40% discount today.", 15).suspeito).toBe(true);
    expect(detectarDescontoAcimaDoLimite("We can do 25% off this week.", 15).suspeito).toBe(true);
  });

  it("não acusa desconto dentro do limite configurado", () => {
    const resultado = detectarDescontoAcimaDoLimite("Tem 10% de desconto pra pagamento à vista.", 15);
    expect(resultado.suspeito).toBe(false);
    expect(resultado.descricoes).toEqual([]);
  });

  it("não acusa nada quando nenhum percentual de desconto é mencionado", () => {
    expect(detectarDescontoAcimaDoLimite("O valor da unidade é R$ 450.000.", 15).suspeito).toBe(false);
  });

  it("usa o MAIOR percentual quando mais de um é mencionado", () => {
    const resultado = detectarDescontoAcimaDoLimite(
      "Consigo 10% de desconto à vista, ou até 35% de desconto se fechar hoje.",
      15
    );
    expect(resultado.suspeito).toBe(true);
    expect(resultado.descricoes[0]).toContain("35%");
  });
});

describe("POLITICA_PROTECAO_MARGEM_FISCAL", () => {
  it("liga bloquearRiscoFiscalEMargem e está registrada em POLITICAS_PREDEFINIDAS", () => {
    expect(POLITICA_PROTECAO_MARGEM_FISCAL.bloquearRiscoFiscalEMargem).toBe(true);
    expect(POLITICAS_PREDEFINIDAS["protecao-margem-fiscal"]).toBe(POLITICA_PROTECAO_MARGEM_FISCAL);
  });
});

describe("inspecionarSaida — bloqueio automático do Motor de Pre-Deal Compliance & Margin Guard", () => {
  it("bloqueia e abre violação `informalidade-fiscal-nao-autorizada` quando a política liga o guardrail", () => {
    const resultado = inspecionarSaida({
      amostras: ["Pode ser sem nota, eu não declaro esse valor."],
      vault: new PiiVault(),
      politica: "protecao-margem-fiscal",
    });

    expect(resultado.veredito).toBe("bloqueado");
    expect(resultado.violacoes.some((v) => v.regra === "informalidade-fiscal-nao-autorizada")).toBe(true);
  });

  it("bloqueia e abre violação `desconto-acima-limite-sem-aprovacao` acima do limite configurado", () => {
    const resultado = inspecionarSaida({
      amostras: ["Consigo fechar com 40% de desconto agora."],
      vault: new PiiVault(),
      politica: "protecao-margem-fiscal",
      sobrescritas: { descontoMaximoSemAprovacaoPercentual: 20 },
    });

    expect(resultado.veredito).toBe("bloqueado");
    expect(resultado.violacoes.some((v) => v.regra === "desconto-acima-limite-sem-aprovacao")).toBe(true);
  });

  it("nunca dispara quando a política não liga o guardrail (padrão)", () => {
    const resultado = inspecionarSaida({
      amostras: ["Pode ser sem nota, fechamos com 50% de desconto."],
      vault: new PiiVault(),
      politica: "padrao",
    });

    expect(resultado.violacoes.some((v) => v.regra === "informalidade-fiscal-nao-autorizada")).toBe(false);
    expect(resultado.violacoes.some((v) => v.regra === "desconto-acima-limite-sem-aprovacao")).toBe(false);
  });
});

describe("estimarRiscoPrevenido (Risk Shield — honestidade do número)", () => {
  function violacao(regra: GuardrailViolation["regra"]): GuardrailViolation {
    return { regra, severidade: "critica", mensagem: `violação ${regra}` };
  }

  it("devolve null quando nenhuma violação pertence ao Motor de Pre-Deal Compliance & Margin Guard", () => {
    expect(estimarRiscoPrevenido([violacao("pii-vazamento-saida")])).toBeNull();
    expect(estimarRiscoPrevenido([])).toBeNull();
  });

  it("estima o prejuízo a partir da tabela de referência documentada, nunca um valor inventado", () => {
    const resultado = estimarRiscoPrevenido([violacao("informalidade-fiscal-nao-autorizada")]);
    expect(resultado).not.toBeNull();
    expect(resultado?.regras).toEqual(["informalidade-fiscal-nao-autorizada"]);
    expect(resultado?.prejuizoEstimadoBrl).toBe(
      VALOR_ESTIMADO_PREJUIZO_POR_REGRA_BRL["informalidade-fiscal-nao-autorizada"]
    );
  });

  it("soma o prejuízo de múltiplas regras diferentes, sem contar a mesma regra duas vezes", () => {
    const resultado = estimarRiscoPrevenido([
      violacao("informalidade-fiscal-nao-autorizada"),
      violacao("informalidade-fiscal-nao-autorizada"),
      violacao("desconto-acima-limite-sem-aprovacao"),
    ]);
    expect(resultado?.regras.sort()).toEqual(
      ["desconto-acima-limite-sem-aprovacao", "informalidade-fiscal-nao-autorizada"].sort()
    );
    expect(resultado?.prejuizoEstimadoBrl).toBe(
      VALOR_ESTIMADO_PREJUIZO_POR_REGRA_BRL["informalidade-fiscal-nao-autorizada"] +
        VALOR_ESTIMADO_PREJUIZO_POR_REGRA_BRL["desconto-acima-limite-sem-aprovacao"]
    );
  });

  it("ignora violações de outras regras ao estimar, mas ainda assim estima as relevantes", () => {
    const resultado = estimarRiscoPrevenido([
      violacao("pii-vazamento-saida"),
      violacao("desconto-acima-limite-sem-aprovacao"),
    ]);
    expect(resultado?.regras).toEqual(["desconto-acima-limite-sem-aprovacao"]);
  });
});
