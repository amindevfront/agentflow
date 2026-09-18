import type { NextConfig } from "next";
// next-pwa não possui tipos oficiais para TypeScript
// @ts-expect-error - next-pwa não possui tipagens
import withPWAInit from "next-pwa";

// Configuração do next-pwa: gera o service worker apenas em produção,
// evitando cache indesejado durante o desenvolvimento (npm run dev)
const withPWA = withPWAInit({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default withPWA(nextConfig);
