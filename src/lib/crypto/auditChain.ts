// Trilha de auditoria imutável: encadeamento por hash + assinatura HMAC.
//
// Isomórfico por desenho. O selo (que exige a chave HMAC) só pode ser feito no
// servidor, mas a *verificação* estrutural roda em qualquer lugar — inclusive no
// browser do auditor, que assim confirma o encadeamento sem precisar confiar no
// servidor que o produziu.
//
// Modelo de ameaça e o que cada camada cobre:
//
//   | Ataque                                  | Defesa                          |
//   |-----------------------------------------|---------------------------------|
//   | Editar o conteúdo de uma entrada        | `contentHash` deixa de fechar   |
//   | Remover uma entrada do meio             | `prevHash` da seguinte quebra   |
//   | Reescrever a cadeia inteira             | HMAC exige a chave do servidor  |
//   | Sobrescrever uma posição já usada       | id derivado de `seq` + rules    |
//   | Inserir entradas forjadas pelo cliente  | HMAC inválido na verificação    |
//
// Limite honesto: quem detém credenciais de administrador do projeto Firebase
// pode apagar documentos pela console ou pelo Admin SDK. O encadeamento torna
// essa remoção DETECTÁVEL (a cadeia passa a ter buraco), não impossível.
// Imutabilidade forte exige exportação periódica para armazenamento WORM.

import type {
  AuditChainIssue,
  AuditChainVerification,
  AuditEntry,
  AuditEventBody,
} from "@/types";
import { jsonCanonico } from "./canonical";
import { hmacSha256Hex, sha256Hex } from "./digest";
import { comparacaoSegura } from "./encoding";

/** Versão do formato de selo. Muda se o algoritmo de encadeamento mudar. */
export const VERSAO_SELO = "1";

/** Valor de `prevHash` da primeira entrada da cadeia. */
export const HASH_GENESIS = "";

/**
 * Id determinístico do documento.
 *
 * Derivar o id de `seq` é o que transforma "append-only" em garantia do banco:
 * gravar duas entradas na mesma posição é um `update` do mesmo documento, e as
 * regras do Firestore negam `update` nesta coleção.
 */
export function idEntradaAuditoria(workspaceId: string, seq: number): string {
  return `${workspaceId}__${String(seq).padStart(12, "0")}`;
}

export async function hashConteudo(corpo: AuditEventBody): Promise<string> {
  return sha256Hex(jsonCanonico(corpo));
}

/** Encadeia o hash de conteúdo ao hash da entrada anterior. */
export async function encadear(prevHash: string, contentHash: string): Promise<string> {
  return sha256Hex(`${VERSAO_SELO}|${prevHash}|${contentHash}`);
}

export interface SelarEntradaInput {
  corpo: AuditEventBody;
  /** Última entrada conhecida da cadeia, ou `null` para iniciar a cadeia. */
  anterior: Pick<AuditEntry, "seq" | "chainHash"> | null;
  chaveHmac: Uint8Array;
}

/**
 * Sela uma entrada de auditoria. Operação exclusiva do servidor: requer a
 * chave HMAC, que nunca sai do processo.
 */
export async function selarEntradaAuditoria(entrada: SelarEntradaInput): Promise<AuditEntry> {
  const { corpo, anterior, chaveHmac } = entrada;

  const seq = (anterior?.seq ?? 0) + 1;
  const prevHash = anterior?.chainHash ?? HASH_GENESIS;

  const contentHash = await hashConteudo(corpo);
  const chainHash = await encadear(prevHash, contentHash);
  const assinatura = await hmacSha256Hex(chaveHmac, chainHash);

  return {
    id: idEntradaAuditoria(corpo.workspaceId, seq),
    workspaceId: corpo.workspaceId,
    seq,
    corpo,
    contentHash,
    prevHash,
    chainHash,
    assinatura,
    versaoSelo: VERSAO_SELO,
    seladoEm: new Date().toISOString(),
  };
}

/**
 * Verifica a integridade de uma cadeia de auditoria.
 *
 * As entradas são ordenadas por `seq` antes da checagem, para que a ordem de
 * chegada do Firestore não produza falso positivo de adulteração.
 *
 * Sem `chaveHmac`, verifica hashes e encadeamento (o que um cliente consegue
 * fazer sozinho); com a chave, verifica também as assinaturas.
 */
export async function verificarCadeiaAuditoria(
  entradas: AuditEntry[],
  chaveHmac?: Uint8Array
): Promise<AuditChainVerification> {
  const problemas: AuditChainIssue[] = [];
  const ordenadas = [...entradas].sort((a, b) => a.seq - b.seq);

  let seqAnterior: number | null = null;
  let chainHashAnterior: string | null = null;

  for (const atual of ordenadas) {
    const referencia = { seq: atual.seq, entryId: atual.id };

    // 1. Sequência: contígua, crescente, sem duplicata.
    if (seqAnterior !== null) {
      if (atual.seq === seqAnterior) {
        problemas.push({
          ...referencia,
          problema: "sequencia-duplicada",
          detalhe: `Duas entradas ocupam a posição ${atual.seq}.`,
        });
      } else if (atual.seq !== seqAnterior + 1) {
        problemas.push({
          ...referencia,
          problema: "sequencia-fora-de-ordem",
          detalhe: `Salto de ${seqAnterior} para ${atual.seq} — ${atual.seq - seqAnterior - 1} entrada(s) ausente(s).`,
        });
      }
    } else if (atual.seq === 1 && atual.prevHash !== HASH_GENESIS) {
      problemas.push({
        ...referencia,
        problema: "genesis-invalida",
        detalhe: "A primeira entrada da cadeia deve ter prevHash vazio.",
      });
    }

    // 2. Hash de conteúdo: o corpo não foi editado.
    let contentHashCalculado: string;
    try {
      contentHashCalculado = await hashConteudo(atual.corpo);
    } catch (erro) {
      problemas.push({
        ...referencia,
        problema: "hash-conteudo-divergente",
        detalhe: `Corpo não serializável: ${erro instanceof Error ? erro.message : String(erro)}`,
      });
      seqAnterior = atual.seq;
      chainHashAnterior = atual.chainHash;
      continue;
    }

    if (!comparacaoSegura(contentHashCalculado, atual.contentHash)) {
      problemas.push({
        ...referencia,
        problema: "hash-conteudo-divergente",
        detalhe: "O conteúdo da entrada foi alterado após o selo.",
      });
    }

    // 3. Encadeamento: aponta corretamente para a entrada anterior.
    if (chainHashAnterior !== null && atual.prevHash !== chainHashAnterior) {
      problemas.push({
        ...referencia,
        problema: "encadeamento-rompido",
        detalhe: "prevHash não corresponde ao chainHash da entrada anterior.",
      });
    }

    const chainHashCalculado = await encadear(atual.prevHash, atual.contentHash);
    if (!comparacaoSegura(chainHashCalculado, atual.chainHash)) {
      problemas.push({
        ...referencia,
        problema: "encadeamento-rompido",
        detalhe: "chainHash não deriva de prevHash + contentHash.",
      });
    }

    // 4. Assinatura: a entrada foi selada pelo servidor.
    if (chaveHmac) {
      const assinaturaCalculada = await hmacSha256Hex(chaveHmac, atual.chainHash);
      if (!comparacaoSegura(assinaturaCalculada, atual.assinatura)) {
        problemas.push({
          ...referencia,
          problema: "assinatura-invalida",
          detalhe: "HMAC inválido — a entrada não foi selada por este servidor.",
        });
      }
    }

    seqAnterior = atual.seq;
    chainHashAnterior = atual.chainHash;
  }

  return {
    integra: problemas.length === 0,
    entradasVerificadas: ordenadas.length,
    assinaturasVerificadas: Boolean(chaveHmac),
    problemas,
    verificadoEm: new Date().toISOString(),
  };
}
