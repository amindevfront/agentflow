import { describe, expect, it } from "vitest";
import { detectarCompliancePreventivo } from "@/lib/guardrails/compliancePreventivo";

describe("detectarCompliancePreventivo", () => {
  it("não acusa nada em mensagem neutra de atendimento", () => {
    const resultado = detectarCompliancePreventivo("Olá! Seu pedido está em preparação e deve chegar em 3 dias úteis.");
    expect(resultado.violacoes).toEqual([]);
    expect(resultado.categorias).toEqual([]);
  });

  it("devolve vazio para texto vazio ou apenas espaços", () => {
    expect(detectarCompliancePreventivo("").violacoes).toEqual([]);
    expect(detectarCompliancePreventivo("   ").violacoes).toEqual([]);
  });

  it("detecta promessa de resultado garantido", () => {
    const resultado = detectarCompliancePreventivo("Pode ficar tranquilo, o resultado é garantido!");
    const violacao = resultado.violacoes.find((v) => v.regra === "promessa-comercial-indevida");
    expect(violacao).toBeDefined();
    expect(resultado.categorias).toContain("promessa de resultado garantido");
  });

  it("detecta promessa financeira indevida com severidade alta", () => {
    const resultado = detectarCompliancePreventivo("Sua aprovação garantida, pode assinar o contrato.");
    const violacao = resultado.violacoes.find((v) => v.regra === "promessa-comercial-indevida");
    expect(violacao).toBeDefined();
    expect(violacao?.severidade).toBe("critica");
  });

  it("detecta ausência de risco prometida", () => {
    const resultado = detectarCompliancePreventivo("Esse investimento tem risco zero, pode confiar.");
    expect(resultado.categorias).toContain("promessa de ausência de risco");
  });

  it("detecta linguagem ofensiva como conduta inadequada", () => {
    const resultado = detectarCompliancePreventivo("Para de ser burro e lê o que eu mandei, idiota.");
    const violacao = resultado.violacoes.find((v) => v.regra === "conduta-inadequada");
    expect(violacao).toBeDefined();
    expect(violacao?.severidade).toBe("critica");
    expect(resultado.categorias).toContain("linguagem ofensiva");
  });

  it("detecta aproximação pessoal indevida", () => {
    const resultado = detectarCompliancePreventivo("Me chama no particular que a gente conversa melhor.");
    expect(resultado.categorias).toContain("aproximação pessoal indevida");
  });

  it("detecta ameaça ou intimidação com severidade crítica", () => {
    const resultado = detectarCompliancePreventivo("Você vai se arrepender disso, pode ter certeza.");
    const violacao = resultado.violacoes.find((v) => v.regra === "conduta-inadequada");
    expect(violacao?.severidade).toBe("critica");
  });

  it("acumula as duas categorias quando a mesma mensagem contém ambas", () => {
    const resultado = detectarCompliancePreventivo(
      "Aprovação garantida, e se não gostar é só porque você é burro mesmo."
    );
    const regras = new Set(resultado.violacoes.map((v) => v.regra));
    expect(regras.has("promessa-comercial-indevida")).toBe(true);
    expect(regras.has("conduta-inadequada")).toBe(true);
  });

  it("não deduplica categorias repetidas no mesmo texto", () => {
    const resultado = detectarCompliancePreventivo("Garantido, garantimos, é 100% garantido!");
    const violacao = resultado.violacoes.find((v) => v.regra === "promessa-comercial-indevida");
    // Mesma categoria casada por três padrões diferentes: o Set de categorias colapsa para uma entrada.
    expect(resultado.categorias.filter((c) => c === "promessa de resultado garantido")).toHaveLength(1);
    expect(violacao?.score).toBeGreaterThan(0);
  });

  it("é determinístico: mesma entrada produz sempre o mesmo resultado", () => {
    const texto = "Garantimos 100% de aprovação, sem risco nenhum para você.";
    const primeira = detectarCompliancePreventivo(texto);
    const segunda = detectarCompliancePreventivo(texto);
    expect(segunda).toEqual(primeira);
  });

  it("não confunde elogio legítimo ao produto com comentário pessoal inapropriado", () => {
    const resultado = detectarCompliancePreventivo("Nosso atendimento foi muito elogiado pelos clientes este mês.");
    expect(resultado.violacoes).toEqual([]);
  });
});
