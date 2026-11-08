// Gaveta de Back-office — Sheet Reconciliation (Conciliação de Planilhas via
// IA).
//
// Generaliza o padrão já usado por `@/lib/shipments` (triagem de carga por
// código de rastreio) para QUALQUER "tabela operacional" — registros
// chave→campos reconciliados a partir da Neural Inbox, sem precisar de um
// schema fixo por nicho (ver `RegistroOperacional` em `@/types`).
//
// Extração determinística (léxico, sem IA generativa) sobre texto JÁ
// MASCARADO pelo Shield-Layer — mesma honestidade de todo extrator deste
// código: nenhum campo é inventado quando ausente, e o valor financeiro
// permanece mascarado por padrão (o operador vê o placeholder, não o valor
// em claro, salvo que a política de guardrail do workspace libere
// `valor-financeiro` via `piiPermitida` — mecanismo já existente, não algo
// que este módulo precise construir).
//
// Zero-touch deliberadamente parcial: a EXTRAÇÃO é automática e em tempo
// real; a ESCRITA (`upsertRegistroOperacional`) é sempre um clique do
// operador (ver `SheetReconciliationPanel`) — mesmo desenho de
// `AppointmentRemindersPanel`/`CargoTriagePanel` ("o envio de fato é um
// clique do operador, nunca automático e silencioso").

import {
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  where,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import type { AtualizacaoRegistroDetectada, DiffReconciliacao, RegistroOperacional } from "@/types";
import { db } from "./firebase";
import { DEFAULT_WORKSPACE_ID, requireDb } from "./firestore";
import { enfileirarEscrita } from "./offlineQueue";

const COLECAO = "operationalRecords";

/**
 * Prefixos reconhecidos de identificador de registro — "pedido/chamado/
 * contrato/protocolo/registro #1234" (PT) ou "order/ticket #1234" (EN).
 * Falha de forma silenciosa (`null`) quando nada compatível é encontrado —
 * mesmo contrato de `extrairCodigoRastreio` (`@/lib/shipments`).
 */
export function extrairChaveRegistro(texto: string): string | null {
  if (!texto) return null;
  const encontrado = texto.match(
    /\b(?:pedido|chamado|contrato|protocolo|registro|order|ticket)\s*#?\s*([A-Za-z0-9-]{3,20})\b/i
  );
  return encontrado ? encontrado[1].toUpperCase() : null;
}

/** Rótulo de campo → regex de valor — cada um independente, "primeiro casamento vence" por campo. */
const CAMPOS_RECONHECIDOS: Array<{ campo: string; padrao: RegExp }> = [
  {
    campo: "status",
    // Separador aceita ":"/"="/"é" (PT, "status é pago") OU a cópula inglesa
    // "is" (EN, "status is completed") — sem isso, o padrão só casava com
    // frases em inglês sem verbo ("status completed"), nunca com "is".
    padrao:
      /\bstatus\s*(?:is\b|[:=]|[ée])?\s*(pago|pendente|cancelado|conclu[íi]do|em\s+andamento|aprovado|reprovado|paid|pending|cancell?ed|completed|approved|rejected)\b/i,
  },
  { campo: "prazo", padrao: /\bprazo\s*(?::|at[ée]|=)?\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/i },
];

/** Campos reconhecidos mencionados no texto — vazio (nunca inventado) quando nenhum casa. */
export function extrairCamposAtualizados(texto: string): Record<string, string> {
  const campos: Record<string, string> = {};
  if (!texto) return campos;
  for (const { campo, padrao } of CAMPOS_RECONHECIDOS) {
    const encontrado = texto.match(padrao);
    if (encontrado) campos[campo] = encontrado[1];
  }
  return campos;
}

/**
 * Extrai uma atualização candidata de uma mensagem de chat — exige AMBOS
 * uma chave de registro E ao menos um campo reconhecido; `null` quando
 * falta qualquer um dos dois (uma atualização pela metade não é aplicada
 * silenciosamente, Artigo IV).
 */
export function extrairAtualizacaoRegistro(tabela: string, texto: string): AtualizacaoRegistroDetectada | null {
  const chave = extrairChaveRegistro(texto);
  if (!chave) return null;
  const camposAtualizados = extrairCamposAtualizados(texto);
  if (Object.keys(camposAtualizados).length === 0) return null;
  return { tabela, chave, camposAtualizados };
}

/**
 * Diferenças entre o registro salvo e a atualização detectada — só os
 * campos que de fato MUDAM aparecem (um campo igual ao já salvo não é
 * ruído na revisão do operador).
 */
export function calcularDiffReconciliacao(
  atual: RegistroOperacional | null,
  atualizacao: AtualizacaoRegistroDetectada
): DiffReconciliacao[] {
  const diffs: DiffReconciliacao[] = [];
  for (const [campo, valorNovo] of Object.entries(atualizacao.camposAtualizados)) {
    const valorAntigo = atual?.campos[campo] ?? null;
    if (valorAntigo !== valorNovo) {
      diffs.push({ campo, valorAntigo, valorNovo });
    }
  }
  return diffs;
}

/** Id determinístico por workspace+tabela+chave — evita registros duplicados para o mesmo identificador. */
function idRegistro(workspaceId: string, tabela: string, chave: string): string {
  const normalizado = `${workspaceId}_${tabela}_${chave}`.replace(/[^A-Za-z0-9_-]/g, "-");
  return `reg_${normalizado}`.slice(0, 200);
}

export function subscribeRegistrosOperacionais(
  tabela: string,
  onChange: (registros: RegistroOperacional[]) => void,
  workspaceId = DEFAULT_WORKSPACE_ID
): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const consulta = query(collection(db, COLECAO), where("workspaceId", "==", workspaceId), where("tabela", "==", tabela));
  return onSnapshot(
    consulta,
    (snapshot) =>
      onChange(snapshot.docs.map((d: QueryDocumentSnapshot) => ({ ...(d.data() as RegistroOperacional), id: d.id }))),
    (erro) => {
      console.error("[sheetReconciliation] falha ao assinar registros operacionais:", erro);
      onChange([]);
    }
  );
}

/** Registro com a `chave` informada, dentro da lista já assinada — mesmo contrato de `buscarCargaPorCodigo`. */
export function buscarRegistroPorChave(registros: RegistroOperacional[], chave: string): RegistroOperacional | null {
  const normalizado = chave.trim().toUpperCase();
  if (!normalizado) return null;
  return registros.find((r) => r.chave.trim().toUpperCase() === normalizado) ?? null;
}

export interface UpsertRegistroOperacionalInput {
  tabela: string;
  chave: string;
  camposAtualizados: Record<string, string>;
  registroAtual?: RegistroOperacional | null;
  origemConversationId?: string | null;
  workspaceId?: string;
}

/**
 * Aplica a atualização — mescla `camposAtualizados` sobre os campos já
 * salvos (nunca remove um campo existente que a atualização não menciona).
 * Sempre disparado por um clique explícito do operador (ver cabeçalho).
 */
export async function upsertRegistroOperacional(entrada: UpsertRegistroOperacionalInput): Promise<RegistroOperacional> {
  return enfileirarEscrita("Aplicar reconciliação de registro operacional", async () => {
    const database = requireDb();
    const workspaceId = entrada.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const registro: RegistroOperacional = {
      id: idRegistro(workspaceId, entrada.tabela, entrada.chave),
      workspaceId,
      tabela: entrada.tabela,
      chave: entrada.chave,
      campos: { ...(entrada.registroAtual?.campos ?? {}), ...entrada.camposAtualizados },
      atualizadoEm: new Date().toISOString(),
      origemConversationId: entrada.origemConversationId ?? null,
    };
    await setDoc(doc(database, COLECAO, registro.id), registro);
    return registro;
  });
}
