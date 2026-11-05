// SAC Shield — Pacote de Evidência de Conformidade.
//
// SERVER-ONLY.
//
// Exporta um recorte verificável da trilha de auditoria para entrega a um
// auditor corporativo: não é um relatório narrativo (ver `@/lib/reports/*`
// para esses), é a EVIDÊNCIA BRUTA — as entradas seladas do período, mais a
// prova de integridade recalculada no momento da exportação
// (`verificarCadeiaAuditoria`), embutida no próprio pacote. Um auditor não
// precisa confiar neste servidor: ele pode recalcular os hashes e, com a
// chave HMAC (entregue por canal separado, nunca dentro do pacote), as
// assinaturas.
//
// Deliberadamente sem índice composto: a consulta filtra só por
// `workspaceId` (indexado automaticamente pelo Firestore) e ordena/recorta
// pelo período em memória — mesma defesa já usada pelo fallback de
// `assinarComFallbackDeIndice` no lado cliente (`@/lib/auditLog`), aqui
// aplicada por padrão em vez de como contingência, porque não há
// `firestore.indexes.json` neste projeto declarando o índice composto
// `workspaceId + corpo.ocorridoEm` que a consulta "correta" exigiria.

import type { AuditEntry, PacoteEvidenciaConformidade } from "@/types";
import { verificarCadeiaAuditoria } from "@/lib/crypto/auditChain";
import { executarTransacaoDeSelo } from "./auditChainStore";
import { chaveAuditoria } from "./env";
import { firestoreAdmin } from "./firebaseAdmin";

const COLECAO_ENTRADAS = "auditLogs";

export interface GerarPacoteEvidenciaInput {
  workspaceId: string;
  periodoInicio: Date;
  periodoFim: Date;
  /** Injetável em teste; em produção é sempre `chaveAuditoria()`. */
  chaveHmac?: Uint8Array;
  agora?: Date;
}

/**
 * Seleciona e ordena as entradas de um período — função pura, diretamente
 * testável sem Firestore. `periodoFim` é inclusivo.
 */
export function selecionarEntradasDoPeriodo(
  entradas: AuditEntry[],
  periodoInicio: Date,
  periodoFim: Date
): AuditEntry[] {
  const inicioMs = periodoInicio.getTime();
  const fimMs = periodoFim.getTime();
  return entradas
    .filter((entrada) => {
      const ocorridoMs = new Date(entrada.corpo.ocorridoEm).getTime();
      return ocorridoMs >= inicioMs && ocorridoMs <= fimMs;
    })
    .sort((a, b) => a.seq - b.seq);
}

/**
 * Gera o Pacote de Evidência de Conformidade de um período e registra a
 * própria geração na trilha de auditoria (mesmo racional de
 * `"relatorio.executivo.gerado"`): quem baixou, quando, e se a cadeia estava
 * íntegra no momento da exportação.
 */
export async function gerarPacoteEvidenciaConformidade(
  entrada: GerarPacoteEvidenciaInput
): Promise<PacoteEvidenciaConformidade> {
  const db = firestoreAdmin();
  const chaveHmac = entrada.chaveHmac ?? (await chaveAuditoria());
  const agora = entrada.agora ?? new Date();

  const snapshot = await db.collection(COLECAO_ENTRADAS).where("workspaceId", "==", entrada.workspaceId).get();
  const todasEntradas = snapshot.docs.map((documento) => documento.data() as AuditEntry);
  const eventos = selecionarEntradasDoPeriodo(todasEntradas, entrada.periodoInicio, entrada.periodoFim);

  const verificacaoCadeia = await verificarCadeiaAuditoria(eventos, chaveHmac);

  const pacote: PacoteEvidenciaConformidade = {
    workspaceId: entrada.workspaceId,
    periodoInicio: entrada.periodoInicio.toISOString(),
    periodoFim: entrada.periodoFim.toISOString(),
    geradoEm: agora.toISOString(),
    totalEventos: eventos.length,
    verificacaoCadeia,
    eventos,
  };

  try {
    await db.runTransaction((tx) =>
      executarTransacaoDeSelo(
        tx,
        db,
        entrada.workspaceId,
        {
          tipo: "sacshield.evidencia.pacote-gerado",
          resultado: "sucesso",
          workspaceId: entrada.workspaceId,
          ator: "sistema",
          recurso: `${COLECAO_ENTRADAS}/${entrada.workspaceId}`,
          detalhes: {
            periodoInicio: pacote.periodoInicio,
            periodoFim: pacote.periodoFim,
            totalEventos: pacote.totalEventos,
            integra: verificacaoCadeia.integra,
          },
          ocorridoEm: agora.toISOString(),
        },
        chaveHmac
      )
    );
  } catch (erro) {
    // O pacote já foi montado e já é válido — perder o registro de que ele
    // foi gerado é um incidente de observabilidade, não motivo para negar a
    // exportação ao auditor que já está esperando por ela.
    console.error("[sac-shield] falha ao registrar a geração do pacote de evidência na auditoria:", erro);
  }

  return pacote;
}
