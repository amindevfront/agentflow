import { describe, expect, it } from "vitest";
import {
  FATOR_CUBAGEM_RODOVIARIO_PADRAO,
  calcularCubagem,
  classificarPrioridadeDespacho,
  extrairCodigoCarga,
  extrairCubagemM3,
  extrairDadosCarga,
  extrairDimensoesVolume,
  extrairPesoKg,
  extrairQuantidadeVolumes,
} from "@/lib/logisticaCarga";

describe("extrairPesoKg", () => {
  it("lê peso em kg com separador de milhar brasileiro", () => {
    expect(extrairPesoKg("São 2.400 kg no total")).toBe(2400);
    expect(extrairPesoKg("peso 850kg")).toBe(850);
    expect(extrairPesoKg("12,5 kg apenas")).toBe(12.5);
  });

  it("converte toneladas para kg", () => {
    expect(extrairPesoKg("2,4 toneladas")).toBe(2400);
    expect(extrairPesoKg("carga de 12 t")).toBe(12000);
  });

  it("devolve null quando o peso não foi informado — nunca um valor estimado", () => {
    expect(extrairPesoKg("preciso de cotação para amanhã")).toBeNull();
    expect(extrairPesoKg("")).toBeNull();
  });
});

describe("extrairCubagemM3 e extrairDimensoesVolume", () => {
  it("lê cubagem declarada em m³/m3/cbm", () => {
    expect(extrairCubagemM3("são 6 m³")).toBe(6);
    expect(extrairCubagemM3("6,5 m3 de cubagem")).toBe(6.5);
    expect(extrairCubagemM3("12 cbm")).toBe(12);
  });

  it("lê dimensões em metros", () => {
    expect(extrairDimensoesVolume("volumes de 1,20 x 0,80 x 1,00")).toEqual({
      comprimento: 1.2,
      largura: 0.8,
      altura: 1,
    });
  });

  it("converte dimensões em centímetros para metros (palete PBR não tem 120 metros)", () => {
    expect(extrairDimensoesVolume("120 x 80 x 100")).toEqual({
      comprimento: 1.2,
      largura: 0.8,
      altura: 1,
    });
  });

  it("lê a quantidade de volumes em variações comuns", () => {
    expect(extrairQuantidadeVolumes("8 volumes paletizados")).toBe(8);
    expect(extrairQuantidadeVolumes("3 paletes")).toBe(3);
    expect(extrairQuantidadeVolumes("sem quantidade informada")).toBeNull();
  });
});

describe("extrairCodigoCarga", () => {
  it("reconhece códigos de rastreio/CT-e com e sem hífen", () => {
    expect(extrairCodigoCarga("status da carga DEMO-004521?")).toBe("DEMO-004521");
    expect(extrairCodigoCarga("rastreio BRX004521889")).toBe("BRX004521889");
  });

  it("não confunde palavra comum em maiúsculas com código", () => {
    expect(extrairCodigoCarga("URGENTE, preciso disso hoje")).toBeNull();
  });
});

describe("calcularCubagem", () => {
  it("usa a cubagem declarada quando existe e calcula o peso taxável", () => {
    const dados = extrairDadosCarga("2.400 kg, 6 m³, Itajaí para Campinas");
    const cubagem = calcularCubagem(dados);
    expect(cubagem?.origem).toBe("declarada");
    expect(cubagem?.cubagemM3).toBe(6);
    expect(cubagem?.pesoCubadoKg).toBe(6 * FATOR_CUBAGEM_RODOVIARIO_PADRAO);
    // Peso cubado (1.800) é menor que o real (2.400) — taxável é o real.
    expect(cubagem?.pesoTaxavelKg).toBe(2400);
  });

  it("deriva a cubagem de dimensões × volumes quando ela não foi declarada", () => {
    const dados = extrairDadosCarga("8 volumes de 1,20 x 0,80 x 1,00, peso 300 kg");
    const cubagem = calcularCubagem(dados);
    expect(cubagem?.origem).toBe("calculada-por-dimensoes");
    expect(cubagem?.cubagemM3).toBeCloseTo(7.68, 3);
    // Agora o peso cubado (2.304) supera o real (300) — taxável vira o cubado.
    expect(cubagem?.pesoTaxavelKg).toBeCloseTo(2304, 1);
  });

  it("assume UM volume quando a quantidade não foi informada, nunca um multiplicador inventado", () => {
    const dados = extrairDadosCarga("volume de 1,00 x 1,00 x 1,00");
    expect(calcularCubagem(dados)?.cubagemM3).toBe(1);
  });

  it("devolve null sem cubagem nem dimensões — lacuna explícita, não zero silencioso", () => {
    expect(calcularCubagem(extrairDadosCarga("preciso de cotação, 500 kg"))).toBeNull();
  });

  it("respeita um fator de cubagem diferente do rodoviário padrão (aéreo, contrato negociado)", () => {
    const dados = extrairDadosCarga("4 m³");
    expect(calcularCubagem(dados, 166.67)?.pesoCubadoKg).toBeCloseTo(666.68, 1);
  });
});

describe("classificarPrioridadeDespacho", () => {
  it("classifica custo operacional conhecido como crítico e manda para a torre", () => {
    const resultado = classificarPrioridadeDespacho("O veículo quebrou e isso é insumo de parada de linha");
    expect(resultado.prioridade).toBe("critica");
    expect(resultado.escalonarParaTorre).toBe(true);
    expect(resultado.motivos.join(" ")).toContain("Parada de linha");
  });

  it("free time/demurrage e carga perecível também são críticos", () => {
    expect(classificarPrioridadeDespacho("o free time vence amanhã").prioridade).toBe("critica");
    expect(classificarPrioridadeDespacho("carga perecível, cadeia do frio").prioridade).toBe("critica");
    expect(classificarPrioridadeDespacho("tivemos uma avaria no transporte").prioridade).toBe("critica");
  });

  it('"urgente" sozinho é atenção, nunca crítico — urgência declarada não é custo conhecido', () => {
    const resultado = classificarPrioridadeDespacho("preciso disso urgente, pra hoje");
    expect(resultado.prioridade).toBe("atencao");
    expect(resultado.escalonarParaTorre).toBe(false);
  });

  it("carga acima de 10 t vira atenção por exigir veículo dedicado", () => {
    const dados = extrairDadosCarga("são 18 toneladas");
    const resultado = classificarPrioridadeDespacho("são 18 toneladas", dados);
    expect(resultado.prioridade).toBe("atencao");
    expect(resultado.motivos.join(" ")).toContain("10 t");
  });

  it("demanda comum fica em rotina, sem motivo nenhum", () => {
    const resultado = classificarPrioridadeDespacho("cotação para 300 kg de Itajaí para Joinville");
    expect(resultado.prioridade).toBe("rotina");
    expect(resultado.motivos).toEqual([]);
  });

  it("não duplica o mesmo motivo quando ele aparece em várias mensagens", () => {
    const resultado = classificarPrioridadeDespacho([
      "temos uma parada de linha aqui",
      "repetindo: parada de linha, preciso de redespacho",
    ]);
    expect(resultado.motivos.filter((m) => m.includes("Parada de linha"))).toHaveLength(1);
  });
});

describe("extrairDadosCarga — múltiplas mensagens", () => {
  it("compõe o quadro a partir de mensagens diferentes da mesma conversa", () => {
    const dados = extrairDadosCarga([
      "Bom dia, preciso de cotação spot",
      "São 2.400 kg",
      "6 m³, 8 volumes, referência DEMO-004521",
    ]);
    expect(dados.pesoKg).toBe(2400);
    expect(dados.cubagemM3).toBe(6);
    expect(dados.quantidadeVolumes).toBe(8);
    expect(dados.codigoRastreio).toBe("DEMO-004521");
  });

  it("mantém tudo null quando nada foi informado", () => {
    expect(extrairDadosCarga(["bom dia", "tudo bem?"])).toEqual({
      pesoKg: null,
      cubagemM3: null,
      dimensoesVolume: null,
      quantidadeVolumes: null,
      codigoRastreio: null,
    });
  });
});
