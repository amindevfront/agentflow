// Pipeline de ingestão do Web Widget Corporativo — SERVER-ONLY, Admin SDK.
//
// Mirror do subconjunto relevante de `@/lib/inbox/firestore.ts`
// (`criarConversa` + `registrarMensagemCliente`) para o ÚNICO canal que
// ingere mensagens de um VISITANTE ANÔNIMO, sem sessão Firebase — por isso
// não pode reaproveitar aquele módulo: ele assume `auth.currentUser` para
// selar o original via um POST autenticado a `/api/inbox/seal-message`.
// Aqui, já estando no servidor, a sela é feita diretamente via
// `selarSegredo`, sem round-trip HTTP.
//
// Reaproveita as mesmas peças PURAS do pipeline cliente — Shield-Layer
// (`interceptarMensagem`) e Radar de Sentimento (`calcularFrustration`) —
// para que uma mensagem do widget receba exatamente a mesma proteção e o
// mesmo Circuit Breaker que WhatsApp/webchat autenticado já têm. O que fica
// deliberadamente de fora desta primeira versão: detecção de Lead Alto
// Padrão (sinalização por nicho, não essencial para o canal funcionar) e
// entrada na trilha de auditoria (os próprios documentos de conversa/
// mensagem já são o registro; uma entrada de auditoria dedicada é reforço,
// não pré-requisito).

import type {
  Conversation,
  ConversationMessage,
  HandoffPriority,
  MessageSender,
  NicheKey,
} from "@/types";
import { interceptarMensagem } from "@/lib/guardrails/piiVault";
import { selarSegredo } from "@/lib/crypto/envelope";
import { LIMIAR_FRUSTRACAO_CRITICA, calcularFrustration } from "@/lib/sentiment/radar";
import { registrarInteracaoEpisodica } from "./episodicMemory";
import { firestoreAdmin } from "./firebaseAdmin";
import { abrirTransbordoAdmin } from "./hitlStore";
import { construirResumoExecutivoHandoff, detectarGatilhoAgendamentoVisita } from "./imobiliarioAltoPadrao";

const COLECAO_CONVERSAS = "conversations";
const SUBCOLECAO_MENSAGENS = "mensagens";
const COLECAO_VAULT_MENSAGENS = "messageVaults";
const COLECAO_CONECTORES = "connectors";
const COLECAO_WORKSPACES = "workspaces";

/** Nicho do Módulo Vertical 1 — ver `@/lib/server/imobiliarioAltoPadrao`. */
const NICHO_IMOBILIARIO: NicheKey = "construtora-imobiliaria";

/**
 * `true` quando o workspace está classificado no nicho Construtoras/
 * Imobiliárias de Alto Padrão — gate do Handoff com Resumo Executivo
 * Mastigado abaixo, para que outros nichos (e-commerce, salão de beleza)
 * não recebam um ticket inesperado só por mencionar a palavra "visita".
 * Best-effort: falha de leitura nunca impede o registro da mensagem em si,
 * apenas desativa esta funcionalidade adicional para esta chamada.
 */
async function workspaceEhImobiliarioAltoPadrao(workspaceId: string): Promise<boolean> {
  try {
    const snap = await firestoreAdmin().collection(COLECAO_WORKSPACES).doc(workspaceId).get();
    const setor = snap.exists ? (snap.data() as { setor?: unknown }).setor : undefined;
    return setor === NICHO_IMOBILIARIO;
  } catch (erro) {
    console.error(`[inbox/widget] falha ao ler o nicho do workspace ${workspaceId}:`, erro);
    return false;
  }
}

/** Mesmo rótulo usado em `src/app/(app)/connectors/page.tsx` — precisa coincidir exatamente para a checagem de opt-in abaixo. */
export const TIPO_CONECTOR_WIDGET = "Web Widget Corporativo (Embed)";

/** Espelha `SLA_RESPOSTA_SEGUNDOS` do lado cliente (`@/lib/inbox/firestore`). */
const SLA_RESPOSTA_SEGUNDOS: Record<HandoffPriority, number> = { p1: 60, p2: 180, p3: 600, p4: 1800 };

function novoId(prefixo: string): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefixo}_${aleatorio}`;
}

export class ErroWidgetNaoHabilitado extends Error {
  constructor(workspaceId: string) {
    super(`Workspace "${workspaceId}" não tem o Web Widget Corporativo habilitado em Canais & Integrações.`);
    this.name = "ErroWidgetNaoHabilitado";
  }
}

/**
 * `true` quando o workspace tem um conector do tipo Web Widget cadastrado —
 * prova de opt-in antes de aceitar escrita anônima de um visitante. Sem
 * verificação de origem (CORS) além disso: um widget embutido em qualquer
 * site é, por desenho, chamado de uma origem diferente da do AgentFlow, e
 * travar por `Origin` quebraria o caso de uso legítimo. A defesa real contra
 * abuso aqui é esta checagem + o limite de taxa da rota.
 */
async function widgetHabilitado(workspaceId: string): Promise<boolean> {
  const snap = await firestoreAdmin()
    .collection(COLECAO_CONECTORES)
    .where("workspaceId", "==", workspaceId)
    .where("tipo", "==", TIPO_CONECTOR_WIDGET)
    .limit(1)
    .get();
  return !snap.empty;
}

async function encontrarOuCriarConversa(workspaceId: string, visitorId: string): Promise<Conversation> {
  const colecao = firestoreAdmin().collection(COLECAO_CONVERSAS);
  const existente = await colecao
    .where("workspaceId", "==", workspaceId)
    .where("widgetVisitorId", "==", visitorId)
    .limit(1)
    .get();

  if (!existente.empty) {
    const doc = existente.docs[0];
    return { ...(doc.data() as Conversation), id: doc.id };
  }

  const agora = new Date().toISOString();
  const conversa: Conversation = {
    id: novoId("conv"),
    workspaceId,
    canal: "webchat",
    participante: {
      nome: "Visitante do site",
      identificadorMascarado: `widget:${visitorId.slice(0, 8)}…`,
    },
    assunto: "Contato via Web Widget",
    status: "aberta",
    prioridade: "p3",
    atribuidoTipo: "nenhum",
    frustrationIndex: 0,
    frustrationTendencia: "estavel",
    circuitBreakerAtivo: false,
    widgetVisitorId: visitorId,
    ultimaMensagemPreview: "",
    ultimaMensagemEm: agora,
    criadaEm: agora,
    totalMensagens: 0,
    totalMensagensCliente: 0,
  };

  await colecao.doc(conversa.id).set(conversa);
  return conversa;
}

export interface RegistrarMensagemWidgetInput {
  workspaceId: string;
  visitorId: string;
  texto: string;
}

export interface RegistrarMensagemWidgetResultado {
  conversationId: string;
  messageId: string;
  circuitBreakerAtivo: boolean;
}

/**
 * Ingesta uma mensagem do Web Widget — ponta real de
 * `POST /api/inbox/webhook/widget`.
 *
 * Lança `ErroWidgetNaoHabilitado` quando o workspace não tem o canal
 * habilitado — a rota traduz isso em HTTP 403, nunca em uma escrita que
 * aceita tráfego de um workspace que nunca optou pelo widget.
 */
export async function registrarMensagemWidgetAdmin(
  entrada: RegistrarMensagemWidgetInput
): Promise<RegistrarMensagemWidgetResultado> {
  if (!(await widgetHabilitado(entrada.workspaceId))) {
    throw new ErroWidgetNaoHabilitado(entrada.workspaceId);
  }

  const database = firestoreAdmin();
  const conversa = await encontrarOuCriarConversa(entrada.workspaceId, entrada.visitorId);
  const refConversa = database.collection(COLECAO_CONVERSAS).doc(conversa.id);

  // Shield-Layer: mascara antes de qualquer persistência — mesma garantia de `registrarMensagemCliente`.
  const { textoMascarado, piiDetectada, temPii } = interceptarMensagem(entrada.texto);

  const agora = new Date();
  const messageId = novoId("msg");

  let temVersaoOriginalSelada = false;
  if (temPii) {
    try {
      const envelope = await selarSegredo({
        plaintext: entrada.texto,
        workspaceId: entrada.workspaceId,
        recursoId: `${conversa.id}__${messageId}`,
        versao: 1,
        proposito: "mensagem-chat",
      });
      await database
        .collection(COLECAO_VAULT_MENSAGENS)
        .doc(`${conversa.id}__${messageId}`)
        .set({
          conversationId: conversa.id,
          messageId,
          workspaceId: entrada.workspaceId,
          envelope,
          criadoEm: agora.toISOString(),
        });
      temVersaoOriginalSelada = true;
    } catch (erro) {
      // Mesma degradação graciosa de `registrarMensagemCliente`: perder a
      // cópia selada não pode impedir a mensagem mascarada de ser registrada.
      console.error("[inbox/widget] falha ao selar o original — mensagem segue mascarada:", erro);
    }
  }

  const mensagem: ConversationMessage = {
    id: messageId,
    conversationId: conversa.id,
    workspaceId: entrada.workspaceId,
    canal: "webchat",
    remetente: "cliente",
    texto: textoMascarado,
    piiDetectada,
    enviadaEm: agora.toISOString(),
    temVersaoOriginalSelada,
  };
  await refConversa.collection(SUBCOLECAO_MENSAGENS).doc(messageId).set(mensagem);

  // Radar de Sentimento — mesmo histórico recente de mensagens do cliente usado no lado autenticado.
  const historicoSnap = await refConversa
    .collection(SUBCOLECAO_MENSAGENS)
    .where("remetente", "==", "cliente")
    .orderBy("enviadaEm", "desc")
    .limit(5)
    .get();
  const mensagensClienteRecentes = historicoSnap.docs
    .map((d) => (d.data() as ConversationMessage).texto)
    .reverse();

  const latenciaRespostaSegundos =
    conversa.ultimaMensagemRemetente === "cliente"
      ? (agora.getTime() - new Date(conversa.ultimaMensagemEm).getTime()) / 1000
      : undefined;
  const slaSegundos = SLA_RESPOSTA_SEGUNDOS[conversa.prioridade] ?? SLA_RESPOSTA_SEGUNDOS.p3;
  const frustration = calcularFrustration(
    { mensagensCliente: mensagensClienteRecentes, latenciaRespostaSegundos, slaRespostaSegundos: slaSegundos },
    LIMIAR_FRUSTRACAO_CRITICA
  );

  const circuitBreakerDisparadoAgora = frustration.circuitBreakerAtivado && !conversa.circuitBreakerAtivo;
  // SLA Rescue & Circuit Breaker — "congela o bot instantaneamente", mesmo racional do canal autenticado.
  const congelarBot = circuitBreakerDisparadoAgora && conversa.atribuidoTipo === "agente";

  await refConversa.update({
    ultimaMensagemPreview: textoMascarado.slice(0, 160),
    ultimaMensagemEm: agora.toISOString(),
    ultimaMensagemRemetente: "cliente" satisfies MessageSender,
    totalMensagens: conversa.totalMensagens + 1,
    totalMensagensCliente: conversa.totalMensagensCliente + 1,
    frustrationIndex: frustration.indice,
    frustrationTendencia: frustration.tendencia,
    circuitBreakerAtivo: frustration.circuitBreakerAtivado,
    status: conversa.status === "resolvida" ? "aberta" : conversa.status,
    ...(congelarBot ? { atribuidoTipo: "nenhum", atribuidoId: null, atribuidoNome: null } : {}),
  });

  // Motor de Memória Episódica e Contexto Multi-Canal: indexa esta interação
  // no grafo do cliente — `visitorId` é a MESMA identidade já usada acima
  // (`encontrarOuCriarConversa`) para correlacionar mensagens dentro deste
  // canal, nunca uma identidade nova inventada aqui. Best-effort: a mesma
  // degradação graciosa do selo do cofre acima — perder esta indexação nunca
  // pode impedir a mensagem em si de ser registrada.
  try {
    await registrarInteracaoEpisodica(
      {
        workspaceId: entrada.workspaceId,
        clienteId: entrada.visitorId,
        canal: "webchat",
        conversationId: conversa.id,
        assunto: conversa.assunto,
        resumoCurto: textoMascarado,
        desfechoConversao: conversa.desfechoConversao ?? null,
      },
      agora
    );
  } catch (erro) {
    console.error("[inbox/widget] falha ao indexar memória episódica:", erro);
  }

  if (circuitBreakerDisparadoAgora) {
    try {
      const ticket = await abrirTransbordoAdmin({
        solicitacao: {
          traceId: `widget_${messageId}`,
          politicaId: "padrao",
          severidade: "critica",
          veredito: "transbordo",
          violacoes: [
            {
              regra: "frustracao-critica",
              severidade: "critica",
              mensagem: `Índice de frustração em ${frustration.indice}/100 (Web Widget).`,
              score: frustration.indice / 100,
              limite: LIMIAR_FRUSTRACAO_CRITICA / 100,
            },
          ],
          payloadMascarado: textoMascarado,
        },
        flowId: conversa.id,
        flowNome: conversa.assunto,
        conversationId: conversa.id,
        motivoForcado: "frustracao-critica",
        workspaceId: entrada.workspaceId,
        criadoPor: "sistema",
      });
      await refConversa.update({ slaTicketId: ticket.id });
    } catch (erro) {
      console.error("[inbox/widget] falha ao abrir P1 de frustração crítica:", erro);
    }
  }

  // Handoff com Resumo Executivo Mastigado — Módulo Vertical 1
  // (Construtoras/Imobiliárias de Alto Padrão): o lead pediu para agendar
  // uma visita presencial. Gatilho positivo (nunca uma violação de
  // guardrail), restrito ao nicho para não surpreender outras verticais com
  // um ticket inesperado. `mensagensClienteRecentes` já foi lido acima para
  // o Radar de Sentimento — reaproveitado aqui, sem nova consulta.
  if (detectarGatilhoAgendamentoVisita(textoMascarado) && (await workspaceEhImobiliarioAltoPadrao(entrada.workspaceId))) {
    try {
      const resumoExecutivo = construirResumoExecutivoHandoff({
        nomeCliente: conversa.participante.nome,
        mensagensClienteRecentes: [...mensagensClienteRecentes, textoMascarado],
      });
      const ticket = await abrirTransbordoAdmin({
        solicitacao: {
          traceId: `widget_${messageId}`,
          politicaId: "padrao",
          severidade: "media",
          veredito: "transbordo",
          violacoes: [
            {
              regra: "agendamento-visita-presencial",
              severidade: "media",
              mensagem: "Lead solicitou agendamento de visita presencial — handoff com resumo executivo para o corretor.",
            },
          ],
          payloadMascarado: textoMascarado,
        },
        flowId: conversa.id,
        flowNome: conversa.assunto,
        conversationId: conversa.id,
        motivoForcado: "agendamento-visita-presencial",
        resumoExecutivo,
        workspaceId: entrada.workspaceId,
        criadoPor: "sistema",
      });
      await refConversa.update({ slaTicketId: ticket.id });
    } catch (erro) {
      console.error("[inbox/widget] falha ao abrir handoff de agendamento de visita presencial:", erro);
    }
  }

  return {
    conversationId: conversa.id,
    messageId,
    circuitBreakerAtivo: frustration.circuitBreakerAtivado,
  };
}
