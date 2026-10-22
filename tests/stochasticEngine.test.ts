import { describe, expect, it } from "vitest";
import type { CampaignRecipient, JitterConfig, OptOutEntry } from "@/types";
import {
  calcularAtrasoComTeto,
  hashDestino,
  planejarLotes,
  processarEnviosDevidos,
  verificarConformidade,
} from "@/lib/campaigns/stochasticEngine";

const CONFIG: JitterConfig = {
  minMs: 1_000,
  maxMs: 5_000,
  loteSize: 3,
  pausaEntreLotesMs: 20_000,
  taxaMaximaPorMinuto: 30,
};

/** RNG determinístico para testes — nunca `Math.random()`. */
function rngFixo(valor: number): () => number {
  return () => valor;
}

function destinatario(parcial: Partial<CampaignRecipient> = {}): CampaignRecipient {
  return {
    id: "r1",
    destinoMascarado: "[[PII:TELEFONE:1]]",
    destinoHash: "hash-1",
    status: "pendente",
    ...parcial,
  };
}

describe("calcularAtrasoComTeto", () => {
  it("respeita o intervalo [minMs, maxMs] configurado", () => {
    const baixo = calcularAtrasoComTeto(CONFIG, rngFixo(0));
    const alto = calcularAtrasoComTeto(CONFIG, rngFixo(1));
    expect(baixo).toBeGreaterThanOrEqual(CONFIG.minMs);
    expect(alto).toBeLessThanOrEqual(CONFIG.maxMs);
  });

  it("nunca viola o teto de taxa, mesmo que o sorteio tente", () => {
    const configApertada: JitterConfig = { ...CONFIG, minMs: 10, maxMs: 50, taxaMaximaPorMinuto: 60 };
    // Com 60 msgs/min, o intervalo mínimo real é 1000ms — mesmo pedindo um
    // jitter de 10-50ms, o resultado nunca pode ficar abaixo de 1000ms.
    const atraso = calcularAtrasoComTeto(configApertada, rngFixo(0));
    expect(atraso).toBeGreaterThanOrEqual(1_000);
  });

  it("é determinístico para o mesmo rng", () => {
    const a = calcularAtrasoComTeto(CONFIG, rngFixo(0.5));
    const b = calcularAtrasoComTeto(CONFIG, rngFixo(0.5));
    expect(a).toBe(b);
  });
});

describe("planejarLotes", () => {
  it("agenda o primeiro envio exatamente no instante de início", () => {
    const inicio = new Date("2026-03-15T10:00:00.000Z");
    const plano = planejarLotes({ recipientIds: ["a", "b", "c"], config: CONFIG, inicioEm: inicio, rng: rngFixo(0.5) });
    expect(plano[0].agendadoPara).toBe(inicio.toISOString());
    expect(plano[0].jitterMsAplicado).toBe(0);
  });

  it("nunca agenda dois destinatários no mesmo instante dentro de um lote", () => {
    const plano = planejarLotes({
      recipientIds: ["a", "b", "c"],
      config: CONFIG,
      inicioEm: new Date("2026-03-15T10:00:00.000Z"),
      rng: rngFixo(0.3),
    });
    const instantes = plano.map((p) => new Date(p.agendadoPara).getTime());
    expect(new Set(instantes).size).toBe(instantes.length);
    // Estritamente crescente.
    for (let i = 1; i < instantes.length; i += 1) {
      expect(instantes[i]).toBeGreaterThan(instantes[i - 1]);
    }
  });

  it("aplica a pausa entre lotes ao cruzar a fronteira do tamanho do lote", () => {
    const configLotePequeno: JitterConfig = { ...CONFIG, loteSize: 2, pausaEntreLotesMs: 60_000 };
    const plano = planejarLotes({
      recipientIds: ["a", "b", "c", "d"],
      config: configLotePequeno,
      inicioEm: new Date("2026-03-15T10:00:00.000Z"),
      rng: rngFixo(0.5),
    });

    // Índice 2 é o primeiro do segundo lote — deve ter recebido a pausa de lote.
    expect(plano[2].jitterMsAplicado).toBe(60_000);
    expect(plano[2].loteIndice).toBe(1);
    expect(plano[0].loteIndice).toBe(0);
    expect(plano[1].loteIndice).toBe(0);
  });

  it("distribui todos os destinatários, preservando a identidade de cada um", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const plano = planejarLotes({ recipientIds: ids, config: CONFIG, rng: rngFixo(0.4) });
    expect(plano.map((p) => p.recipientId)).toEqual(ids);
  });

  it("devolve lista vazia para zero destinatários, sem lançar", () => {
    expect(planejarLotes({ recipientIds: [], config: CONFIG })).toEqual([]);
  });

  it("é determinístico dado o mesmo rng e o mesmo início", () => {
    const opcoes = { recipientIds: ["a", "b", "c"], config: CONFIG, inicioEm: new Date("2026-01-01T00:00:00.000Z"), rng: rngFixo(0.7) };
    expect(planejarLotes(opcoes)).toEqual(planejarLotes({ ...opcoes }));
  });
});

describe("hashDestino", () => {
  it("é determinístico para o mesmo destino e workspace", async () => {
    const a = await hashDestino("+5511999990000", "ws-1");
    const b = await hashDestino("+5511999990000", "ws-1");
    expect(a).toBe(b);
  });

  it("produz hashes diferentes para workspaces diferentes", async () => {
    const a = await hashDestino("+5511999990000", "ws-1");
    const b = await hashDestino("+5511999990000", "ws-2");
    expect(a).not.toBe(b);
  });

  it("normaliza caixa e espaços antes de gerar o hash", async () => {
    const a = await hashDestino("cliente@exemplo.com", "ws-1");
    const b = await hashDestino("  CLIENTE@EXEMPLO.COM  ", "ws-1");
    expect(a).toBe(b);
  });
});

describe("verificarConformidade", () => {
  const optOuts: Pick<OptOutEntry, "destinoHash">[] = [{ destinoHash: "hash-bloqueado" }];

  it("bloqueia destino em opt-out", () => {
    const resultado = verificarConformidade("hash-bloqueado", optOuts);
    expect(resultado.permitido).toBe(false);
    expect(resultado.motivo).toMatch(/opt-out/);
  });

  it("permite destino fora do opt-out", () => {
    const resultado = verificarConformidade("hash-livre", optOuts);
    expect(resultado.permitido).toBe(true);
  });

  it("bloqueia hash vazio", () => {
    expect(verificarConformidade("", optOuts).permitido).toBe(false);
  });
});

describe("processarEnviosDevidos", () => {
  it("envia apenas destinatários cujo horário já venceu", async () => {
    const agora = new Date("2026-03-15T10:00:00.000Z");
    const destinatarios = [
      destinatario({ id: "venceu", agendadoPara: new Date(agora.getTime() - 1000).toISOString() }),
      destinatario({ id: "nao-venceu", agendadoPara: new Date(agora.getTime() + 60_000).toISOString() }),
    ];

    const enviados: string[] = [];
    const resultado = await processarEnviosDevidos({
      campanha: { mensagemTemplate: "Olá!", workspaceId: "ws-1" },
      destinatarios,
      optOuts: [],
      enviar: async (r) => {
        enviados.push(r.id);
        return true;
      },
      agora,
    });

    expect(enviados).toEqual(["venceu"]);
    expect(resultado.enviadosNestaExecucao).toBe(1);
    expect(resultado.destinatariosAtualizados.find((d) => d.id === "nao-venceu")?.status).toBe("pendente");
    expect(resultado.destinatariosAtualizados.find((d) => d.id === "venceu")?.status).toBe("enviado");
  });

  it("bloqueia por opt-out sem chamar o executor de envio", async () => {
    const agora = new Date("2026-03-15T10:00:00.000Z");
    const destinatarios = [
      destinatario({ id: "bloqueado", destinoHash: "hash-optout", agendadoPara: agora.toISOString() }),
    ];

    let chamouEnvio = false;
    const resultado = await processarEnviosDevidos({
      campanha: { mensagemTemplate: "Olá!", workspaceId: "ws-1" },
      destinatarios,
      optOuts: [{ destinoHash: "hash-optout" }],
      enviar: async () => {
        chamouEnvio = true;
        return true;
      },
      agora,
    });

    expect(chamouEnvio).toBe(false);
    expect(resultado.bloqueadosNestaExecucao).toBe(1);
    expect(resultado.destinatariosAtualizados[0].status).toBe("bloqueado-conformidade");
  });

  it("marca como falha quando o executor devolve false", async () => {
    const agora = new Date("2026-03-15T10:00:00.000Z");
    const destinatarios = [destinatario({ agendadoPara: agora.toISOString() })];

    const resultado = await processarEnviosDevidos({
      campanha: { mensagemTemplate: "Olá!", workspaceId: "ws-1" },
      destinatarios,
      optOuts: [],
      enviar: async () => false,
      agora,
    });

    expect(resultado.falhasNestaExecucao).toBe(1);
    expect(resultado.destinatariosAtualizados[0].status).toBe("falhou");
  });

  it("marca como falha quando o executor lança, sem propagar a exceção", async () => {
    const agora = new Date("2026-03-15T10:00:00.000Z");
    const destinatarios = [destinatario({ agendadoPara: agora.toISOString() })];

    const resultado = await processarEnviosDevidos({
      campanha: { mensagemTemplate: "Olá!", workspaceId: "ws-1" },
      destinatarios,
      optOuts: [],
      enviar: async () => {
        throw new Error("falha de rede simulada");
      },
      agora,
    });

    expect(resultado.falhasNestaExecucao).toBe(1);
    expect(resultado.destinatariosAtualizados[0].status).toBe("falhou");
    expect(resultado.destinatariosAtualizados[0].motivoBloqueio).toContain("falha de rede simulada");
  });

  it("ignora destinatários que não estão mais pendentes", async () => {
    const agora = new Date("2026-03-15T10:00:00.000Z");
    const destinatarios = [destinatario({ status: "enviado", agendadoPara: agora.toISOString() })];

    const resultado = await processarEnviosDevidos({
      campanha: { mensagemTemplate: "Olá!", workspaceId: "ws-1" },
      destinatarios,
      optOuts: [],
      enviar: async () => true,
      agora,
    });

    expect(resultado.processadosNestaExecucao).toBe(0);
  });
});
