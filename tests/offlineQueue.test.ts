import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assinarOperacoesPendentes,
  enfileirarEscrita,
  limparOperacoesPendentes,
  type OperacaoPendente,
} from "@/lib/offlineQueue";

function adiavel<T>(valor: T): { promise: Promise<T>; resolver: () => void } {
  let resolver!: () => void;
  const promise = new Promise<T>((resolve) => {
    resolver = () => resolve(valor);
  });
  return { promise, resolver };
}

describe("enfileirarEscrita", () => {
  beforeEach(() => {
    limparOperacoesPendentes();
  });

  it("registra a operação como pendente imediatamente e a remove quando resolve", async () => {
    const { promise, resolver } = adiavel("ok");
    const capturas: OperacaoPendente[][] = [];
    const cancelar = assinarOperacoesPendentes((lista) => capturas.push(lista));

    const resultado = enfileirarEscrita("Criar fluxo", () => promise);
    expect(capturas.at(-1)).toHaveLength(1);
    expect(capturas.at(-1)?.[0].descricao).toBe("Criar fluxo");

    resolver();
    await resultado;
    // microtask extra para o `.then(remover)` interno rodar antes de checar.
    await Promise.resolve();
    await Promise.resolve();

    expect(capturas.at(-1)).toHaveLength(0);
    cancelar();
  });

  it("devolve a MESMA Promise de `fn` — resolve com o valor e permite await normal", async () => {
    const valor = await enfileirarEscrita("Op", async () => 42);
    expect(valor).toBe(42);
  });

  it("uma falha genuína reporta o erro e remove da lista pendente, sem travar para sempre", async () => {
    const erro = new Error("permissão negada");
    await expect(enfileirarEscrita("Criar conector", () => Promise.reject(erro))).rejects.toThrow(
      "permissão negada"
    );

    await Promise.resolve();
    await Promise.resolve();

    let pendentesAtuais: OperacaoPendente[] = [];
    const cancelar = assinarOperacoesPendentes((lista) => {
      pendentesAtuais = lista;
    });
    cancelar();
    expect(pendentesAtuais).toHaveLength(0);
  });

  it("várias operações concorrentes aparecem todas na lista até resolverem", async () => {
    const a = adiavel("a");
    const b = adiavel("b");

    const pA = enfileirarEscrita("Operação A", () => a.promise);
    const pB = enfileirarEscrita("Operação B", () => b.promise);

    let pendentesAtuais: OperacaoPendente[] = [];
    const cancelar = assinarOperacoesPendentes((lista) => {
      pendentesAtuais = lista;
    });
    expect(pendentesAtuais.map((p) => p.descricao).sort()).toEqual(["Operação A", "Operação B"]);

    a.resolver();
    b.resolver();
    await Promise.all([pA, pB]);
    await Promise.resolve();
    await Promise.resolve();

    expect(pendentesAtuais).toHaveLength(0);
    cancelar();
  });
});
