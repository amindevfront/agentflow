// Neural Inbox — persistência Firestore.
//
// Três coleções novas, seguindo exatamente o padrão já estabelecido pelo
// cofre de credenciais (`credentials`/`credentialSecrets`):
//
//   conversations/{id}                      → metadados da conversa, visíveis
//                                              ao workspace.
//   conversations/{id}/mensagens/{id}       → texto SEMPRE mascarado.
//   messageVaults/{conversationId__messageId} → envelope cifrado do texto
//                                              original, quando havia PII.
//                                              `allow read: if false` nas
//                                              regras — nenhum cliente lê.
//   operatorProfiles/{uid}, agentProfiles/{id} → perfis consumidos pelo
//                                              Swarm Routing.
//
// `registrarMensagemCliente` é o pipeline completo: Shield-Layer → persistir
// → Radar de Sentimento → Circuit Breaker → (se necessário) abrir P1 de SLA.
// Nenhum desses passos é pulado silenciosamente — uma falha no selo do cofre
// de compliance não impede a mensagem de ser registrada (mascarada), mas uma
// falha ao computar frustração também não trava o registro da mensagem: o
// pipeline é resiliente em cada etapa, documentado inline.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import type {
  AgentProfile,
  Canal,
  Conversation,
  ConversationMessage,
  ConversationStatus,
  MessageSender,
  OperatorProfile,
  RoutingDecision,
} from "@/types";
import { auth, db } from "@/lib/firebase";
import { DEFAULT_WORKSPACE_ID, requireDb } from "@/lib/firestore";
import { interceptarMensagem, processarMensagemEntrante } from "@/lib/guardrails/piiVault";
import { LIMIAR_FRUSTRACAO_CRITICA, calcularFrustration } from "@/lib/sentiment/radar";
import { abrirTransbordo } from "@/lib/humanInTheLoop";
import { registrarEventoAuditoriaSilencioso } from "@/lib/auditLog";
import { enfileirarEscrita } from "@/lib/offlineQueue";

const COLECAO_CONVERSAS = "conversations";
const SUBCOLECAO_MENSAGENS = "mensagens";
const COLECAO_VAULT_MENSAGENS = "messageVaults";
const COLECAO_OPERADORES = "operatorProfiles";
const COLECAO_AGENTES = "agentProfiles";

/** SLA de primeira resposta em chat, por prioridade — mais curto que o SLA de revisão de ticket (SLA_MINUTOS em humanInTheLoop.ts), porque chat é síncrono. */
const SLA_RESPOSTA_SEGUNDOS: Record<Conversation["prioridade"], number> = {
  p1: 60,
  p2: 180,
  p3: 600,
  p4: 1800,
};

function novoId(prefixo: string): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefixo}_${aleatorio}`;
}

async function idToken(): Promise<string> {
  const usuario = auth?.currentUser;
  if (!usuario) throw new Error("Nenhuma sessão autenticada — operação da Neural Inbox indisponível.");
  return usuario.getIdToken();
}

// ---------------------------------------------------------------------------
// Assinaturas em tempo real
// ---------------------------------------------------------------------------

export function subscribeConversations(
  onChange: (conversas: Conversation[]) => void,
  opcoes: { workspaceId?: string; limite?: number; onError?: (erro: Error) => void } = {}
): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }

  const consulta = query(
    collection(db, COLECAO_CONVERSAS),
    where("workspaceId", "==", opcoes.workspaceId ?? DEFAULT_WORKSPACE_ID),
    orderBy("ultimaMensagemEm", "desc"),
    limit(opcoes.limite ?? 200)
  );

  return onSnapshot(
    consulta,
    (snapshot) => onChange(snapshot.docs.map((d) => ({ ...(d.data() as Conversation), id: d.id }))),
    (erro) => {
      console.error("[inbox] falha ao assinar conversas:", erro);
      opcoes.onError?.(erro);
      onChange([]);
    }
  );
}

export function subscribeMessages(
  conversationId: string,
  onChange: (mensagens: ConversationMessage[]) => void,
  opcoes: { limite?: number; onError?: (erro: Error) => void } = {}
): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }

  const consulta = query(
    collection(db, COLECAO_CONVERSAS, conversationId, SUBCOLECAO_MENSAGENS),
    orderBy("enviadaEm", "asc"),
    limit(opcoes.limite ?? 500)
  );

  return onSnapshot(
    consulta,
    (snapshot) => onChange(snapshot.docs.map((d) => ({ ...(d.data() as ConversationMessage), id: d.id }))),
    (erro) => {
      console.error(`[inbox] falha ao assinar mensagens de ${conversationId}:`, erro);
      opcoes.onError?.(erro);
      onChange([]);
    }
  );
}

export function subscribeOperatorProfiles(
  onChange: (operadores: OperatorProfile[]) => void,
  workspaceId = DEFAULT_WORKSPACE_ID
): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const consulta = query(collection(db, COLECAO_OPERADORES), where("workspaceId", "==", workspaceId));
  return onSnapshot(
    consulta,
    (snapshot) => onChange(snapshot.docs.map((d) => ({ ...(d.data() as OperatorProfile), uid: d.id }))),
    (erro) => {
      console.error("[inbox] falha ao assinar perfis de operador:", erro);
      onChange([]);
    }
  );
}

export function subscribeAgentProfiles(
  onChange: (agentes: AgentProfile[]) => void,
  workspaceId = DEFAULT_WORKSPACE_ID
): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const consulta = query(collection(db, COLECAO_AGENTES), where("workspaceId", "==", workspaceId));
  return onSnapshot(
    consulta,
    (snapshot) => onChange(snapshot.docs.map((d) => ({ ...(d.data() as AgentProfile), id: d.id }))),
    (erro) => {
      console.error("[inbox] falha ao assinar perfis de agente:", erro);
      onChange([]);
    }
  );
}

// ---------------------------------------------------------------------------
// Criação de conversa
// ---------------------------------------------------------------------------

export interface CriarConversaInput {
  canal: Canal;
  nomeParticipante: string;
  identificadorParticipante: string;
  assunto: string;
  workspaceId?: string;
}

/**
 * Cria uma conversa nova a partir do primeiro contato do cliente.
 *
 * O identificador do participante (telefone/e-mail/handle) passa pelo mesmo
 * Shield-Layer das mensagens — ele É um dado pessoal e nunca fica em claro em
 * `conversations/{id}.participante.identificadorMascarado`.
 */
export async function criarConversa(entrada: CriarConversaInput): Promise<Conversation> {
  return enfileirarEscrita("Criar conversa", async () => {
    const database = requireDb();
    const workspaceId = entrada.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const agora = new Date().toISOString();

    const { textoMascarado: identificadorMascarado } = interceptarMensagem(entrada.identificadorParticipante);

    const conversa: Conversation = {
      id: novoId("conv"),
      workspaceId,
      canal: entrada.canal,
      participante: {
        nome: entrada.nomeParticipante,
        identificadorMascarado,
      },
      assunto: entrada.assunto,
      status: "aberta",
      prioridade: "p3",
      atribuidoTipo: "nenhum",
      frustrationIndex: 0,
      frustrationTendencia: "estavel",
      circuitBreakerAtivo: false,
      ultimaMensagemPreview: "",
      ultimaMensagemEm: agora,
      criadaEm: agora,
      totalMensagens: 0,
      totalMensagensCliente: 0,
    };

    await setDoc(doc(database, COLECAO_CONVERSAS, conversa.id), conversa);
    return conversa;
  });
}

// ---------------------------------------------------------------------------
// Mensagem do cliente — o pipeline completo
// ---------------------------------------------------------------------------

export interface RegistrarMensagemClienteResultado {
  mensagem: ConversationMessage;
  frustrationIndex: number;
  circuitBreakerDisparadoAgora: boolean;
}

/**
 * Registra uma mensagem recebida do cliente — o caminho que um webhook de
 * canal (WhatsApp/Instagram/Facebook) ou o widget de webchat chamam.
 *
 * Pipeline, em ordem, cada etapa resiliente à falha da anterior:
 *   1. Shield-Layer (mascarar + selar o original, se houver PII);
 *   2. persistir a mensagem (SEMPRE mascarada);
 *   3. Radar de Sentimento sobre o histórico recente de mensagens do cliente;
 *   4. se o Circuit Breaker acabou de disparar (não estava ativo antes),
 *      abrir um ticket de transbordo P1 — a conversa continua funcionando
 *      mesmo que a abertura do ticket falhe (registrada em log, não lançada).
 */
export async function registrarMensagemCliente(entrada: {
  conversationId: string;
  texto: string;
  canal: Canal;
  workspaceId?: string;
}): Promise<RegistrarMensagemClienteResultado> {
  const database = requireDb();
  const workspaceId = entrada.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const agora = new Date();
  const refConversa = doc(database, COLECAO_CONVERSAS, entrada.conversationId);

  const conversaSnap = await getDoc(refConversa);
  if (!conversaSnap.exists()) {
    throw new Error(`Conversa ${entrada.conversationId} não encontrada.`);
  }
  const conversaAtual = conversaSnap.data() as Conversation;

  // 1 + 2. Shield-Layer e persistência da mensagem.
  const messageId = novoId("msg");
  let selo: Awaited<ReturnType<typeof processarMensagemEntrante>>;
  try {
    selo = await processarMensagemEntrante({
      texto: entrada.texto,
      conversationId: entrada.conversationId,
      messageId,
      workspaceId,
      idToken: await idToken(),
    });
  } catch (erro) {
    // Falha de autenticação/sessão impede até a chamada ao selo — mas a
    // máscara em si (`interceptarMensagem`) é local e não depende de rede,
    // então ainda garantimos que nada em claro seja persistido.
    console.error("[inbox] Shield-Layer não pôde chamar o servidor — aplicando máscara local apenas:", erro);
    const local = interceptarMensagem(entrada.texto);
    selo = {
      textoMascarado: local.textoMascarado,
      piiDetectada: local.piiDetectada,
      temVersaoOriginalSelada: false,
      envelope: null,
    };
  }

  const mensagem: ConversationMessage = {
    id: messageId,
    conversationId: entrada.conversationId,
    workspaceId,
    canal: entrada.canal,
    remetente: "cliente",
    texto: selo.textoMascarado,
    piiDetectada: selo.piiDetectada,
    enviadaEm: agora.toISOString(),
    temVersaoOriginalSelada: selo.temVersaoOriginalSelada,
  };

  await setDoc(doc(database, COLECAO_CONVERSAS, entrada.conversationId, SUBCOLECAO_MENSAGENS, messageId), mensagem);

  if (selo.envelope) {
    await setDoc(doc(database, COLECAO_VAULT_MENSAGENS, `${entrada.conversationId}__${messageId}`), {
      conversationId: entrada.conversationId,
      messageId,
      workspaceId,
      envelope: selo.envelope,
      criadoEm: agora.toISOString(),
    });
  }

  // 3. Radar de sentimento sobre o histórico recente de mensagens do cliente.
  const historicoSnap = await getDocs(
    query(
      collection(database, COLECAO_CONVERSAS, entrada.conversationId, SUBCOLECAO_MENSAGENS),
      where("remetente", "==", "cliente"),
      orderBy("enviadaEm", "desc"),
      limit(5)
    )
  );
  const mensagensClienteRecentes = historicoSnap.docs
    .map((d) => (d.data() as ConversationMessage).texto)
    .reverse(); // ordem cronológica, mais recente por último

  // Latência: só é um sinal relevante quando a mensagem anterior TAMBÉM foi do
  // cliente — ou seja, ele falou de novo sem receber resposta no meio.
  const latenciaRespostaSegundos =
    conversaAtual.ultimaMensagemRemetente === "cliente"
      ? (agora.getTime() - new Date(conversaAtual.ultimaMensagemEm).getTime()) / 1000
      : undefined;

  const slaSegundos = SLA_RESPOSTA_SEGUNDOS[conversaAtual.prioridade] ?? SLA_RESPOSTA_SEGUNDOS.p3;
  const frustration = calcularFrustration(
    { mensagensCliente: mensagensClienteRecentes, latenciaRespostaSegundos, slaRespostaSegundos: slaSegundos },
    LIMIAR_FRUSTRACAO_CRITICA
  );

  const circuitBreakerDisparadoAgora = frustration.circuitBreakerAtivado && !conversaAtual.circuitBreakerAtivo;

  await updateDoc(refConversa, {
    ultimaMensagemPreview: selo.textoMascarado.slice(0, 160),
    ultimaMensagemEm: agora.toISOString(),
    ultimaMensagemRemetente: "cliente" satisfies MessageSender,
    totalMensagens: conversaAtual.totalMensagens + 1,
    totalMensagensCliente: conversaAtual.totalMensagensCliente + 1,
    frustrationIndex: frustration.indice,
    frustrationTendencia: frustration.tendencia,
    circuitBreakerAtivo: frustration.circuitBreakerAtivado,
    status: conversaAtual.status === "resolvida" ? "aberta" : conversaAtual.status,
  });

  // 4. Circuit Breaker: abre um P1 de SLA na primeira vez que dispara.
  //
  // Severidade SEMPRE "critica" aqui — não graduada pelo quanto o índice
  // passou do limiar. Cruzar o limiar crítico É, por definição, o evento que
  // justifica P1; graduar a severidade (e com ela, via `derivarPrioridade`,
  // a prioridade do ticket) deixaria passar casos no início da faixa crítica
  // como P2/P3, contrariando o requisito de que o Circuit Breaker produz um
  // P1 incondicional.
  if (circuitBreakerDisparadoAgora) {
    try {
      const ticket = await abrirTransbordo({
        solicitacao: {
          traceId: `inbox_${messageId}`,
          politicaId: "padrao",
          severidade: "critica",
          veredito: "transbordo",
          violacoes: [
            {
              regra: "frustracao-critica",
              severidade: "critica",
              mensagem: `Índice de frustração em ${frustration.indice}/100. Sinais: ${frustration.sinais.join(", ") || "nenhum sinal textual isolado — acúmulo de latência/repetição"}.`,
              score: frustration.indice / 100,
              limite: LIMIAR_FRUSTRACAO_CRITICA / 100,
            },
          ],
          payloadMascarado: selo.textoMascarado,
        },
        flowId: entrada.conversationId,
        flowNome: conversaAtual.assunto || `Conversa ${entrada.canal}`,
        conversationId: entrada.conversationId,
        motivoForcado: "frustracao-critica",
        workspaceId,
        criadoPor: "sistema",
      });

      await updateDoc(refConversa, { slaTicketId: ticket.id });

      await registrarEventoAuditoriaSilencioso({
        tipo: "guardrail.transbordo.acionado",
        recurso: `${COLECAO_CONVERSAS}/${entrada.conversationId}`,
        workspaceId,
        traceId: `inbox_${messageId}`,
        severidade: "critica",
        detalhes: { frustrationIndex: frustration.indice, ticketId: ticket.id },
      });
    } catch (erro) {
      // A conversa já está marcada com o índice/circuit breaker corretos —
      // perder o ticket é um incidente de observabilidade, não motivo para
      // reverter o registro da mensagem nem a atualização do índice.
      console.error("[inbox] falha ao abrir P1 de frustração crítica:", erro);
    }
  }

  return { mensagem, frustrationIndex: frustration.indice, circuitBreakerDisparadoAgora };
}

// ---------------------------------------------------------------------------
// Mensagem do operador/agente
// ---------------------------------------------------------------------------

export async function enviarMensagemOperador(entrada: {
  conversationId: string;
  texto: string;
  remetente: "operador" | "agente";
  remetenteId: string;
  canal: Canal;
  workspaceId?: string;
}): Promise<ConversationMessage> {
  return enfileirarEscrita("Enviar resposta na Neural Inbox", async () => {
    const database = requireDb();
    const workspaceId = entrada.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const agora = new Date();
    const messageId = novoId("msg");

    // A resposta do operador também passa pelo Shield-Layer: um atendente pode
    // colar, sem querer, um trecho com dado pessoal do cliente ao redigir.
    const { textoMascarado, piiDetectada } = interceptarMensagem(entrada.texto);

    const mensagem: ConversationMessage = {
      id: messageId,
      conversationId: entrada.conversationId,
      workspaceId,
      canal: entrada.canal,
      remetente: entrada.remetente,
      remetenteId: entrada.remetenteId,
      texto: textoMascarado,
      piiDetectada,
      enviadaEm: agora.toISOString(),
      // O cofre de compliance (selo no servidor) é reservado a mensagens do
      // CLIENTE — ver `registrarMensagemCliente`. Uma resposta do operador que
      // acidentalmente contém PII é mascarada aqui da mesma forma, mas não gera
      // uma segunda cópia selada: o titular dos dados, nesse caso, é o cliente
      // mencionado pelo operador, não o próprio operador.
      temVersaoOriginalSelada: false,
    };

    await setDoc(doc(database, COLECAO_CONVERSAS, entrada.conversationId, SUBCOLECAO_MENSAGENS, messageId), mensagem);

    const refConversa = doc(database, COLECAO_CONVERSAS, entrada.conversationId);
    const conversaSnap = await getDoc(refConversa);
    const totalAtual = conversaSnap.exists() ? (conversaSnap.data() as Conversation).totalMensagens : 0;

    await updateDoc(refConversa, {
      ultimaMensagemPreview: textoMascarado.slice(0, 160),
      ultimaMensagemEm: agora.toISOString(),
      ultimaMensagemRemetente: entrada.remetente satisfies MessageSender,
      totalMensagens: totalAtual + 1,
      status: "em-atendimento" satisfies ConversationStatus,
    });

    return mensagem;
  });
}

// ---------------------------------------------------------------------------
// Atribuição e resolução
// ---------------------------------------------------------------------------

/** Aplica o resultado do Swarm Routing a uma conversa recém-chegada ou sem dono. */
export async function atribuirConversaPorRoteamento(
  conversationId: string,
  decisao: RoutingDecision
): Promise<void> {
  const database = requireDb();
  const refConversa = doc(database, COLECAO_CONVERSAS, conversationId);

  if (!decisao.escolhido) {
    // Fila cheia: a conversa fica sem dono, mas a decisão (vazia) ainda é
    // registrada — um supervisor precisa conseguir ver "ninguém disponível
    // às 14h32", não só "está sem atribuição" sem explicação.
    await updateDoc(refConversa, { roteamento: decisao, atribuidoTipo: "nenhum" });
    return;
  }

  await updateDoc(refConversa, {
    roteamento: decisao,
    atribuidoTipo: decisao.escolhido.tipo,
    atribuidoId: decisao.escolhido.id,
    atribuidoNome: decisao.escolhido.nome,
  });
}

export async function atribuirConversaManual(conversationId: string, operadorUid: string, operadorNome: string): Promise<void> {
  const database = requireDb();
  await updateDoc(doc(database, COLECAO_CONVERSAS, conversationId), {
    atribuidoTipo: "humano",
    atribuidoId: operadorUid,
    atribuidoNome: operadorNome,
  });
}

export async function resolverConversa(conversationId: string, workspaceId = DEFAULT_WORKSPACE_ID): Promise<void> {
  const database = requireDb();
  const agora = new Date().toISOString();
  await updateDoc(doc(database, COLECAO_CONVERSAS, conversationId), {
    status: "resolvida" satisfies ConversationStatus,
    resolvidaEm: agora,
  });

  await registrarEventoAuditoriaSilencioso({
    tipo: "hitl.ticket.resolvido",
    recurso: `${COLECAO_CONVERSAS}/${conversationId}`,
    workspaceId,
    detalhes: { origem: "neural-inbox" },
  });
}
