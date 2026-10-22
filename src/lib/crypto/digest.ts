// Primitivas de hash e HMAC sobre Web Crypto.
//
// Isomórfico: `crypto.subtle` existe no Node 18+ e em todos os browsers alvo.
// As funções são assíncronas porque a API subjacente é — não há variante
// síncrona disponível nos dois ambientes.

import { bytesParaHex, textoParaBytes } from "./encoding";

function subtle(): SubtleCrypto {
  const disponivel = globalThis.crypto?.subtle;
  if (!disponivel) {
    throw new Error(
      "Web Crypto (crypto.subtle) indisponível neste runtime. " +
        "Rotas que usam criptografia exigem o runtime Node, não o Edge legado."
    );
  }
  return disponivel;
}

export async function sha256(dados: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof dados === "string" ? textoParaBytes(dados) : dados;
  const digest = await subtle().digest("SHA-256", bytes as BufferSource);
  return new Uint8Array(digest);
}

export async function sha256Hex(dados: Uint8Array | string): Promise<string> {
  return bytesParaHex(await sha256(dados));
}

/** Importa uma chave para uso em HMAC-SHA-256. */
async function importarChaveHmac(chave: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey(
    "raw",
    chave as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function hmacSha256Hex(chave: Uint8Array, mensagem: string): Promise<string> {
  const chaveImportada = await importarChaveHmac(chave);
  const assinatura = await subtle().sign("HMAC", chaveImportada, textoParaBytes(mensagem) as BufferSource);
  return bytesParaHex(new Uint8Array(assinatura));
}

/**
 * Deriva uma subchave a partir de uma chave-mestra via HKDF-SHA-256.
 *
 * Usada para que a mesma variável de ambiente nunca seja empregada em dois
 * propósitos distintos: separar o material de chave por contexto evita que
 * um problema em um subsistema comprometa o outro.
 */
export async function derivarSubchave(
  chaveMestra: Uint8Array,
  contexto: string,
  tamanhoBytes = 32
): Promise<Uint8Array> {
  const chaveImportada = await subtle().importKey("raw", chaveMestra as BufferSource, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await subtle().deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      // Sal fixo e público: a entropia vem da chave-mestra, e um sal constante
      // mantém a derivação determinística entre instâncias do servidor.
      salt: textoParaBytes("agentflow/hkdf/v1") as BufferSource,
      info: textoParaBytes(contexto) as BufferSource,
    },
    chaveImportada,
    tamanhoBytes * 8
  );
  return new Uint8Array(bits);
}
