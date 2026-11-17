import { describe, expect, it } from "vitest";
import {
  FLOW_TEMPLATES,
  TEMPLATE_IMOBILIARIO,
  TEMPLATE_LOGISTICA,
  novoFluxoDoTemplate,
  obterTemplate,
  stepsDoTemplate,
  templatesParaSetor,
  validarGrafoFluxo,
} from "@/lib/flowTemplates";
import { POLITICAS_PREDEFINIDAS } from "@/lib/guardrails/policy";

describe("integridade dos grafos de template", () => {
  it("nenhum template tem nó órfão, aresta quebrada ou id duplicado", () => {
    for (const template of FLOW_TEMPLATES) {
      expect(validarGrafoFluxo(template.grafo), `template ${template.id}`).toEqual([]);
    }
  });

  it("todo template tem pelo menos uma aresta de fallback (falha ou escalonamento)", () => {
    for (const template of FLOW_TEMPLATES) {
      const fallbacks = template.grafo.arestas.filter((a) => a.tipo !== "sucesso");
      expect(fallbacks.length, `template ${template.id}`).toBeGreaterThan(0);
    }
  });

  it("todo nó de guardrail aponta para uma política REALMENTE registrada", () => {
    for (const template of FLOW_TEMPLATES) {
      for (const no of template.grafo.nos) {
        if (no.tipo !== "guardrail") continue;
        expect(no.politicaGuardrailId, `nó ${no.id}`).toBeTruthy();
        expect(POLITICAS_PREDEFINIDAS[no.politicaGuardrailId as string], `nó ${no.id}`).toBeDefined();
      }
    }
  });

  it("todo nó de fallback é alvo de pelo menos uma aresta de falha/escalonamento", () => {
    for (const template of FLOW_TEMPLATES) {
      const fallbacks = template.grafo.nos.filter((n) => n.tipo === "fallback");
      for (const no of fallbacks) {
        const alcancado = template.grafo.arestas.some((a) => a.para === no.id && a.tipo !== "sucesso");
        expect(alcancado, `nó ${no.id} do template ${template.id}`).toBe(true);
      }
    }
  });
});

describe("validarGrafoFluxo", () => {
  it("acusa aresta que aponta para um nó inexistente", () => {
    const problemas = validarGrafoFluxo({
      nos: [{ id: "a", titulo: "A", tipo: "gatilho", descricao: "" }],
      arestas: [{ de: "a", para: "typo-aqui", tipo: "falha" }],
    });
    expect(problemas.some((p) => p.codigo === "aresta-invalida")).toBe(true);
  });

  it("acusa nó que não participa de nenhuma aresta", () => {
    const problemas = validarGrafoFluxo({
      nos: [
        { id: "a", titulo: "A", tipo: "gatilho", descricao: "" },
        { id: "b", titulo: "B", tipo: "handoff", descricao: "" },
        { id: "orfao", titulo: "Órfão", tipo: "consulta", descricao: "" },
      ],
      arestas: [{ de: "a", para: "b", tipo: "escalonamento" }],
    });
    expect(problemas.some((p) => p.codigo === "no-orfao")).toBe(true);
  });

  it("acusa grafo que só cobre o caminho feliz", () => {
    const problemas = validarGrafoFluxo({
      nos: [
        { id: "a", titulo: "A", tipo: "gatilho", descricao: "" },
        { id: "b", titulo: "B", tipo: "notificacao", descricao: "" },
      ],
      arestas: [{ de: "a", para: "b", tipo: "sucesso" }],
    });
    expect(problemas.some((p) => p.codigo === "sem-fallback")).toBe(true);
  });

  it("acusa id de nó duplicado", () => {
    const problemas = validarGrafoFluxo({
      nos: [
        { id: "a", titulo: "A", tipo: "gatilho", descricao: "" },
        { id: "a", titulo: "A de novo", tipo: "handoff", descricao: "" },
      ],
      arestas: [{ de: "a", para: "a", tipo: "falha" }],
    });
    expect(problemas.some((p) => p.codigo === "id-duplicado")).toBe(true);
  });
});

describe("stepsDoTemplate", () => {
  it("projeta o caminho feliz — nós de fallback ficam fora do trilho de execução", () => {
    const steps = stepsDoTemplate(TEMPLATE_IMOBILIARIO);
    const idsFallback = TEMPLATE_IMOBILIARIO.grafo.nos.filter((n) => n.tipo === "fallback").map((n) => n.id);
    for (const id of idsFallback) {
      expect(steps.some((s) => s.id === id)).toBe(false);
    }
    expect(steps.length).toBe(TEMPLATE_IMOBILIARIO.grafo.nos.length - idsFallback.length);
  });

  it("todo step tem título não vazio (mín. de `FlowSettingsForm` para um fluxo salvável)", () => {
    for (const template of FLOW_TEMPLATES) {
      for (const step of stepsDoTemplate(template)) {
        expect(step.titulo.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("novoFluxoDoTemplate", () => {
  it("produz um payload de createFlow completo, com grafo e rastreabilidade do template", () => {
    const payload = novoFluxoDoTemplate(TEMPLATE_LOGISTICA);
    expect(payload.nome).toBe(TEMPLATE_LOGISTICA.nome);
    expect(payload.status).toBe("ocioso");
    expect(payload.templateId).toBe(TEMPLATE_LOGISTICA.id);
    expect(payload.grafo?.nos.length).toBe(TEMPLATE_LOGISTICA.grafo.nos.length);
    // Mesma regra do formulário manual: nome com pelo menos 3 caracteres.
    expect(payload.nome.trim().length).toBeGreaterThanOrEqual(3);
  });
});

describe("templatesParaSetor", () => {
  it("coloca o template do setor ativo em primeiro, sem perder nenhum", () => {
    const paraLogistica = templatesParaSetor("logistica-portuaria");
    expect(paraLogistica[0].id).toBe(TEMPLATE_LOGISTICA.id);
    expect(paraLogistica).toHaveLength(FLOW_TEMPLATES.length);

    const paraImobiliario = templatesParaSetor("construtora-imobiliaria");
    expect(paraImobiliario[0].id).toBe(TEMPLATE_IMOBILIARIO.id);
  });

  it("sem setor definido, devolve a lista completa na ordem natural", () => {
    expect(templatesParaSetor(null)).toHaveLength(FLOW_TEMPLATES.length);
    expect(templatesParaSetor(undefined)).toHaveLength(FLOW_TEMPLATES.length);
  });
});

describe("obterTemplate", () => {
  it("devolve null para id desconhecido em vez de lançar — `Flow.templateId` legado não pode quebrar a tela", () => {
    expect(obterTemplate("template-que-nao-existe")).toBeNull();
    expect(obterTemplate(null)).toBeNull();
    expect(obterTemplate(TEMPLATE_IMOBILIARIO.id)?.id).toBe(TEMPLATE_IMOBILIARIO.id);
  });
});
