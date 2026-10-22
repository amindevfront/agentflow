// Envelope encryption AES-256-GCM — criptografia em repouso.
//
// SERVER-ONLY: depende de `@/lib/server/env`, que carrega a chave-mestra.
//
// Esquema (envelope encryption, padrão de KMS):
//
//   1. gera uma DEK (Data Encryption Key) aleatória por segredo;
//   2. cifra o segredo com a DEK;
//   3. cifra a DEK com a KEK derivada da chave-mestra;
//   4. persiste ciphertext + DEK envelopada + IVs + AAD.
//
// Por que não cifrar direto com a KEK: a DEK por registro limita o volume de
// dados sob uma mesma chave e torna a rotação da KEK uma operação de re-wrap
// das DEKs, sem reprocessar todos os segredos.
//
// O AAD (Additional Authenticated Data) vincula o envelope ao seu dono. Mover o
// ciphertext da credencial de um workspace para o documento de outro faz a
// decifragem FALHAR na verificação de autenticidade do GCM — é a defesa contra
// o ataque de "deputado confuso" com documentos trocados.

import type { SealedSecret } from "@/types";
import { chaveDetalhesAuditoria, chaveEnvelope, versaoChaveMestra } from "@/lib/server/env";
import {
  base64UrlParaBytes,
  bytesAleatorios,
  bytesParaBase64Url,
  bytesParaTexto,
  textoParaBytes,
} from "./encoding";
import { sha256Hex } from "./digest";

/** GCM exige IV único por operação; 96 bits é o tamanho recomendado. */
const TAMANHO_IV = 12;
const TAMANHO_DEK = 32;
const ALGORITMO = "AES-256-GCM" as const;

function subtle(): SubtleCrypto {
  const disponivel = globalThis.crypto?.subtle;
  if (!disponivel) {
    throw new Error("Web Crypto indisponível: as rotas de cofre exigem o runtime Node.");
  }
  return disponivel;
}

async function importarChaveAes(chave: Uint8Array, usos: KeyUsage[]): Promise<CryptoKey> {
  return subtle().importKey("raw", chave as BufferSource, { name: "AES-GCM" }, false, usos);
}

/**
 * Monta a string de AAD. A ordem e o separador fazem parte do formato: alterar
 * qualquer um deles invalida todos os envelopes já gravados.
 */
export function montarAad(partes: {
  workspaceId: string;
  recursoId: string;
  versao: number;
  proposito: string;
}): string {
  const { workspaceId, recursoId, versao, proposito } = partes;
  for (const [nome, valor] of Object.entries({ workspaceId, recursoId, proposito })) {
    if (typeof valor !== "string" || valor.length === 0 || valor.includes("|")) {
      throw new Error(`Componente de AAD inválido em "${nome}": vazio ou contém o separador.`);
    }
  }
  return `agentflow|v1|${proposito}|${workspaceId}|${recursoId}|${versao}`;
}

export interface SelarInput {
  plaintext: string;
  workspaceId: string;
  recursoId: string;
  versao: number;
  proposito: string;
  /** Chave de envelope alternativa (ex.: a de detalhes de auditoria). */
  chave?: Uint8Array;
}

/**
 * Cifra um segredo em um envelope autoexplicativo.
 *
 * O `fingerprint` é um SHA-256 truncado do plaintext. Ele permite responder
 * "esta credencial é a mesma de antes?" durante uma rotação, sem jamais
 * decifrar nem exibir o valor.
 */
export async function selarSegredo(entrada: SelarInput): Promise<SealedSecret> {
  if (typeof entrada.plaintext !== "string" || entrada.plaintext.length === 0) {
    throw new Error("Não há conteúdo para selar: o segredo está vazio.");
  }

  const aad = montarAad(entrada);
  const aadBytes = textoParaBytes(aad);

  const dek = bytesAleatorios(TAMANHO_DEK);
  const iv = bytesAleatorios(TAMANHO_IV);
  const ivDek = bytesAleatorios(TAMANHO_IV);

  try {
    const chaveDados = await importarChaveAes(dek, ["encrypt"]);
    const ciphertext = await subtle().encrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: aadBytes as BufferSource },
      chaveDados,
      textoParaBytes(entrada.plaintext) as BufferSource
    );

    const kek = entrada.chave ?? (await chaveEnvelope());
    const chaveMestraImportada = await importarChaveAes(kek, ["encrypt"]);
    const dekEnvelopada = await subtle().encrypt(
      { name: "AES-GCM", iv: ivDek as BufferSource, additionalData: aadBytes as BufferSource },
      chaveMestraImportada,
      dek as BufferSource
    );

    const fingerprint = (await sha256Hex(entrada.plaintext)).slice(0, 16);

    return {
      algoritmo: ALGORITMO,
      versaoChave: versaoChaveMestra(),
      iv: bytesParaBase64Url(iv),
      ciphertext: bytesParaBase64Url(new Uint8Array(ciphertext)),
      dekEnvelopada: bytesParaBase64Url(new Uint8Array(dekEnvelopada)),
      ivDek: bytesParaBase64Url(ivDek),
      aad,
      fingerprint,
      seladoEm: new Date().toISOString(),
    };
  } finally {
    // Zera o material de chave em memória. Não é garantia absoluta (o GC pode
    // ter copiado o buffer), mas remove a janela mais óbvia de exposição.
    dek.fill(0);
  }
}

/**
 * Decifra um envelope. Exige que o AAD esperado coincida exatamente com o
 * gravado: a verificação explícita produz uma mensagem de erro útil, e é
 * reforçada pelo próprio GCM em seguida.
 */
export async function abrirSegredo(
  envelope: SealedSecret,
  aadEsperado: string,
  chaveAlternativa?: Uint8Array
): Promise<string> {
  if (envelope.algoritmo !== ALGORITMO) {
    throw new Error(`Algoritmo de envelope não suportado: ${envelope.algoritmo}`);
  }
  if (envelope.aad !== aadEsperado) {
    throw new Error(
      "AAD do envelope não corresponde ao recurso solicitado — possível tentativa de " +
        "decifrar um segredo fora do seu contexto de origem."
    );
  }

  const aadBytes = textoParaBytes(envelope.aad);
  const kek = chaveAlternativa ?? (await chaveEnvelope());
  let dek: Uint8Array | null = null;

  try {
    const chaveMestraImportada = await importarChaveAes(kek, ["decrypt"]);
    const dekBruta = await subtle().decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlParaBytes(envelope.ivDek) as BufferSource,
        additionalData: aadBytes as BufferSource,
      },
      chaveMestraImportada,
      base64UrlParaBytes(envelope.dekEnvelopada) as BufferSource
    );
    dek = new Uint8Array(dekBruta);

    const chaveDados = await importarChaveAes(dek, ["decrypt"]);
    const plano = await subtle().decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlParaBytes(envelope.iv) as BufferSource,
        additionalData: aadBytes as BufferSource,
      },
      chaveDados,
      base64UrlParaBytes(envelope.ciphertext) as BufferSource
    );

    return bytesParaTexto(new Uint8Array(plano));
  } catch {
    // A mensagem é deliberadamente genérica: distinguir "chave errada" de
    // "ciphertext adulterado" entregaria um oráculo ao atacante.
    throw new Error("Falha ao abrir o envelope: dados inválidos, adulterados ou chave incorreta.");
  } finally {
    dek?.fill(0);
  }
}

/** Cifra detalhes sensíveis de uma entrada de auditoria com a KEK dedicada. */
export async function selarDetalhesAuditoria(
  detalhes: unknown,
  workspaceId: string,
  traceId: string
): Promise<SealedSecret> {
  return selarSegredo({
    plaintext: JSON.stringify(detalhes),
    workspaceId,
    recursoId: traceId,
    versao: 1,
    proposito: "audit-detalhes",
    chave: await chaveDetalhesAuditoria(),
  });
}

/** Decifra detalhes de auditoria. Reservado a investigação autorizada. */
export async function abrirDetalhesAuditoria(
  envelope: SealedSecret,
  workspaceId: string,
  traceId: string
): Promise<unknown> {
  const aad = montarAad({ workspaceId, recursoId: traceId, versao: 1, proposito: "audit-detalhes" });
  const texto = await abrirSegredo(envelope, aad, await chaveDetalhesAuditoria());
  return JSON.parse(texto) as unknown;
}
