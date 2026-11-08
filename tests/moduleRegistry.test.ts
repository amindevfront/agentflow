import { describe, expect, it } from "vitest";
import type { NicheKey, Workspace } from "@/types";
import {
  MODULE_REGISTRY,
  construirTabelaPipelinePadrao,
  obterIdsModulosAtivos,
  obterModulo,
  obterModulosAtivos,
} from "@/modules/registry";
import { INBOX_EXTRAS_REGISTRY } from "@/modules/registry.client";
import { NICHE_ORDER } from "@/lib/niches";
import { ROI_CONFIG_PADRAO, cambioParaMoeda, formatarMoeda } from "@/lib/roi";
import { POLITICA_IMOBILIARIO_ALTO_PADRAO, POLITICA_NO_CRITICO, POLITICA_PADRAO, resolverPolitica } from "@/lib/guardrails/policy";
import { PiiVault, inspecionarSaida } from "@/lib/guardrails";

describe("obterModulo", () => {
  it("resolve a gaveta registrada para um nicho conhecido", () => {
    expect(obterModulo("construtora-imobiliaria")?.nome).toBe("Construtoras & Imobiliárias de Alto Padrão");
  });

  it("devolve null para nichos sem gaveta registrada, nunca inventa uma", () => {
    expect(obterModulo("outros")).toBeNull();
    expect(obterModulo("servicos-luxo")).toBeNull();
    expect(obterModulo(undefined)).toBeNull();
  });
});

describe("obterIdsModulosAtivos — compatibilidade retroativa", () => {
  it("cai no `setor` único quando `modulosAtivos` está ausente (workspace pré-existente)", () => {
    const workspace: Pick<Workspace, "setor" | "modulosAtivos"> = { setor: "clinica-alto-padrao" };
    expect(obterIdsModulosAtivos(workspace)).toEqual(["clinica-alto-padrao"]);
  });

  it("`modulosAtivos` explícito tem prioridade sobre `setor`", () => {
    const workspace: Pick<Workspace, "setor" | "modulosAtivos"> = {
      setor: "construtora-imobiliaria",
      modulosAtivos: ["construtora-imobiliaria", "advocacia-contabilidade"],
    };
    expect(obterIdsModulosAtivos(workspace)).toEqual(["construtora-imobiliaria", "advocacia-contabilidade"]);
  });

  it("workspace sem setor nem modulosAtivos não ativa nenhuma gaveta", () => {
    expect(obterIdsModulosAtivos({})).toEqual([]);
    expect(obterIdsModulosAtivos(null)).toEqual([]);
  });
});

describe("obterModulosAtivos", () => {
  it("resolve múltiplas gavetas distintas, na ordem informada", () => {
    const workspace: Pick<Workspace, "setor" | "modulosAtivos"> = {
      modulosAtivos: ["construtora-imobiliaria", "ecommerce"],
    };
    const modulos = obterModulosAtivos(workspace);
    expect(modulos.map((m) => m.id)).toEqual(["construtora-imobiliaria", "ecommerce"]);
  });

  it("deduplica quando a mesma gaveta é repetida em `modulosAtivos`", () => {
    const workspace: Pick<Workspace, "setor" | "modulosAtivos"> = {
      modulosAtivos: ["ecommerce", "ecommerce"],
    };
    expect(obterModulosAtivos(workspace)).toHaveLength(1);
  });

  it("`clinica-alto-padrao` e `clinica-medica-exames` compartilham guardrail e UI, mas são gavetas distintas (pipeline não é compartilhado)", () => {
    const esteticoAltoPadrao = obterModulo("clinica-alto-padrao");
    const examesMedicos = obterModulo("clinica-medica-exames");
    expect(esteticoAltoPadrao?.guardrailPolicyId).toBe(examesMedicos?.guardrailPolicyId);
    expect(esteticoAltoPadrao?.valorMedioPipelineBrl).toBe(3_500);
    expect(examesMedicos?.valorMedioPipelineBrl).toBe(0);
  });
});

describe("Integridade do registro (`registry.ts` × `registry.client.tsx`)", () => {
  it("toda gaveta com `temInboxExtras: true` tem um componente correspondente em INBOX_EXTRAS_REGISTRY", () => {
    for (const [id, modulo] of Object.entries(MODULE_REGISTRY)) {
      if (!modulo) continue;
      if (modulo.temInboxExtras) {
        expect(INBOX_EXTRAS_REGISTRY[id as NicheKey]).toBeDefined();
      } else {
        expect(INBOX_EXTRAS_REGISTRY[id as NicheKey]).toBeUndefined();
      }
    }
  });
});

describe("construirTabelaPipelinePadrao", () => {
  // `NICHE_ORDER` (`@/lib/niches`), não uma lista duplicada aqui: é a mesma
  // fonte única de verdade que `@/lib/server/roiDashboard` agora usa — um
  // nicho novo que esqueça de entrar em `NICHE_ORDER` já falha em
  // `tests/niches.test.ts` antes de chegar aqui.
  it("projeta o valor de cada gaveta registrada e zera nichos sem módulo", () => {
    const tabela = construirTabelaPipelinePadrao(NICHE_ORDER);
    expect(tabela["construtora-imobiliaria"]).toBe(15_000);
    expect(tabela["clinica-alto-padrao"]).toBe(3_500);
    expect(tabela["advocacia-contabilidade"]).toBe(8_000);
    expect(tabela["logistica-portuaria"]).toBe(0);
    expect(tabela["servicos-luxo"]).toBe(0);
    expect(tabela.ecommerce).toBe(0);
    expect(tabela["salao-beleza"]).toBe(0);
    expect(tabela["clinica-medica-exames"]).toBe(0);
    expect(tabela.outros).toBe(0);
    // Expansão Enterprise Global.
    expect(tabela["us-real-estate-luxury"]).toBe(135_000);
    expect(tabela["us-construction-remodeling"]).toBe(43_200);
    expect(tabela["portugal-clinics-health"]).toBe(1_180);
  });

  it("nenhuma chave de NICHE_ORDER fica de fora da tabela (Record exaustivo de verdade, não só de tipo)", () => {
    const tabela = construirTabelaPipelinePadrao(NICHE_ORDER);
    for (const nicho of NICHE_ORDER) {
      expect(tabela[nicho]).toBeDefined();
      expect(Number.isFinite(tabela[nicho])).toBe(true);
    }
  });
});

describe("Expansão Enterprise Global — camada de localização (moeda, jurisdição, idioma, fuso)", () => {
  it("cada gaveta internacional declara moeda nativa, jurisdição e idioma coerentes com o mercado-alvo", () => {
    const usRealEstate = obterModulo("us-real-estate-luxury")!;
    const usConstruction = obterModulo("us-construction-remodeling")!;
    const ptClinics = obterModulo("portugal-clinics-health")!;

    expect(usRealEstate.moeda).toBe("USD");
    expect(usRealEstate.jurisdicao).toBe("us-privacy");
    expect(usRealEstate.idiomaPadrao).toBe("en");
    expect(usRealEstate.fusoHorario).toBe("America/New_York");

    expect(usConstruction.moeda).toBe("USD");
    expect(usConstruction.jurisdicao).toBe("us-privacy");
    expect(usConstruction.idiomaPadrao).toBe("en");

    expect(ptClinics.moeda).toBe("EUR");
    expect(ptClinics.jurisdicao).toBe("eu-gdpr");
    expect(ptClinics.idiomaPadrao).toBe("pt");
    expect(ptClinics.fusoHorario).toBe("Europe/Lisbon");
  });

  it("toda gaveta registrada declara piiKindsRelevantes não vazio (blindagem de dados nunca ausente)", () => {
    for (const modulo of Object.values(MODULE_REGISTRY)) {
      if (!modulo) continue;
      expect(modulo.piiKindsRelevantes.length).toBeGreaterThan(0);
    }
  });

  it("os EUA destacam SSN e Portugal destaca NIF como PII relevante — categorias já suportadas pelo Shield-Layer", () => {
    expect(obterModulo("us-real-estate-luxury")?.piiKindsRelevantes).toContain("ssn-us");
    expect(obterModulo("us-construction-remodeling")?.piiKindsRelevantes).toContain("ssn-us");
    expect(obterModulo("portugal-clinics-health")?.piiKindsRelevantes).toContain("nif-pt");
  });

  it("o BusinessROIWidget (via @/lib/roi) formata o ROI na moeda nativa de cada gaveta internacional", () => {
    const usModule = obterModulo("us-real-estate-luxury")!;
    const ptModule = obterModulo("portugal-clinics-health")!;
    const valorBrl = 1_000;

    const emUsd = formatarMoeda(valorBrl, usModule.moeda, cambioParaMoeda(ROI_CONFIG_PADRAO, usModule.moeda));
    const emEur = formatarMoeda(valorBrl, ptModule.moeda, cambioParaMoeda(ROI_CONFIG_PADRAO, ptModule.moeda));

    expect(emUsd).toContain("$");
    expect(emEur).toContain("€");
    // BRL nunca converte, qualquer que seja a gaveta (ver `formatarMoeda`).
    expect(formatarMoeda(valorBrl, "BRL")).toContain("R$");
  });

  it("workspaces americanos resolvem a política de Proteção de Caixa e ela bloqueia a promessa comercial em inglês", () => {
    const usRealEstate = obterModulo("us-real-estate-luxury")!;
    const usConstruction = obterModulo("us-construction-remodeling")!;
    expect(usRealEstate.guardrailPolicyId).toBe(POLITICA_IMOBILIARIO_ALTO_PADRAO.id);
    expect(usConstruction.guardrailPolicyId).toBe(POLITICA_IMOBILIARIO_ALTO_PADRAO.id);

    const politica = resolverPolitica(usRealEstate.guardrailPolicyId);
    expect(politica.bloquearPromessaComercialNaoAutorizada).toBe(true);

    const resultado = inspecionarSaida({
      amostras: ["Sure, I can give you a 15% discount on that unit."],
      vault: new PiiVault(),
      politica,
    });

    expect(resultado.veredito).toBe("bloqueado");
    expect(resultado.violacoes.some((v) => v.regra === "preco-comercial-nao-autorizado")).toBe(true);
  });

  it("a gaveta portuguesa resolve o Guardrail Clínico/Ético — mesma política do Vertical 2 (BR)", () => {
    const ptModule = obterModulo("portugal-clinics-health")!;
    const politica = resolverPolitica(ptModule.guardrailPolicyId);
    expect(politica.bloquearDiagnosticoOuResultadoClinico).toBe(true);
  });
});

describe("Full-Scope Enterprise Operations — gavetas de back-office", () => {
  const IDS_BACK_OFFICE: NicheKey[] = ["document-ai-vault", "sheet-reconciliation", "ar-recovery-engine"];

  it("as três gavetas de back-office estão registradas", () => {
    for (const id of IDS_BACK_OFFICE) {
      expect(obterModulo(id)).not.toBeNull();
    }
  });

  it("nenhuma gaveta de back-office gera pipeline de vendas (Artigo IV — economizam horas, não geram oportunidade comercial)", () => {
    for (const id of IDS_BACK_OFFICE) {
      const modulo = obterModulo(id)!;
      expect(modulo.valorMedioPipelineBrl).toBe(0);
      expect(modulo.valorMedioPipelineMoedaLocal).toBe(0);
    }
  });

  it("toda gaveta de back-office declara moeda, jurisdição, idioma, fuso e PII relevantes", () => {
    for (const id of IDS_BACK_OFFICE) {
      const modulo = obterModulo(id)!;
      expect(modulo.moeda).toBeTruthy();
      expect(modulo.jurisdicao).toBeTruthy();
      expect(modulo.idiomaPadrao).toBeTruthy();
      expect(modulo.fusoHorario).toBeTruthy();
      expect(modulo.piiKindsRelevantes.length).toBeGreaterThan(0);
    }
  });

  it("document-ai-vault e ar-recovery-engine são painéis standalone/Governança — não entram no INBOX_EXTRAS_REGISTRY", () => {
    expect(obterModulo("document-ai-vault")!.temInboxExtras).toBe(false);
    expect(obterModulo("ar-recovery-engine")!.temInboxExtras).toBe(false);
    expect(INBOX_EXTRAS_REGISTRY["document-ai-vault"]).toBeUndefined();
    expect(INBOX_EXTRAS_REGISTRY["ar-recovery-engine"]).toBeUndefined();
  });

  it("sheet-reconciliation é um widget de Neural Inbox — entra no INBOX_EXTRAS_REGISTRY", () => {
    expect(obterModulo("sheet-reconciliation")!.temInboxExtras).toBe(true);
    expect(INBOX_EXTRAS_REGISTRY["sheet-reconciliation"]).toBeDefined();
  });

  it("document-ai-vault reaproveita a política de nó crítico (dado sensível/financeiro)", () => {
    expect(obterModulo("document-ai-vault")!.guardrailPolicyId).toBe(POLITICA_NO_CRITICO.id);
  });

  it("sheet-reconciliation reaproveita a política padrão (risco baixo)", () => {
    expect(obterModulo("sheet-reconciliation")!.guardrailPolicyId).toBe(POLITICA_PADRAO.id);
  });

  it("ar-recovery-engine reaproveita a Proteção de Caixa — nenhum perdão/desconto sem validação prévia", () => {
    const modulo = obterModulo("ar-recovery-engine")!;
    expect(modulo.guardrailPolicyId).toBe(POLITICA_IMOBILIARIO_ALTO_PADRAO.id);
    expect(resolverPolitica(modulo.guardrailPolicyId).bloquearPromessaComercialNaoAutorizada).toBe(true);
  });

  it("um workspace pode ativar uma gaveta de back-office JUNTO do seu setor de indústria, sem perder nenhuma das duas", () => {
    const workspace: Pick<Workspace, "setor" | "modulosAtivos"> = {
      setor: "clinica-alto-padrao",
      modulosAtivos: ["clinica-alto-padrao", "document-ai-vault", "sheet-reconciliation"],
    };
    const modulos = obterModulosAtivos(workspace);
    expect(modulos.map((m) => m.id)).toEqual(["clinica-alto-padrao", "document-ai-vault", "sheet-reconciliation"]);
  });

  it("não aparecem em NICHE_ORDER (não são nichos de indústria escolhidos no onboarding)", () => {
    for (const id of IDS_BACK_OFFICE) {
      expect(NICHE_ORDER).not.toContain(id);
    }
  });
});
