// Serialização canônica de JSON.
//
// Necessária para que um hash de conteúdo seja reproduzível: `JSON.stringify`
// preserva a ordem de inserção das chaves, então dois objetos semanticamente
// idênticos podem gerar bytes diferentes e, com isso, hashes diferentes. Sem
// canonicalização, a verificação da trilha de auditoria falharia por motivo
// errado — ordem de chaves, não adulteração.
//
// Regras aplicadas:
//  - chaves de objeto ordenadas lexicograficamente por code unit;
//  - `undefined` em propriedade de objeto é omitido; em array, vira `null`
//    (mesma semântica de `JSON.stringify`, mas explícita);
//  - `NaN` e `Infinity` são rejeitados, pois não têm representação em JSON;
//  - ciclos são rejeitados com erro claro em vez de estourar a pilha.

export function jsonCanonico(valor: unknown): string {
  const emProcesso = new WeakSet<object>();

  function serializar(entrada: unknown, caminho: string): string {
    if (entrada === null) return "null";

    const tipo = typeof entrada;

    if (tipo === "number") {
      if (!Number.isFinite(entrada as number)) {
        throw new Error(`Número não representável em JSON em "${caminho}": ${String(entrada)}`);
      }
      return JSON.stringify(entrada);
    }

    if (tipo === "boolean" || tipo === "string") {
      return JSON.stringify(entrada);
    }

    if (tipo === "bigint") {
      throw new Error(`BigInt não é serializável em JSON em "${caminho}".`);
    }

    if (tipo === "undefined" || tipo === "function" || tipo === "symbol") {
      throw new Error(`Valor não serializável em "${caminho}" (${tipo}).`);
    }

    const objeto = entrada as object;
    if (emProcesso.has(objeto)) {
      throw new Error(`Referência circular detectada em "${caminho}".`);
    }
    emProcesso.add(objeto);

    try {
      if (Array.isArray(entrada)) {
        const itens = entrada.map((item, indice) =>
          item === undefined ? "null" : serializar(item, `${caminho}[${indice}]`)
        );
        return `[${itens.join(",")}]`;
      }

      if (entrada instanceof Date) {
        return JSON.stringify(entrada.toISOString());
      }

      const registro = entrada as Record<string, unknown>;
      const chaves = Object.keys(registro).sort();
      const pares: string[] = [];

      for (const chave of chaves) {
        const item = registro[chave];
        if (item === undefined) continue;
        pares.push(`${JSON.stringify(chave)}:${serializar(item, `${caminho}.${chave}`)}`);
      }

      return `{${pares.join(",")}}`;
    } finally {
      emProcesso.delete(objeto);
    }
  }

  return serializar(valor, "$");
}
