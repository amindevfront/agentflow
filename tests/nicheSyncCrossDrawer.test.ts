// Auditoria de Concatenação — Vetor 1: Sincronização Cruzada de Nicho.
//
// Prova, com as MESMAS funções reais que cada gaveta usa (não um mock
// paralelo), que trocar o nicho do workspace em Configurações propaga
// instantaneamente para:
//   a) RoiConfig (moeda/regime de encargos) — `@/lib/onboardingQuiz`.
//   b) Tabela de pipeline de Oportunidade & Pipeline — `@/modules/registry`
//      (a mesma `construirTabelaPipelinePadrao` que `@/lib/server/roiDashboard`
//      e `RoiOpportunityPanel` usam).
//   c) Contexto de nicho injetado no prompt da Neural Inbox — `@/lib/nichePrompts`.
//   d) Parâmetros de guardrails — `Workspace.guardrailOverrides`, lido
//      direto por `GuardrailInspectorPanel`.
//
// E, acima de tudo, que NENHUM dado do nicho anterior fica órfão: nem a
// gaveta extra de back-office "presa" ao nicho antigo em `modulosAtivos`
// (bug real corrigido nesta rodada — `obterIdsModulosAtivos` dava
// prioridade total a `modulosAtivos` sobre `setor`, e a troca de nicho não
// recalculava esse campo), nem o contexto de prompt do nicho antigo.
//
// `patchWorkspace` grava com `setDoc(..., { merge: true })` — a simulação
// de merge abaixo (`aplicarPatch`) é exatamente essa semântica: cada chave
// do patch SUBSTITUI por completo o valor anterior daquela chave (nunca um
// merge profundo dentro do valor), e chaves ausentes do patch permanecem
// intocadas — a mesma razão pela qual `modulosAtivos` ficava órfão antes
// desta correção.

import { describe, expect, it } from "vitest";
import { derivarAjustesDoQuiz, PAIN_POINT_PRESETS, REGIAO_PRESETS } from "@/lib/onboardingQuiz";
import { NICHE_PRESETS } from "@/lib/niches";
import { gerarContextoNicho } from "@/lib/nichePrompts";
import { construirTabelaPipelinePadrao, obterIdsModulosAtivos } from "@/modules/registry";
import type { Workspace } from "@/types";

function aplicarPatch(atual: Partial<Workspace>, patch: Partial<Workspace>): Partial<Workspace> {
  return { ...atual, ...patch };
}

const REFERENCIA = new Date("2026-03-15T12:00:00.000Z");

describe("Sincronização Cruzada de Nicho — troca em Configurações propaga para todas as gavetas", () => {
  it("workspace com nicho + gaveta extra + guardrail antigos, trocando para um novo nicho inteiramente diferente", () => {
    // ESTADO ANTES: clínica de alto padrão, com Document AI Vault ligado
    // como gaveta extra, e guardrail elevado por medo de passivo trabalhista.
    const antes: Partial<Workspace> = {
      setor: "clinica-alto-padrao",
      modulosAtivos: ["clinica-alto-padrao", "document-ai-vault"],
      guardrailOverrides: PAIN_POINT_PRESETS["passivo-clt-overtime"].guardrailOverrides,
      regiaoOperacao: "br",
    };

    // --- Estado ANTES, visto por cada gaveta (linha de base) ---
    const idsAntes = obterIdsModulosAtivos(antes);
    expect(idsAntes).toEqual(["clinica-alto-padrao", "document-ai-vault"]);
    expect(construirTabelaPipelinePadrao(idsAntes)["clinica-alto-padrao"]).toBeGreaterThan(0);
    expect(gerarContextoNicho(antes.setor)).toContain("procedimentos estéticos");

    // AÇÃO: operador troca de nicho em Configurações — Construtora &
    // Imobiliária, outro ralo de caixa, região Global.
    const ajustes = derivarAjustesDoQuiz(
      { setor: "construtora-imobiliaria", ralogDeCaixa: "no-show-agendamento", regiaoOperacao: "global" },
      antes.modulosAtivos,
      REFERENCIA
    );
    const depois = aplicarPatch(antes, ajustes.workspacePatch);

    // --- (a) RoiConfig: moeda/regime mudam instantaneamente ---
    expect(ajustes.roiConfigPatch).toEqual({ moedaExibicao: "USD", regimeEncargos: "payroll-us-uk" });
    expect(ajustes.roiConfigPatch).toEqual({
      moedaExibicao: REGIAO_PRESETS.global.moedaPadrao,
      regimeEncargos: REGIAO_PRESETS.global.regimeEncargosPadrao,
    });

    // --- (b) Pipeline/Oportunidade: a tabela do NOVO nicho fica ativa; a do
    //     antigo deixa de ser considerada — sem o antigo "roubar" peso. ---
    const idsDepois = obterIdsModulosAtivos(depois);
    expect(idsDepois).toEqual(["construtora-imobiliaria", "document-ai-vault"]); // gaveta extra preservada
    expect(idsDepois).not.toContain("clinica-alto-padrao"); // NADA órfão do nicho anterior
    const tabelaDepois = construirTabelaPipelinePadrao(idsDepois);
    expect(tabelaDepois["construtora-imobiliaria"]).toBeGreaterThan(0);

    // --- (c) Neural Inbox: o contexto de prompt já é o do novo nicho —
    //     nunca mistura com o perfil antigo. ---
    expect(depois.setor).toBe("construtora-imobiliaria");
    const contextoNovo = gerarContextoNicho(depois.setor as typeof depois.setor);
    expect(contextoNovo).not.toBeNull();
    expect(contextoNovo).not.toContain("procedimentos estéticos"); // nada do perfil antigo sobrou
    expect(contextoNovo).toContain("corretor"); // perfil novo, de verdade

    // --- (d) Guardrails: a sobrescrita antiga (passivo trabalhista) não
    //     sobrevive — substituída por completo pela do novo ralo de caixa. ---
    expect(depois.guardrailOverrides).toEqual(PAIN_POINT_PRESETS["no-show-agendamento"].guardrailOverrides);
    expect(depois.guardrailOverrides).not.toEqual(antes.guardrailOverrides);

    // --- Playbooks sugeridos também já são os do novo nicho. ---
    expect(ajustes.workspacePatch.playbooksSugeridos).toEqual(
      NICHE_PRESETS["construtora-imobiliaria"].playbooksSugeridos
    );
  });

  it("workspace SEM nenhuma gaveta extra ligada: trocar de nicho não inventa modulosAtivos — cada gaveta volta a depender só do novo `setor`", () => {
    const antes: Partial<Workspace> = { setor: "ecommerce" };
    expect(obterIdsModulosAtivos(antes)).toEqual(["ecommerce"]);

    const ajustes = derivarAjustesDoQuiz(
      { setor: "logistica-portuaria", ralogDeCaixa: "outro", regiaoOperacao: "br" },
      antes.modulosAtivos,
      REFERENCIA
    );
    const depois = aplicarPatch(antes, ajustes.workspacePatch);

    expect(depois.modulosAtivos).toEqual([]);
    expect(obterIdsModulosAtivos(depois)).toEqual(["logistica-portuaria"]); // cai de volta no `setor` sozinho
  });

  it("duas gavetas extras ligadas, trocando de nicho duas vezes em sequência: nenhuma extra se perde, nenhum nicho antigo acumula", () => {
    const inicial: Partial<Workspace> = {
      setor: "ecommerce",
      modulosAtivos: ["ecommerce", "sheet-reconciliation", "ar-recovery-engine"],
    };

    const primeiraTroca = derivarAjustesDoQuiz(
      { setor: "clinica-alto-padrao", ralogDeCaixa: "outro", regiaoOperacao: "br" },
      inicial.modulosAtivos,
      REFERENCIA
    );
    const intermediario = aplicarPatch(inicial, primeiraTroca.workspacePatch);
    expect(intermediario.modulosAtivos).toEqual([
      "clinica-alto-padrao",
      "sheet-reconciliation",
      "ar-recovery-engine",
    ]);

    const segundaTroca = derivarAjustesDoQuiz(
      { setor: "logistica-portuaria", ralogDeCaixa: "outro", regiaoOperacao: "br" },
      intermediario.modulosAtivos,
      REFERENCIA
    );
    const final = aplicarPatch(intermediario, segundaTroca.workspacePatch);

    expect(final.modulosAtivos).toEqual(["logistica-portuaria", "sheet-reconciliation", "ar-recovery-engine"]);
    // Nenhum dos dois nichos anteriores (ecommerce, clínica) sobrevive no slot primário.
    expect(final.modulosAtivos).not.toContain("ecommerce");
    expect(final.modulosAtivos).not.toContain("clinica-alto-padrao");
  });
});
