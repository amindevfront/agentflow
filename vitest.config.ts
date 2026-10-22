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
  },
});
