import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Espelha o path mapping de tsconfig.json para que os testes importem
      // exatamente os mesmos módulos que a aplicação.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // `node` é suficiente: tudo que é testado aqui é lógica pura ou Web Crypto,
    // disponível no Node 18+. Nenhum teste depende de DOM.
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // 5s (padrão) é instável na suíte completa: vários testes fazem
    // `await import(...)` dinâmico dentro do `it()`, e a transformação a frio
    // do módulo (TS -> JS) na primeira chamada, sob a carga de ~90 arquivos
    // rodando em paralelo, pode ultrapassar 5s mesmo sem nenhum hang real —
    // já causou falso-negativo intermitente em resolverConectorPorPageId
    // (meta) e resolverConectorPorNumeroTwilio (sms).
    testTimeout: 20000,
  },
});
