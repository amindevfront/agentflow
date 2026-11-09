import type { NextConfig } from "next";
// next-pwa não possui tipos oficiais para TypeScript
// @ts-expect-error - next-pwa não possui tipagens
import withPWAInit from "next-pwa";

// Configuração do next-pwa: gera o service worker apenas em produção,
// evitando cache indesejado durante o desenvolvimento (npm run dev).
//
// skipWaiting sozinho não bastava: ele faz o novo Service Worker ativar
// sem esperar, mas sem clientsClaim o SW novo só assume o controle de
// abas JÁ ABERTAS na próxima navegação — até lá, o celular continua
// sendo servido pelo JS antigo em cache, mesmo depois de um deploy com
// correção. clientsClaim faz o SW novo assumir o controle imediatamente.
const withPWA = withPWAInit({
  dest: "public",
  register: true,
  skipWaiting: true,
  clientsClaim: true,
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default withPWA(nextConfig);
