// Conversões de encoding usadas pela camada criptográfica.
//
// Isomórfico: implementado sobre APIs presentes tanto no Node 18+ quanto nos
// browsers modernos, sem `Buffer` e sem `atob`/`btoa` (que não lidam bem com
// bytes arbitrários).

const codificadorUtf8 = new TextEncoder();
const decodificadorUtf8 = new TextDecoder();

export function textoParaBytes(texto: string): Uint8Array {
  return codificadorUtf8.encode(texto);
}

export function bytesParaTexto(bytes: Uint8Array): string {
  return decodificadorUtf8.decode(bytes);
}

const ALFABETO_BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Codifica bytes em base64url sem padding (RFC 4648 §5). */
export function bytesParaBase64Url(bytes: Uint8Array): string {
  let saida = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;

    saida += ALFABETO_BASE64URL[b0 >> 2];
    saida += ALFABETO_BASE64URL[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    saida += ALFABETO_BASE64URL[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    saida += ALFABETO_BASE64URL[b2 & 0x3f];
  }
  return saida;
}

const INVERSO_BASE64URL: Record<string, number> = {};
for (let i = 0; i < ALFABETO_BASE64URL.length; i += 1) {
  INVERSO_BASE64URL[ALFABETO_BASE64URL[i]] = i;
}
// Aceita também o alfabeto base64 padrão, para tolerar chaves geradas por
// ferramentas que não usam a variante url-safe.
INVERSO_BASE64URL["+"] = 62;
INVERSO_BASE64URL["/"] = 63;

/** Decodifica base64 ou base64url, com ou sem padding. */
export function base64UrlParaBytes(entrada: string): Uint8Array {
  const limpo = entrada.replace(/[\s=]/g, "");
  const bytes = new Uint8Array(Math.floor((limpo.length * 6) / 8));

  let acumulador = 0;
  let bitsAcumulados = 0;
  let posicao = 0;

  for (const caractere of limpo) {
    const valor = INVERSO_BASE64URL[caractere];
    if (valor === undefined) {
      throw new Error(`Caractere inválido em base64: ${JSON.stringify(caractere)}`);
    }
    acumulador = (acumulador << 6) | valor;
    bitsAcumulados += 6;
    if (bitsAcumulados >= 8) {
      bitsAcumulados -= 8;
      bytes[posicao] = (acumulador >> bitsAcumulados) & 0xff;
      posicao += 1;
    }
  }

  return bytes.subarray(0, posicao);
}

export function bytesParaHex(bytes: Uint8Array): string {
  let saida = "";
  for (const byte of bytes) {
    saida += byte.toString(16).padStart(2, "0");
  }
  return saida;
}

export function hexParaBytes(hex: string): Uint8Array {
  const limpo = hex.trim().toLowerCase();
  if (limpo.length % 2 !== 0 || /[^0-9a-f]/.test(limpo)) {
    throw new Error("Valor hexadecimal inválido.");
  }
  const bytes = new Uint8Array(limpo.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(limpo.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Comparação em tempo constante.
 *
 * Um `===` em string vaza, pelo tempo de execução, quantos caracteres iniciais
 * coincidem — o que permite descobrir um HMAC byte a byte. Esta implementação
 * sempre percorre o mesmo número de posições para entradas de mesmo tamanho.
 */
export function comparacaoSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i += 1) {
    diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferenca === 0;
}

/** Bytes aleatórios criptograficamente seguros. */
export function bytesAleatorios(tamanho: number): Uint8Array {
  const bytes = new Uint8Array(tamanho);
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Web Crypto indisponível neste runtime — geração de aleatoriedade segura impossível.");
  }
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}
