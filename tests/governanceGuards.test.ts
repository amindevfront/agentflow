import { describe, expect, it } from "vitest";
import { precisaConfigurarNicho } from "@/lib/governanceGuards";

describe("precisaConfigurarNicho (Guia de 4 Passos — aviso de volta a Configurações)", () => {
  it("não avisa enquanto a sincronização otimista do workspace ainda está em voo", () => {
    expect(
      precisaConfigurarNicho({ pendingSync: true, workspaceCarregando: false, workspace: null })
    ).toBe(false);
  });

  it("não avisa enquanto a leitura do documento do workspace ainda está em curso", () => {
    expect(
      precisaConfigurarNicho({ pendingSync: false, workspaceCarregando: true, workspace: undefined })
    ).toBe(false);
  });

  it("não avisa antes da primeira resposta da query (workspace === undefined)", () => {
    expect(
      precisaConfigurarNicho({ pendingSync: false, workspaceCarregando: false, workspace: undefined })
    ).toBe(false);
  });

  it("avisa quando a leitura já confirmou que não há setor configurado", () => {
    expect(
      precisaConfigurarNicho({ pendingSync: false, workspaceCarregando: false, workspace: null })
    ).toBe(true);
    expect(
      precisaConfigurarNicho({ pendingSync: false, workspaceCarregando: false, workspace: {} })
    ).toBe(true);
  });

  it("não avisa quando o setor já está configurado", () => {
    expect(
      precisaConfigurarNicho({
        pendingSync: false,
        workspaceCarregando: false,
        workspace: { setor: "construtora-imobiliaria" },
      })
    ).toBe(false);
  });
});
