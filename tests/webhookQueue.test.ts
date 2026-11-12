import { describe, expect, it } from "vitest";
import type { Transaction } from "firebase-admin/firestore";
import type { ConnectHubDelivery } from "@/types";
import {
  MAX_TENTATIVAS_CONNECT_HUB,
  calcularBackoffMs,
  decidirProximoEstadoEntrega,
  executarTransacaoRegistroEntrega,
  ipEstaEmRedeBloqueada,
} from "@/lib/server/connectors/webhookQueue";
import { montarPayloadConnectHub } from "@/lib/server/connectors/webhookDispatcher";
import { verificarCadeiaAuditoria } from "@/lib/crypto/auditChain";

const CHAVE_HMAC = new Uint8Array(32).fill(7);

function delivery(parcial: Partial<ConnectHubDelivery> = {}): ConnectHubDelivery {
  return {
    id: "cnct_1",
    workspaceId: "ws-1",
    webhookUrl: "https://cliente.exemplo.com/webhook",
    payload: montarPayloadConnectHub({
      evento: "handoff.sucesso",
      workspaceId: "ws-1",
      dados: { ticketId: "hitl_1" },
      agora: new Date("2026-03-15T12:00:00.000Z"),
    }),
    assinatura: "",
    status: "pendente",
    tentativas: 0,
    criadoEm: "2026-03-15T12:00:00.000Z",
    ultimaTentativaEm: null,
    ...parcial,
  };
}

describe("calcularBackoffMs (Resiliência de Fila — backoff exponencial)", () => {
  it("cresce exponencialmente a partir da base", () => {
    const t0 = calcularBackoffMs(0);
    const t1 = calcularBackoffMs(1);
    const t2 = calcularBackoffMs(2);

    expect(t1).toBe(t0 * 2);
    expect(t2).toBe(t0 * 4);
  });

  it("nunca excede o teto, mesmo com muitas tentativas", () => {
    const t10 = calcularBackoffMs(10);
    const t20 = calcularBackoffMs(20);

    expect(t10).toBe(t20);
    expect(t10).toBeLessThanOrEqual(30 * 60_000);
  });
});

describe("decidirProximoEstadoEntrega", () => {
  const AGORA = new Date("2026-03-15T12:00:00.000Z");

  it("marca como 'entregue' quando a tentativa teve sucesso", () => {
    const proximo = decidirProximoEstadoEntrega(2, true, AGORA);
    expect(proximo.status).toBe("entregue");
    expect(proximo.tentativas).toBe(3);
    expect(proximo.proximaTentativaEm).toBeNull();
  });

  it("marca como 'falhou' com backoff agendado quando ainda há tentativas disponíveis", () => {
    const proximo = decidirProximoEstadoEntrega(0, false, AGORA);
    expect(proximo.status).toBe("falhou");
    expect(proximo.tentativas).toBe(1);
    expect(proximo.proximaTentativaEm).not.toBeNull();
    expect(new Date(proximo.proximaTentativaEm!).getTime()).toBeGreaterThan(AGORA.getTime());
  });

  it("marca como 'descartado' ao esgotar MAX_TENTATIVAS_CONNECT_HUB sem sucesso", () => {
    const proximo = decidirProximoEstadoEntrega(MAX_TENTATIVAS_CONNECT_HUB - 1, false, AGORA);
    expect(proximo.status).toBe("descartado");
    expect(proximo.tentativas).toBe(MAX_TENTATIVAS_CONNECT_HUB);
    expect(proximo.proximaTentativaEm).toBeNull();
  });

  it("nunca descarta antes de esgotar as tentativas", () => {
    for (let tentativas = 0; tentativas < MAX_TENTATIVAS_CONNECT_HUB - 1; tentativas += 1) {
      const proximo = decidirProximoEstadoEntrega(tentativas, false, AGORA);
      expect(proximo.status).toBe("falhou");
    }
  });
});

/**
 * Firestore falso mínimo — mesmo padrão de `tests/auditChainStore.test.ts`:
 * só o que `executarTransacaoRegistroEntrega` de fato usa.
 */
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

describe("executarTransacaoRegistroEntrega (Resiliência de Fila — persistência + auditoria)", () => {
  it("persiste a entrega e sela uma entrada de auditoria na mesma transação", async () => {
    const { db, tx, armazenamento } = criarFirestoreFalso();
    const item = delivery({ status: "entregue", tentativas: 1 });

    const resultado = await executarTransacaoRegistroEntrega(tx, db as never, {
      delivery: item,
      sucesso: true,
      chaveHmac: CHAVE_HMAC,
    });

    expect(resultado).toEqual(item);
    expect(armazenamento.get(`connectHubDeliveries/${item.id}`)).toEqual(item);
    // Uma entrada de auditoria foi selada — ver ponteiro dedicado.
    expect(armazenamento.has(`auditChainHead/${item.workspaceId}`)).toBe(true);
  });

  it("nunca vaza o payload mascarado em claro na entrada de auditoria (detalhes só carrega metadados)", async () => {
    const { db, tx, armazenamento } = criarFirestoreFalso();
    const item = delivery({ status: "falhou", tentativas: 1 });

    await executarTransacaoRegistroEntrega(tx, db as never, { delivery: item, sucesso: false, chaveHmac: CHAVE_HMAC });

    const entradaAuditoria = [...armazenamento.entries()].find(([chave]) => chave.startsWith("auditLogs/"));
    expect(entradaAuditoria).toBeDefined();
    const corpo = (entradaAuditoria![1] as { corpo: { detalhes: Record<string, unknown> } }).corpo;
    expect(corpo.detalhes).toEqual({ evento: "handoff.sucesso", status: "falhou", tentativas: 1 });
  });

  it("a cadeia resultante verifica íntegra", async () => {
    const { db, tx, armazenamento } = criarFirestoreFalso();
    const primeira = delivery({ id: "cnct_1", status: "falhou", tentativas: 1 });
    const segunda = delivery({ id: "cnct_2", status: "entregue", tentativas: 2 });

    await executarTransacaoRegistroEntrega(tx, db as never, { delivery: primeira, sucesso: false, chaveHmac: CHAVE_HMAC });
    await executarTransacaoRegistroEntrega(tx, db as never, { delivery: segunda, sucesso: true, chaveHmac: CHAVE_HMAC });

    const entradas = [...armazenamento.entries()]
      .filter(([chave]) => chave.startsWith("auditLogs/"))
      .map(([, valor]) => valor as import("@/types").AuditEntry);

    const verificacao = await verificarCadeiaAuditoria(entradas, CHAVE_HMAC);
    expect(verificacao.integra).toBe(true);
  });
});

describe("ipEstaEmRedeBloqueada (Connect Hub — blindagem contra SSRF/DNS rebinding)", () => {
  it("bloqueia loopback, redes privadas RFC 1918 e o metadado de nuvem (IPv4)", () => {
    expect(ipEstaEmRedeBloqueada("127.0.0.1", 4)).toBe(true);
    expect(ipEstaEmRedeBloqueada("10.0.0.5", 4)).toBe(true);
    expect(ipEstaEmRedeBloqueada("172.16.0.1", 4)).toBe(true);
    expect(ipEstaEmRedeBloqueada("172.31.255.254", 4)).toBe(true);
    expect(ipEstaEmRedeBloqueada("192.168.1.1", 4)).toBe(true);
    expect(ipEstaEmRedeBloqueada("169.254.169.254", 4)).toBe(true); // metadado AWS/GCP/Azure
    expect(ipEstaEmRedeBloqueada("0.0.0.0", 4)).toBe(true);
  });

  it("permite IPs públicos legítimos (IPv4)", () => {
    expect(ipEstaEmRedeBloqueada("8.8.8.8", 4)).toBe(false);
    expect(ipEstaEmRedeBloqueada("172.15.255.255", 4)).toBe(false); // fora do range 172.16-31
    expect(ipEstaEmRedeBloqueada("172.32.0.1", 4)).toBe(false); // fora do range 172.16-31
  });

  it("bloqueia loopback, unique-local e link-local (IPv6)", () => {
    expect(ipEstaEmRedeBloqueada("::1", 6)).toBe(true);
    expect(ipEstaEmRedeBloqueada("fe80::1", 6)).toBe(true);
    expect(ipEstaEmRedeBloqueada("fc00::1", 6)).toBe(true);
    expect(ipEstaEmRedeBloqueada("fd12:3456::1", 6)).toBe(true);
  });

  it("permite IPv6 público legítimo", () => {
    expect(ipEstaEmRedeBloqueada("2606:4700:4700::1111", 6)).toBe(false);
  });
});
