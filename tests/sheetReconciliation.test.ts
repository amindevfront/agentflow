import { describe, expect, it } from "vitest";
import {
  calcularDiffReconciliacao,
  extrairAtualizacaoRegistro,
  extrairCamposAtualizados,
  extrairChaveRegistro,
} from "@/lib/sheetReconciliation";
import type { RegistroOperacional } from "@/types";

describe("extrairChaveRegistro", () => {
  it("extrai chave a partir de prefixos reconhecidos (PT e EN)", () => {
    expect(extrairChaveRegistro("Pedido #1234 está pago")).toBe("1234");
    expect(extrairChaveRegistro("chamado PED-1234 foi aberto")).toBe("PED-1234");
    expect(extrairChaveRegistro("order #AB-9900 shipped")).toBe("AB-9900");
  });

  it("devolve null quando nenhum prefixo reconhecido aparece (nunca inventa uma chave)", () => {
    expect(extrairChaveRegistro("Qual o status da minha solicitação?")).toBeNull();
    expect(extrairChaveRegistro("")).toBeNull();
  });
});

describe("extrairCamposAtualizados", () => {
  it("extrai status mencionado (PT e EN)", () => {
    expect(extrairCamposAtualizados("status: pago").status).toBe("pago");
    expect(extrairCamposAtualizados("status is completed").status).toBe("completed");
  });

  it("extrai prazo mencionado", () => {
    expect(extrairCamposAtualizados("prazo até 10/05").prazo).toBe("10/05");
  });

  it("devolve objeto vazio quando nenhum campo reconhecido é mencionado (nunca inventa)", () => {
    expect(extrairCamposAtualizados("Oi, tudo bem?")).toEqual({});
  });
});

describe("extrairAtualizacaoRegistro", () => {
  it("exige AMBOS chave e ao menos um campo reconhecido", () => {
    expect(extrairAtualizacaoRegistro("pedidos", "Pedido #1234, status: pago")).toEqual({
      tabela: "pedidos",
      chave: "1234",
      camposAtualizados: { status: "pago" },
    });
  });

  it("devolve null quando falta a chave", () => {
    expect(extrairAtualizacaoRegistro("pedidos", "status: pago")).toBeNull();
  });

  it("devolve null quando falta um campo reconhecido", () => {
    expect(extrairAtualizacaoRegistro("pedidos", "Pedido #1234, tudo certo por aqui")).toBeNull();
  });
});

describe("calcularDiffReconciliacao", () => {
  it("aponta todos os campos como diff quando não há registro salvo ainda", () => {
    const diffs = calcularDiffReconciliacao(null, { tabela: "pedidos", chave: "1234", camposAtualizados: { status: "pago" } });
    expect(diffs).toEqual([{ campo: "status", valorAntigo: null, valorNovo: "pago" }]);
  });

  it("não aponta diff quando o valor já é o mesmo salvo", () => {
    const atual: RegistroOperacional = {
      id: "reg_1",
      workspaceId: "ws-1",
      tabela: "pedidos",
      chave: "1234",
      campos: { status: "pago" },
      atualizadoEm: new Date().toISOString(),
    };
    expect(
      calcularDiffReconciliacao(atual, { tabela: "pedidos", chave: "1234", camposAtualizados: { status: "pago" } })
    ).toEqual([]);
  });

  it("aponta diff quando o valor muda", () => {
    const atual: RegistroOperacional = {
      id: "reg_1",
      workspaceId: "ws-1",
      tabela: "pedidos",
      chave: "1234",
      campos: { status: "pendente" },
      atualizadoEm: new Date().toISOString(),
    };
    expect(
      calcularDiffReconciliacao(atual, { tabela: "pedidos", chave: "1234", camposAtualizados: { status: "pago" } })
    ).toEqual([{ campo: "status", valorAntigo: "pendente", valorNovo: "pago" }]);
  });
});
