// Verificação de Firebase ID token no servidor — base do Zero-Trust.
//
// SERVER-ONLY.
//
// Implementada sobre Web Crypto e o JWKS público do Google, sem o Firebase
// Admin SDK. Isso é deliberado: o Admin SDK exige uma chave de conta de serviço
// com poder total sobre o projeto, e este servidor não precisa desse poder — ele
// apenas confirma "quem é o chamador". Menos privilégio, menos superfície.
//
// O token é validado integralmente: assinatura RS256, emissor, público,
// validade temporal e presença de `sub`. Nenhum campo é aceito por confiança.

import { assertServidor, projetoFirebase } from "./env";
import { base64UrlParaBytes, bytesParaTexto, textoParaBytes } from "@/lib/crypto/encoding";

const URL_JWKS = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

/** Tolerância para dessincronia de relógio entre servidores, em segundos. */
const TOLERANCIA_RELOGIO_S = 60;

interface ChavePublicaJwk {
  kid: string;
  n: string;
  e: string;
  alg?: string;
  kty?: string;
}

interface CacheJwks {
  chaves: Map<string, CryptoKey>;
  expiraEm: number;
}

let cache: CacheJwks | null = null;
let buscaEmAndamento: Promise<CacheJwks> | null = null;

function subtle(): SubtleCrypto {
  const disponivel = globalThis.crypto?.subtle;
  if (!disponivel) {
    throw new Error("Web Crypto indisponível: a verificação de ID token exige o runtime Node.");
  }
  return disponivel;
}

/** Lê `max-age` do Cache-Control; cai para 1 hora quando ausente. */
function janelaDeCache(resposta: Response): number {
  const cabecalho = resposta.headers.get("cache-control") ?? "";
  const encontrado = /max-age=(\d+)/.exec(cabecalho);
  const segundos = encontrado ? Number(encontrado[1]) : 3600;
  // Mínimo de 5 min evita refetch a cada requisição se o header vier zerado.
  return Math.max(300, Math.min(segundos, 86_400)) * 1000;
}

async function carregarJwks(): Promise<CacheJwks> {
  const resposta = await fetch(URL_JWKS, { cache: "no-store" });
  if (!resposta.ok) {
    throw new Error(`Não foi possível obter as chaves públicas do Google (HTTP ${resposta.status}).`);
  }

  const corpo = (await resposta.json()) as { keys?: ChavePublicaJwk[] };
  if (!Array.isArray(corpo.keys) || corpo.keys.length === 0) {
    throw new Error("JWKS do Google retornou vazio.");
  }

  const chaves = new Map<string, CryptoKey>();
  for (const jwk of corpo.keys) {
    if (!jwk.kid || !jwk.n || !jwk.e) continue;
    try {
      const chave = await subtle().importKey(
        "jwk",
        { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      );
      chaves.set(jwk.kid, chave);
    } catch {
      // Uma chave malformada no conjunto não invalida as demais.
      continue;
    }
  }

  if (chaves.size === 0) {
    throw new Error("Nenhuma chave pública utilizável no JWKS do Google.");
  }

  return { chaves, expiraEm: Date.now() + janelaDeCache(resposta) };
}

/**
 * Obtém o JWKS com cache em memória.
 *
 * Chamadas concorrentes compartilham a mesma promessa: sob carga, uma expiração
 * de cache geraria uma rajada de requisições idênticas ao Google.
 */
async function obterChaves(forcarAtualizacao = false): Promise<CacheJwks> {
  if (!forcarAtualizacao && cache && cache.expiraEm > Date.now()) return cache;
  if (buscaEmAndamento) return buscaEmAndamento;

  buscaEmAndamento = carregarJwks()
    .then((novo) => {
      cache = novo;
      return novo;
    })
    .finally(() => {
      buscaEmAndamento = null;
    });

  return buscaEmAndamento;
}

export interface UsuarioAutenticado {
  uid: string;
  email: string | null;
  emailVerificado: boolean;
  /** Claims customizadas, quando configuradas no projeto. */
  claims: Record<string, unknown>;
}

export class ErroAutenticacao extends Error {
  readonly status = 401;
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroAutenticacao";
  }
}

interface PayloadToken {
  iss?: string;
  aud?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  auth_time?: number;
  email?: string;
  email_verified?: boolean;
  [chave: string]: unknown;
}

function decodificarSegmento(segmento: string): unknown {
  try {
    return JSON.parse(bytesParaTexto(base64UrlParaBytes(segmento)));
  } catch {
    throw new ErroAutenticacao("Token malformado: segmento não é JSON base64url válido.");
  }
}

/**
 * Verifica um Firebase ID token e devolve a identidade do chamador.
 *
 * Em caso de `kid` desconhecido, o JWKS é recarregado uma única vez antes de
 * rejeitar: o Google rotaciona as chaves de assinatura periodicamente, e um
 * token legítimo emitido com a chave nova não deve falhar só porque o cache
 * local está velho.
 */
export async function verificarIdToken(token: string): Promise<UsuarioAutenticado> {
  assertServidor();

  if (typeof token !== "string" || token.length === 0) {
    throw new ErroAutenticacao("Token ausente.");
  }
  // Teto de tamanho: evita gastar CPU com entrada absurda antes de validar.
  if (token.length > 8192) {
    throw new ErroAutenticacao("Token excede o tamanho máximo aceitável.");
  }

  const partes = token.split(".");
  if (partes.length !== 3) {
    throw new ErroAutenticacao("Token malformado: esperados três segmentos JWT.");
  }

  const [cabecalhoB64, payloadB64, assinaturaB64] = partes;
  const cabecalho = decodificarSegmento(cabecalhoB64) as { alg?: string; kid?: string };

  if (cabecalho.alg !== "RS256") {
    // Rejeitar explicitamente evita o ataque clássico de confusão de algoritmo
    // (`alg: none` ou HS256 assinado com a própria chave pública).
    throw new ErroAutenticacao(`Algoritmo de assinatura não aceito: ${cabecalho.alg ?? "ausente"}.`);
  }
  if (!cabecalho.kid) {
    throw new ErroAutenticacao("Token sem identificador de chave (kid).");
  }

  const dadosAssinados = textoParaBytes(`${cabecalhoB64}.${payloadB64}`);
  const assinatura = base64UrlParaBytes(assinaturaB64);

  let conjunto = await obterChaves();
  let chave = conjunto.chaves.get(cabecalho.kid);
  if (!chave) {
    conjunto = await obterChaves(true);
    chave = conjunto.chaves.get(cabecalho.kid);
  }
  if (!chave) {
    throw new ErroAutenticacao("Chave de assinatura do token não reconhecida.");
  }

  const valida = await subtle().verify(
    "RSASSA-PKCS1-v1_5",
    chave,
    assinatura as BufferSource,
    dadosAssinados as BufferSource
  );
  if (!valida) {
    throw new ErroAutenticacao("Assinatura do token inválida.");
  }

  const payload = decodificarSegmento(payloadB64) as PayloadToken;
  const projeto = projetoFirebase();
  const agoraS = Math.floor(Date.now() / 1000);

  if (payload.aud !== projeto) {
    throw new ErroAutenticacao("Token emitido para outro projeto.");
  }
  if (payload.iss !== `https://securetoken.google.com/${projeto}`) {
    throw new ErroAutenticacao("Emissor do token inválido.");
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0 || payload.sub.length > 128) {
    throw new ErroAutenticacao("Token sem sujeito (uid) válido.");
  }
  if (typeof payload.exp !== "number" || payload.exp + TOLERANCIA_RELOGIO_S < agoraS) {
    throw new ErroAutenticacao("Token expirado.");
  }
  if (typeof payload.iat !== "number" || payload.iat - TOLERANCIA_RELOGIO_S > agoraS) {
    throw new ErroAutenticacao("Token emitido no futuro.");
  }
  if (typeof payload.auth_time === "number" && payload.auth_time - TOLERANCIA_RELOGIO_S > agoraS) {
    throw new ErroAutenticacao("Horário de autenticação no futuro.");
  }

  const reservadas = new Set([
    "iss", "aud", "sub", "exp", "iat", "auth_time",
    "email", "email_verified", "firebase", "user_id",
  ]);
  const claims: Record<string, unknown> = {};
  for (const [chaveClaim, valor] of Object.entries(payload)) {
    if (!reservadas.has(chaveClaim)) claims[chaveClaim] = valor;
  }

  return {
    uid: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    emailVerificado: payload.email_verified === true,
    claims,
  };
}

/** Extrai o ID token do cabeçalho `Authorization: Bearer <token>`. */
export function tokenDoCabecalho(requisicao: Request): string {
  const cabecalho = requisicao.headers.get("authorization") ?? "";
  const encontrado = /^Bearer\s+(.+)$/i.exec(cabecalho.trim());
  if (!encontrado) {
    throw new ErroAutenticacao("Cabeçalho Authorization ausente ou fora do formato Bearer.");
  }
  return encontrado[1].trim();
}

/** Autentica a requisição a partir do cabeçalho `Authorization`. */
export async function autenticarRequisicao(requisicao: Request): Promise<UsuarioAutenticado> {
  return verificarIdToken(tokenDoCabecalho(requisicao));
}
