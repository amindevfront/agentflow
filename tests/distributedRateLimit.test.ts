import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "firebase-admin/firestore";
import {
  calcularProximoBalde,
  consumirLimiteDistribuido,
  executarTransacaoDeBalde,
} from "@/lib/server/distributedRateLimit";
import { limparLimites } from "@/lib/server/rateLimit";
import { resetarAdminParaTeste } from "@/lib/server/firebaseAdmin";

const CONFIG = { capacidade: 3, taxaPorSegundo: 1 };

describe("calcularProximoBalde (matemática pura do token bucket)", () => {
  it("começa com o balde cheio e consome um token", () => {
    const { tokens, resultado } = calcularProximoBalde(null, 0, CONFIG);
    expect(resultado.permitido).toBe(true);
    expect(tokens).toBe(CONFIG.capacidade - 1);
  });

  it("nega quando os tokens se esgotam", () => {
    let estado: { tokens: number; ultimoAbastecimentoMs: number } | null = null;
    let ultimoResultado;
    for (let i = 0; i < CONFIG.capacidade; i += 1) {
      const passo = calcularProximoBalde(estado, 0, CONFIG);
      estado = { tokens: passo.tokens, ultimoAbastecimentoMs: passo.ultimoAbastecimentoMs };
      ultimoResultado = passo.resultado;
    }
    expect(ultimoResultado?.permitido).toBe(true); // consumiu exatamente a capacidade

    const excedente = calcularProximoBalde(estado, 0, CONFIG);
    expect(excedente.resultado.permitido).toBe(false);
    expect(excedente.resultado.tentarEmSegundos).toBeGreaterThan(0);
  });

  it("reabastece proporcionalmente ao tempo decorrido", () => {
    const esgotado = { tokens: 0, ultimoAbastecimentoMs: 0 };
    // 2 segundos depois, a 1 token/s, deveriam existir ~2 tokens — suficiente
    // para permitir novamente, mesmo começando em zero.
    const depois = calcularProximoBalde(esgotado, 2000, CONFIG);
    expect(depois.resultado.permitido).toBe(true);
  });

  it("nunca excede a capacidade do balde mesmo após longa inatividade", () => {
    const antigo = { tokens: 1, ultimoAbastecimentoMs: 0 };
    const multoDepois = calcularProximoBalde(antigo, 1_000_000, CONFIG);
    // tokens pós-consumo não pode superar capacidade - 1.
    expect(multoDepois.tokens).toBeLessThanOrEqual(CONFIG.capacidade - 1);
  });
});

describe("executarTransacaoDeBalde (corpo da transação, com Firestore falso)", () => {
  function criarFirestoreFalso() {
    const documentos = new Map<string, unknown>();
    const ref = { _id: "balde-teste" };
    // O tipo real de `Transaction.get` é sobrecarregado (também aceita
    // `Query`), o que nenhum dublê de teste satisfaz estruturalmente — o
    // cast é para a forma reduzida que `executarTransacaoDeBalde` de fato usa.
    const tx = {
      get: async (_refAlvo: typeof ref) => {
        const dados = documentos.get("balde-teste");
        return {
          exists: dados !== undefined,
          data: () => dados,
        };
      },
      set: (_refAlvo: typeof ref, dados: unknown) => {
        documentos.set("balde-teste", dados);
      },
    } as unknown as Pick<Transaction, "get" | "set">;
    return { ref, tx, documentos };
  }

  it("persiste o estado do balde entre chamadas consecutivas", async () => {
    const { ref, tx } = criarFirestoreFalso();

    const primeira = await executarTransacaoDeBalde(tx, ref as never, 0, CONFIG);
    expect(primeira.permitido).toBe(true);
    expect(primeira.restantes).toBe(CONFIG.capacidade - 1);

    const segunda = await executarTransacaoDeBalde(tx, ref as never, 0, CONFIG);
    expect(segunda.permitido).toBe(true);
    expect(segunda.restantes).toBe(CONFIG.capacidade - 2);
  });

  it("nega quando a capacidade do documento compartilhado se esgota", async () => {
    // Representa o que duas réplicas de servidor acabam enxergando: o MESMO
    // documento, lido e escrito em sequência (é a transação do Firestore, não
    // esta função, que serializa o acesso concorrente de verdade — ver
    // `consumirLimiteDistribuido`, que delega a `runTransaction`).
    const { ref, tx } = criarFirestoreFalso();
    for (let i = 0; i < CONFIG.capacidade; i += 1) {
      await executarTransacaoDeBalde(tx, ref as never, 0, CONFIG);
    }
    const excedente = await executarTransacaoDeBalde(tx, ref as never, 0, CONFIG);
    expect(excedente.permitido).toBe(false);
  });
});

describe("consumirLimiteDistribuido (fallback gracioso)", () => {
  const chaveOriginal = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  beforeEach(() => {
    limparLimites();
    resetarAdminParaTeste();
    // Credencial deliberadamente inválida: força o Admin SDK a falhar ao
    // inicializar, exercitando o caminho de fallback sem precisar de rede.
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = "{ isso não é json válido";
  });

  afterEach(() => {
    if (chaveOriginal === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = chaveOriginal;
    resetarAdminParaTeste();
    vi.restoreAllMocks();
  });

  it("cai para o limitador em memória quando o Admin SDK não inicializa, sem lançar", async () => {
    const avisoEspiao = vi.spyOn(console, "warn").mockImplementation(() => {});

    const resultado = await consumirLimiteDistribuido("teste:fallback", CONFIG);

    expect(resultado.permitido).toBe(true);
    expect(avisoEspiao).toHaveBeenCalledOnce();
    expect(String(avisoEspiao.mock.calls[0][0])).toContain("usando limite em memória");
  });

  it("ainda assim aplica o limite corretamente pelo caminho de fallback", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    for (let i = 0; i < CONFIG.capacidade; i += 1) {
      const r = await consumirLimiteDistribuido("teste:fallback-exaustao", CONFIG);
      expect(r.permitido).toBe(true);
    }
    const excedente = await consumirLimiteDistribuido("teste:fallback-exaustao", CONFIG);
    expect(excedente.permitido).toBe(false);
  });
});
