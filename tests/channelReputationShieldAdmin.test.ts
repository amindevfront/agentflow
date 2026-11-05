import { describe, expect, it } from "vitest";
import type { Transaction } from "firebase-admin/firestore";
import type { AuditEntry, ItemFilaReputacaoCanal } from "@/types";
import { JITTER_CONFIG_PADRAO } from "@/types";
import {
  MAX_TENTATIVAS_FILA_REPUTACAO,
  _resetarDisjuntoresDeCanalParaTeste,
  decidirProximoEstadoFila,
  disjuntorDoCanal,
  executarTransacaoEnfileiramento,
  limiteVolumeCanal,
} from "@/lib/server/channelReputationShieldAdmin";

const CHAVE_HMAC = new Uint8Array(32).fill(3);

function itemFila(parcial: Partial<ItemFilaReputacaoCanal> = {}): ItemFilaReputacaoCanal {
  return {
    id: "sacq_1",
    workspaceId: "ws-1",
    canal: "whatsapp",
    destinoHash: "hash-destino-1",
    mensagem: "GRÁTIS!!! clique aqui",
    motivos: ["oferta gratuita", "chamada para ação de spam"],
    nivel: "critico",
    status: "pendente",
    tentativas: 0,
    criadoEm: "2026-03-15T12:00:00.000Z",
    ultimaTentativaEm: null,
    origemReferencia: null,
    ...parcial,
  };
}

function criarFirestoreFalso() {
  const armazenamento = new Map<string, unknown>();

  const db = {
    collection: (nomeColecao: string) => ({
      doc: (id: string) => ({ _chave: `${nomeColecao}/${id}` }),
    }),
  };

  const tx = {
    get: async (ref: { _chave: string }) => {
      const dados = armazenamento.get(ref._chave);
      return { exists: dados !== undefined, data: () => dados };
    },
    set: (ref: { _chave: string }, dados: unknown) => {
      armazenamento.set(ref._chave, dados);
    },
  } as unknown as Pick<Transaction, "get" | "set">;

  return { db, tx, armazenamento };
}

describe("limiteVolumeCanal", () => {
  it("converte o teto anti-ban das campanhas em configuração de token bucket", () => {
    const config = limiteVolumeCanal();
    expect(config.capacidade).toBe(JITTER_CONFIG_PADRAO.taxaMaximaPorMinuto);
    expect(config.taxaPorSegundo).toBeCloseTo(JITTER_CONFIG_PADRAO.taxaMaximaPorMinuto / 60);
  });
});

describe("disjuntorDoCanal", () => {
  it("devolve a mesma instância para a mesma chave workspace+canal", () => {
    _resetarDisjuntoresDeCanalParaTeste();
    const a = disjuntorDoCanal("ws-1", "whatsapp");
    const b = disjuntorDoCanal("ws-1", "whatsapp");
    expect(a).toBe(b);
  });

  it("devolve instâncias diferentes para canais ou workspaces diferentes", () => {
    _resetarDisjuntoresDeCanalParaTeste();
    const whatsapp = disjuntorDoCanal("ws-1", "whatsapp");
    const sms = disjuntorDoCanal("ws-1", "sms");
    const outroWorkspace = disjuntorDoCanal("ws-2", "whatsapp");
    expect(whatsapp).not.toBe(sms);
    expect(whatsapp).not.toBe(outroWorkspace);
  });
});

describe("decidirProximoEstadoFila", () => {
  it("marca como reenviado em caso de sucesso, independente da tentativa", () => {
    expect(decidirProximoEstadoFila(0, "enviado")).toEqual({ status: "reenviado", tentativas: 1 });
    expect(decidirProximoEstadoFila(3, "enviado")).toEqual({ status: "reenviado", tentativas: 4 });
  });

  it("permanece pendente enquanto não esgotar o teto de tentativas", () => {
    expect(decidirProximoEstadoFila(0, "contido")).toEqual({ status: "pendente", tentativas: 1 });
    expect(decidirProximoEstadoFila(MAX_TENTATIVAS_FILA_REPUTACAO - 2, "contido")).toEqual({
      status: "pendente",
      tentativas: MAX_TENTATIVAS_FILA_REPUTACAO - 1,
    });
  });

  it("descarta ao esgotar o teto de tentativas sem sucesso", () => {
    expect(decidirProximoEstadoFila(MAX_TENTATIVAS_FILA_REPUTACAO - 1, "contido")).toEqual({
      status: "descartado",
      tentativas: MAX_TENTATIVAS_FILA_REPUTACAO,
    });
  });
});

describe("executarTransacaoEnfileiramento", () => {
  it("persiste o item da fila e sela uma entrada de auditoria crítica na mesma transação", async () => {
    const { db, tx, armazenamento } = criarFirestoreFalso();
    const item = itemFila();

    const persistido = await executarTransacaoEnfileiramento(tx, db as never, {
      item,
      workspaceId: "ws-1",
      chaveHmac: CHAVE_HMAC,
    });

    expect(persistido).toEqual(item);
    expect(armazenamento.get("channelReputationQueue/sacq_1")).toEqual(item);

    const entradasAuditoria = [...armazenamento.entries()].filter(([chave]) => chave.startsWith("auditLogs/"));
    expect(entradasAuditoria).toHaveLength(1);

    const [, entrada] = entradasAuditoria[0] as [string, AuditEntry];
    expect(entrada.corpo.tipo).toBe("sacshield.canal.disparo-contido");
    expect(entrada.corpo.severidade).toBe("critica");
  });

  it("sela a entrada de auditoria como severidade alta quando o nível é apenas elevado", async () => {
    const { db, tx, armazenamento } = criarFirestoreFalso();
    const item = itemFila({ nivel: "elevado" });

    await executarTransacaoEnfileiramento(tx, db as never, { item, workspaceId: "ws-1", chaveHmac: CHAVE_HMAC });

    const [, entrada] = [...armazenamento.entries()].find(([chave]) => chave.startsWith("auditLogs/")) as [
      string,
      AuditEntry,
    ];
    expect(entrada.corpo.severidade).toBe("alta");
  });
});
