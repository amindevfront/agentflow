// Motor de campanhas — persistência Firestore (cliente).
//
// Planejamento (jitter, lotes, hash de opt-out) acontece aqui, instantâneo e
// local — ver `@/lib/campaigns/stochasticEngine`. O disparo de fato, que
// precisa esperar cada horário agendado chegar, acontece no servidor via
// `/api/campaigns/tick` (Admin SDK), chamado repetidamente por um scheduler
// externo — nunca por este módulo, que nunca bloqueia esperando uma campanha
// inteira terminar.

import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import type { Campaign, CampaignRecipient, Canal, JitterConfig, OptOutEntry } from "@/types";
import { auth, db } from "@/lib/firebase";
import { DEFAULT_WORKSPACE_ID, requireDb } from "@/lib/firestore";
import { interceptarMensagem } from "@/lib/guardrails/piiVault";
import { hashDestino, planejarLotes } from "./stochasticEngine";
import { assinarComFallbackDeIndice } from "@/lib/firestoreResilience";

const COLECAO_CAMPANHAS = "campaigns";
const SUBCOLECAO_DESTINATARIOS = "destinatarios";
const COLECAO_VAULT_DESTINATARIOS = "recipientVaults";
const COLECAO_OPT_OUTS = "optOuts";

function novoId(prefixo: string): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefixo}_${aleatorio}`;
}

async function idToken(): Promise<string> {
  const usuario = auth?.currentUser;
  if (!usuario) throw new Error("Nenhuma sessão autenticada — operação de campanha indisponível.");
  return usuario.getIdToken();
}

interface RespostaSelarDestinatario {
  envelope?: unknown;
  erro?: { codigo: string; mensagem: string };
}

async function selarDestinatario(entrada: {
  destino: string;
  campaignId: string;
  recipientId: string;
  workspaceId: string;
}): Promise<unknown> {
  const resposta = await fetch("/api/campaigns/seal-recipient", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await idToken()}` },
    body: JSON.stringify(entrada),
  });
  const dados = (await resposta.json().catch(() => ({}))) as RespostaSelarDestinatario;
  if (!resposta.ok || !dados.envelope) {
    throw new Error(dados.erro?.mensagem ?? `Falha ao selar destinatário (HTTP ${resposta.status}).`);
  }
  return dados.envelope;
}

// ---------------------------------------------------------------------------
// Assinaturas
// ---------------------------------------------------------------------------

export function subscribeCampaigns(
  onChange: (campanhas: Campaign[]) => void,
  // `onError` nunca recebe o erro — quem consome mostra um texto amigável
  // fixo; índice ausente é absorvido de forma transparente (ver
  // `assinarComFallbackDeIndice`) e nem chega a chamar isto.
  opcoes: { workspaceId?: string; onError?: () => void } = {}
): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const workspaceId = opcoes.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const mapearCampanha = (d: QueryDocumentSnapshot) => ({ ...(d.data() as Campaign), id: d.id });

  return assinarComFallbackDeIndice({
    consultaPrincipal: query(
      collection(db, COLECAO_CAMPANHAS),
      where("workspaceId", "==", workspaceId),
      orderBy("criadaEm", "desc"),
      limit(100)
    ),
    consultaFallback: query(collection(db, COLECAO_CAMPANHAS), where("workspaceId", "==", workspaceId)),
    mapearDoc: mapearCampanha,
    ordenarFallback: (lista) => [...lista].sort((a, b) => b.criadaEm.localeCompare(a.criadaEm)).slice(0, 100),
    onChange,
    aoFalharDeFormaIrrecuperavel: opcoes.onError,
    contexto: "campanhas",
  });
}

export function subscribeRecipients(
  campaignId: string,
  onChange: (destinatarios: CampaignRecipient[]) => void
): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const consulta = query(
    collection(db, COLECAO_CAMPANHAS, campaignId, SUBCOLECAO_DESTINATARIOS),
    orderBy("loteIndice", "asc"),
    limit(2000)
  );
  return onSnapshot(
    consulta,
    (snapshot) => onChange(snapshot.docs.map((d) => ({ ...(d.data() as CampaignRecipient), id: d.id }))),
    (erro) => {
      console.error(`[campanhas] falha ao assinar destinatários de ${campaignId}:`, erro);
      onChange([]);
    }
  );
}

export function subscribeOptOuts(
  onChange: (optOuts: OptOutEntry[]) => void,
  workspaceId = DEFAULT_WORKSPACE_ID
): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const consulta = query(collection(db, COLECAO_OPT_OUTS), where("workspaceId", "==", workspaceId));
  return onSnapshot(
    consulta,
    (snapshot) => onChange(snapshot.docs.map((d) => ({ ...(d.data() as OptOutEntry), id: d.id }))),
    (erro) => {
      console.error("[campanhas] falha ao assinar opt-outs:", erro);
      onChange([]);
    }
  );
}

// ---------------------------------------------------------------------------
// Criação e planejamento
// ---------------------------------------------------------------------------

export interface CriarCampanhaInput {
  nome: string;
  canal: Canal;
  mensagemTemplate: string;
  /** Telefones/e-mails em claro — trafegam uma única vez, para selagem. */
  destinatarios: string[];
  jitterConfig?: Partial<JitterConfig>;
  workspaceId?: string;
  criadoPor: string;
  agendadaPara?: Date;
}

const JITTER_PADRAO: JitterConfig = {
  minMs: 2_000,
  maxMs: 9_000,
  loteSize: 20,
  pausaEntreLotesMs: 45_000,
  taxaMaximaPorMinuto: 20,
};

/**
 * Cria uma campanha e planeja o cronograma completo de envio.
 *
 * Cada destinatário passa pelo mesmo Shield-Layer das mensagens de chat
 * (mascarado para exibição) e é selado no cofre efêmero (valor em claro
 * nunca persistido fora do envelope cifrado) — o mesmo padrão de
 * `credentials`/`credentialSecrets` e `messageVaults`, agora para
 * `recipientVaults`. Falhas de selo em destinatários individuais não abortam
 * a campanha inteira: aquele destinatário fica marcado como falho, os demais
 * seguem planejados normalmente.
 */
export async function criarCampanha(entrada: CriarCampanhaInput): Promise<Campaign> {
  const database = requireDb();
  const workspaceId = entrada.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const agora = new Date().toISOString();
  const campaignId = novoId("camp");
  const jitterConfig: JitterConfig = { ...JITTER_PADRAO, ...entrada.jitterConfig };

  const recipientIds = entrada.destinatarios.map(() => novoId("dest"));
  const plano = planejarLotes({
    recipientIds,
    config: jitterConfig,
    inicioEm: entrada.agendadaPara,
  });

  let totalFalhasNoPlanejamento = 0;

  for (let i = 0; i < entrada.destinatarios.length; i += 1) {
    const destinoOriginal = entrada.destinatarios[i];
    const recipientId = recipientIds[i];
    const envioPlanejado = plano[i];

    const { textoMascarado: destinoMascarado } = interceptarMensagem(destinoOriginal);
    const destinoHash = await hashDestino(destinoOriginal, workspaceId);

    const recipient: CampaignRecipient = {
      id: recipientId,
      destinoMascarado,
      destinoHash,
      status: "pendente",
      agendadoPara: envioPlanejado.agendadoPara,
      jitterMsAplicado: envioPlanejado.jitterMsAplicado,
      loteIndice: envioPlanejado.loteIndice,
    };

    try {
      const envelope = await selarDestinatario({ destino: destinoOriginal, campaignId, recipientId, workspaceId });
      await setDoc(doc(database, COLECAO_VAULT_DESTINATARIOS, `${campaignId}__${recipientId}`), {
        campaignId,
        recipientId,
        workspaceId,
        envelope,
        criadoEm: agora,
      });
    } catch (erro) {
      // Sem o envelope, este destinatário específico não pode ser enviado de
      // verdade mais tarde — fica marcado como falho desde já, de forma
      // visível, em vez de silenciosamente ficar "pendente" para sempre.
      console.error(`[campanhas] falha ao selar destinatário ${recipientId}:`, erro);
      recipient.status = "falhou";
      recipient.motivoBloqueio = "falha ao selar o destino no cofre";
      totalFalhasNoPlanejamento += 1;
    }

    await setDoc(
      doc(database, COLECAO_CAMPANHAS, campaignId, SUBCOLECAO_DESTINATARIOS, recipientId),
      recipient
    );
  }

  const campanha: Campaign = {
    id: campaignId,
    workspaceId,
    nome: entrada.nome,
    canal: entrada.canal,
    mensagemTemplate: entrada.mensagemTemplate,
    status: "rascunho",
    jitterConfig,
    totalDestinatarios: entrada.destinatarios.length,
    totalEnviados: 0,
    totalBloqueados: 0,
    totalFalhas: totalFalhasNoPlanejamento,
    criadaEm: agora,
    criadaPor: entrada.criadoPor,
    agendadaPara: entrada.agendadaPara?.toISOString(),
  };

  await setDoc(doc(database, COLECAO_CAMPANHAS, campaignId), campanha);
  return campanha;
}

/** Transiciona a campanha de rascunho para agendada — o tick do servidor passa a processá-la. */
export async function iniciarCampanha(campaignId: string): Promise<void> {
  const database = requireDb();
  await updateDoc(doc(database, COLECAO_CAMPANHAS, campaignId), { status: "agendada" });
}

export async function pausarCampanha(campaignId: string): Promise<void> {
  const database = requireDb();
  await updateDoc(doc(database, COLECAO_CAMPANHAS, campaignId), { status: "pausada" });
}

// ---------------------------------------------------------------------------
// Opt-out e conformidade
// ---------------------------------------------------------------------------

export async function registrarOptOut(entrada: {
  destino: string;
  canal: Canal;
  origem: OptOutEntry["origem"];
  workspaceId?: string;
}): Promise<void> {
  const database = requireDb();
  const workspaceId = entrada.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const destinoHash = await hashDestino(entrada.destino, workspaceId);

  const entradaOptOut: OptOutEntry = {
    id: `${workspaceId}__${destinoHash}`,
    workspaceId,
    destinoHash,
    canal: entrada.canal,
    registradoEm: new Date().toISOString(),
    origem: entrada.origem,
  };

  await setDoc(doc(database, COLECAO_OPT_OUTS, entradaOptOut.id), entradaOptOut);
}
