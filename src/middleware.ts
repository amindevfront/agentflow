import { NextResponse, type NextRequest } from "next/server";

// Middleware de borda — cabeçalhos de segurança de transporte, aplicados a
// TODA resposta antes de qualquer página ou rota ser renderizada (ver
// ADR-0004).
//
// Isto NÃO duplica a verificação de identidade: as rotas de API críticas já
// verificam o ID token do Firebase do lado do servidor, em Node, dentro de
// cada handler (`src/lib/server/http.ts` → `comGuarda` → `verificarIdToken`
// em `src/lib/server/auth.ts`). Esse é o lugar certo para isso — precisa do
// corpo da requisição, de limite de taxa por usuário autenticado e de erros
// de domínio específicos da rota, nenhum dos quais o middleware de borda
// deveria conhecer. Reimplementar a mesma verificação aqui, na borda, criaria
// duas fontes de verdade para a mesma decisão sem ganhar nada em troca.
//
// O que o middleware cobre é a camada de transporte que TODA resposta
// compartilha — página ou API — e que nenhuma rota individual deveria
// precisar lembrar de configurar: CSP, anti-clickjacking, MIME sniffing,
// referrer e HSTS.
//
// Deliberadamente sem `firebase-admin`/Web Crypto/Zod/DOMPurify aqui: o
// runtime de borda do Next.js não suporta as APIs de Node de que essas
// dependências precisam — qualquer import delas neste arquivo quebraria o
// build. `next/server` é a única dependência permitida neste módulo.

const CSP_PRODUCAO = process.env.NODE_ENV === "production";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // `unsafe-eval` só em desenvolvimento (Fast Refresh/HMR do Next.js
  // depende disso); `unsafe-inline` permanece em produção porque a
  // hidratação do App Router injeta scripts inline sem suporte a nonce
  // nesta versão do Next — endurecer para CSP baseada em nonce é trabalho
  // futuro que exige instrumentar cada layout, não uma mudança local a
  // este arquivo.
  `script-src 'self' 'unsafe-inline'${CSP_PRODUCAO ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com wss://*.firebaseio.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export function middleware(_request: NextRequest): NextResponse {
  const resposta = NextResponse.next();

  resposta.headers.set("content-security-policy", CONTENT_SECURITY_POLICY);
  resposta.headers.set("x-frame-options", "DENY");
  resposta.headers.set("x-content-type-options", "nosniff");
  resposta.headers.set("referrer-policy", "no-referrer");
  resposta.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  resposta.headers.set("strict-transport-security", "max-age=63072000; includeSubDomains; preload");

  return resposta;
}

export const config = {
  // Exclui assets estáticos e o service worker do PWA — cabeçalhos de
  // segurança de documento não se aplicam a eles, e processá-los aqui só
  // adiciona latência sem benefício.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|workbox-.*\\.js|manifest.json).*)"],
};
