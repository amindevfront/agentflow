// Vitrine Enterprise — catálogo de canais, cenários de demonstração e
// sanitização de artefatos legados.
//
// A parte mais importante deste arquivo é a última: uma varredura do
// código-fonte garantindo que nenhum artefato do sandbox genérico antigo
// ("Salão de Beleza / Barbearia") volte a aparecer em seed, preset, prompt
// ou view. Um teste de unidade por módulo não pegaria isso — a regressão
// típica é alguém reintroduzir o exemplo em UM arquivo novo.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATALOGO_CANAIS,
  CONNECTOR_TYPES,
  TIPOS_COM_INGESTAO_REAL,
  TIPOS_SEM_INGESTAO_REAL,
  TIPO_TELEGRAM,
  TIPO_WHATSAPP,
  canaisDaCamada,
  obterDefinicaoCanal,
} from "@/lib/connectorCatalog";
import {
  CENARIOS_DEMO,
  CENARIO_IMOBILIARIO,
  CENARIO_LOGISTICA,
  ORDEM_CENARIOS,
  obterCenario,
} from "@/lib/demoScenarios";
import { obterContratoVertical } from "@/lib/verticalTelemetry";
import { NICHE_ORDER, NICHE_PRESETS } from "@/lib/niches";

describe("catálogo de canais", () => {
  it("os quatro canais tier-1 são exatamente os operacionais primários pedidos", () => {
    const rotulos = canaisDaCamada("tier-1").map((c) => c.rotuloCurto);
    expect(rotulos).toEqual([
      "WhatsApp Business",
      "Instagram Direct",
      "Web Widget Corporativo",
      "Telegram",
    ]);
  });

  it("todo canal tier-1 tem ingestão real — a vitrine nunca promove um canal que não funciona", () => {
    for (const canal of canaisDaCamada("tier-1")) {
      expect(canal.ingestaoReal, canal.tipo).toBe(true);
    }
  });

  it("a gaveta Beta contém só canais SEM ingestão real", () => {
    const beta = canaisDaCamada("beta");
    expect(beta.length).toBeGreaterThan(0);
    for (const canal of beta) {
      expect(canal.ingestaoReal, canal.tipo).toBe(false);
      expect(TIPOS_SEM_INGESTAO_REAL.has(canal.tipo)).toBe(true);
    }
  });

  it("canais adicionais ativos são reais — nunca escondidos no Beta como se não existissem", () => {
    const adicionais = canaisDaCamada("ativo-adicional");
    expect(adicionais.length).toBeGreaterThan(0);
    for (const canal of adicionais) {
      expect(canal.ingestaoReal, canal.tipo).toBe(true);
    }
  });

  it("os dois conjuntos derivados particionam o catálogo, sem sobra nem sobreposição", () => {
    expect(TIPOS_COM_INGESTAO_REAL.size + TIPOS_SEM_INGESTAO_REAL.size).toBe(CATALOGO_CANAIS.length);
    for (const tipo of TIPOS_COM_INGESTAO_REAL) {
      expect(TIPOS_SEM_INGESTAO_REAL.has(tipo)).toBe(false);
    }
  });

  it("nenhum `tipo` duplicado — a chave é gravada em Connector.tipo e comparada por igualdade exata", () => {
    expect(new Set(CONNECTOR_TYPES).size).toBe(CONNECTOR_TYPES.length);
  });

  it("os `tipo` de WhatsApp e Telegram continuam idênticos aos esperados pelos resolvedores de webhook", () => {
    // Renomear qualquer um destes órfã conectores já criados em produção.
    expect(TIPO_WHATSAPP).toBe("WhatsApp Business (Cloud API)");
    expect(TIPO_TELEGRAM).toBe("Telegram Bot API");
  });

  it("obterDefinicaoCanal devolve null para tipo legado, nunca lança", () => {
    expect(obterDefinicaoCanal("Canal Que Não Existe")).toBeNull();
    expect(obterDefinicaoCanal(TIPO_WHATSAPP)?.camada).toBe("tier-1");
  });
});

describe("cenários de demonstração", () => {
  it("cada cenário aponta para um nicho que TEM motor vertical dedicado", () => {
    for (const id of ORDEM_CENARIOS) {
      const cenario = CENARIOS_DEMO[id];
      const contrato = obterContratoVertical(cenario.setor);
      expect(contrato, cenario.id).not.toBeNull();
      expect(contrato?.id).toBe(cenario.vertical);
    }
  });

  it("todo lead semeado tem pelo menos uma mensagem e um canal válido", () => {
    for (const id of ORDEM_CENARIOS) {
      const cenario = CENARIOS_DEMO[id];
      expect(cenario.leads.length).toBeGreaterThan(0);
      for (const lead of cenario.leads) {
        expect(lead.mensagens.length).toBeGreaterThan(0);
        expect(lead.nome.trim().length).toBeGreaterThan(0);
        expect(lead.identificador.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("o cenário imobiliário cobre as três histórias pedidas (4 suítes, pagamento indexado, showroom VIP)", () => {
    const texto = JSON.stringify(CENARIO_IMOBILIARIO).toLowerCase();
    expect(texto).toContain("4 suítes");
    expect(texto).toContain("incc");
    expect(texto).toContain("showroom");
    expect(texto).toContain("praia brava");
  });

  it("o cenário logístico cobre cotação spot, consulta de status e ocorrência crítica", () => {
    const texto = JSON.stringify(CENARIO_LOGISTICA).toLowerCase();
    expect(texto).toContain("cotação spot");
    expect(texto).toContain("ct-e");
    expect(texto).toContain("parada de linha");
  });

  it("toda carga de demonstração usa o prefixo DEMO- no código de rastreio", () => {
    for (const carga of CENARIO_LOGISTICA.cargas) {
      expect(carga.codigoRastreio.startsWith("DEMO-")).toBe(true);
    }
  });

  it("obterCenario tolera id legado/ausente sem lançar", () => {
    expect(obterCenario("cenario-que-nao-existe")).toBeNull();
    expect(obterCenario(null)).toBeNull();
    expect(obterCenario("incorporadora-atlantica")?.vertical).toBe("imobiliario-alto-padrao");
  });
});

describe("sanitização da vitrine — artefatos legados purgados", () => {
  const PROIBIDO = /sal[ãa]o\s+de\s+beleza|barbearia|salao-beleza|salonsoft|sal[ãa]o\s+da\s+m[ãa]e/i;

  function arquivosFonte(diretorio: string, acumulado: string[] = []): string[] {
    for (const nome of readdirSync(diretorio)) {
      const caminho = join(diretorio, nome);
      if (statSync(caminho).isDirectory()) {
        arquivosFonte(caminho, acumulado);
      } else if (/\.(ts|tsx)$/.test(nome)) {
        acumulado.push(caminho);
      }
    }
    return acumulado;
  }

  it("nenhum arquivo de `src/` menciona o sandbox genérico antigo", () => {
    const ofensores: string[] = [];
    for (const caminho of arquivosFonte(resolve(__dirname, "..", "src"))) {
      const conteudo = readFileSync(caminho, "utf-8");
      if (PROIBIDO.test(conteudo)) ofensores.push(caminho);
    }
    expect(ofensores).toEqual([]);
  });

  it("o nicho removido não sobrevive em NICHE_ORDER nem em NICHE_PRESETS", () => {
    expect(NICHE_ORDER.some((k) => String(k) === "salao-beleza")).toBe(false);
    expect(Object.keys(NICHE_PRESETS).includes("salao-beleza")).toBe(false);
  });

  it("as duas verticais de alto ticket abrem a triagem de nicho do onboarding", () => {
    expect(NICHE_ORDER[0]).toBe("construtora-imobiliaria");
    expect(NICHE_ORDER[1]).toBe("logistica-portuaria");
  });

  it("NICHE_ORDER não tem chave repetida", () => {
    expect(new Set(NICHE_ORDER).size).toBe(NICHE_ORDER.length);
  });
});
