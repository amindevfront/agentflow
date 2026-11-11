// Reset do ambiente de testes — apaga conversas e fluxos de PRÁTICA do
// workspace antes do go-live com um cliente real.
//
// SERVER-ONLY.
//
// Contexto: depois que um implementador brinca com o Simulador de Payload do
// Sandbox (`origemSandbox: true` em `Conversation`) e/ou cria conversas
// manuais via "Nova conversa" na Neural Inbox para aprender/demonstrar o
// produto, ele precisa de UMA ação que zere esse rastro de prática antes de
// o workspace começar a receber atendimento real. A decisão de produto aqui
// é deliberadamente simples: TODA conversa e TODO fluxo do workspace são
// dados de prática até o momento do go-live — não existe o conceito de
// "fluxo definitivo" vs. "fluxo de teste" no schema (ver `Flow` em
// `@/types`), então o reset não tenta adivinhar o que é "de verdade": ele
// apaga tudo, ponto, e quem decide quando apertar o botão é o implementador.
//
// O que esta ação NUNCA toca (fora do escopo, de propósito):
//   - configuração do workspace (nome, nicho/setor, região, moeda);
//   - credenciais do Cofre Zero-Trust (`credentials`/`credentialSecrets`);
//   - conectores já configurados (ex.: WhatsApp Cloud API real já plugado);
//   - a trilha de auditoria existente — pelo contrário, esta ação GERA uma
//     nova entrada selada (`ambiente.teste.resetado`), nunca apaga as
//     anteriores (a allowlist de `firestore.rules` já nega qualquer
//     delete/update em `auditLogs`, então não haveria nem como).
//
// Autorização por papel é responsabilidade de quem chama (ver
// `/api/workspace/reset-ambiente-teste`): este módulo confia inteiramente no
// `workspaceId` recebido — mesmo contrato de todo outro módulo admin deste
// diretório (ex.: `campaignsAdmin.ts`), que também não reverifica papel.
//
// Isolamento multi-tenant: cada exclusão é uma QUERY filtrada por
// `workspaceId` (nunca uma exclusão "apague o documento X" por id solto), o
// que torna estruturalmente impossível esta função apagar dado de outro
// workspace — não há caminho de código que não passe pelo filtro.
//
// Limite de 500 operações por lote do Firestore: `apagarReferenciasEmLotes`
// particiona em lotes de 450 (margem de segurança) e comita um lote por vez,
// nunca um único `batch()` com mais de 500 `delete()`.

import type { DocumentReference } from "firebase-admin/firestore";
import type { AuditEntry, AuditEventBody } from "@/types";
import { executarTransacaoDeSelo } from "./auditChainStore";
import { chaveAuditoria } from "./env";
import { firestoreAdmin } from "./firebaseAdmin";

const COLECAO_CONVERSAS = "conversations";
const SUBCOLECAO_MENSAGENS = "mensagens";
const COLECAO_FLOWS = "flows";

/** Margem de segurança sobre o teto real (500) do Firestore por lote de escrita. */
const TAMANHO_LOTE = 450;

export interface ResultadoResetAmbienteTeste {
  conversasExcluidas: number;
  mensagensExcluidas: number;
  fluxosExcluidos: number;
  entradaAuditoria: AuditEntry;
}

export interface AutorizacaoResetAmbienteTeste {
  autorizado: boolean;
  /** `null` quando o usuário não tem workspace associado — não há nem o que autorizar. */
  workspaceId: string | null;
  /** Presente apenas quando `autorizado` é `false` — texto já pronto para a resposta HTTP. */
  motivo?: string;
}

/**
 * Decide se o usuário autenticado pode acionar o reset, a partir dos dados
 * já lidos de `users/{uid}` pelo chamador (ver `/api/workspace/reset-ambiente-teste`).
 *
 * Extraída como função pura (sem tocar Firestore/Admin SDK) para que a regra
 * de autorização — admin do PRÓPRIO workspace, nunca de um workspace vindo
 * do corpo da requisição — seja testável isoladamente, sem precisar simular
 * a rota HTTP inteira (autenticação JWT, limite de taxa, etc.) só para
 * verificar esta decisão.
 */
export function autorizarResetAmbienteTeste(
  dadosUsuario: { workspaceId?: unknown; papel?: unknown } | null
): AutorizacaoResetAmbienteTeste {
  const workspaceId = typeof dadosUsuario?.workspaceId === "string" ? dadosUsuario.workspaceId : null;
  if (!workspaceId) {
    return { autorizado: false, workspaceId: null, motivo: "Usuário sem workspace associado." };
  }
  if (dadosUsuario?.papel !== "admin") {
    return {
      autorizado: false,
      workspaceId,
      motivo: "Apenas administradores do workspace podem resetar o ambiente de testes.",
    };
  }
  return { autorizado: true, workspaceId };
}

/**
 * Apaga uma lista de referências de documento em lotes respeitando o teto do
 * Firestore. Refs vazias não geram nenhuma chamada de rede.
 */
async function apagarReferenciasEmLotes(
  db: ReturnType<typeof firestoreAdmin>,
  refs: DocumentReference[]
): Promise<number> {
  for (let inicio = 0; inicio < refs.length; inicio += TAMANHO_LOTE) {
    const lote = db.batch();
    for (const ref of refs.slice(inicio, inicio + TAMANHO_LOTE)) {
      lote.delete(ref);
    }
    await lote.commit();
  }
  return refs.length;
}

/**
 * Executa o reset completo: apaga conversas (+ subcoleção `mensagens` de
 * cada uma) e fluxos do workspace, depois sela uma entrada de auditoria
 * registrando a ação — sempre, mesmo quando não havia nada para apagar (o
 * registro "o reset rodou, aqui está a contagem, foi zero" também é prova
 * válida para a cadeia de confiança).
 */
export async function resetarAmbienteDeTeste(
  workspaceId: string,
  solicitante: { uid: string; email?: string | null }
): Promise<ResultadoResetAmbienteTeste> {
  const db = firestoreAdmin();

  // 1. Conversas do workspace + mensagens de cada uma (subcoleção).
  const conversasSnap = await db.collection(COLECAO_CONVERSAS).where("workspaceId", "==", workspaceId).get();

  let mensagensExcluidas = 0;
  for (const conversaDoc of conversasSnap.docs) {
    const mensagensSnap = await conversaDoc.ref.collection(SUBCOLECAO_MENSAGENS).get();
    mensagensExcluidas += await apagarReferenciasEmLotes(db, mensagensSnap.docs.map((d) => d.ref));
  }
  const conversasExcluidas = await apagarReferenciasEmLotes(db, conversasSnap.docs.map((d) => d.ref));

  // 2. Fluxos do workspace.
  const flowsSnap = await db.collection(COLECAO_FLOWS).where("workspaceId", "==", workspaceId).get();
  const fluxosExcluidos = await apagarReferenciasEmLotes(db, flowsSnap.docs.map((d) => d.ref));

  // 3. Entrada de auditoria do próprio reset — mesma transação atômica
  // ler-ponteiro+selar+gravar usada por `/api/audit/seal` e demais módulos
  // admin (ver `./auditChainStore`), nunca o caminho do cliente.
  const chaveHmac = await chaveAuditoria();
  const corpo: AuditEventBody = {
    tipo: "ambiente.teste.resetado",
    resultado: "sucesso",
    workspaceId,
    ator: solicitante.uid,
    atorEmail: solicitante.email ?? undefined,
    recurso: `workspaces/${workspaceId}`,
    detalhes: {
      conversasExcluidas,
      mensagensExcluidas,
      fluxosExcluidos,
    },
    ocorridoEm: new Date().toISOString(),
  };
  const entradaAuditoria = await db.runTransaction((tx) =>
    executarTransacaoDeSelo(tx, db, workspaceId, corpo, chaveHmac)
  );

  return { conversasExcluidas, mensagensExcluidas, fluxosExcluidos, entradaAuditoria };
}
