// Motor de Memória Episódica e Contexto Multi-Canal — grafo relacional
// simplificado de interações cross-channel (WhatsApp, Instagram, Widget...).
//
// SERVER-ONLY.
//
// Problema real que resolve: hoje cada canal da Neural Inbox vive como uma
// `Conversation` isolada (`@/types` → `Conversation.canal`), sem nenhuma
// ligação entre "o mesmo cliente escreveu no WhatsApp ontem e hoje manda
// mensagem pelo Instagram". Sem essa ligação, o agente que responde no
// segundo canal começa do zero — repete perguntas já respondidas, perde o
// assunto em aberto, e o cliente sente que está falando com uma empresa
// amnésica a cada troca de canal.
//
// Este módulo NÃO inventa resolução de identidade — nunca tenta "adivinhar"
// que um handle do Instagram e um telefone do WhatsApp são a mesma pessoa por
// heurística difusa (isso violaria o Artigo IV da Constitution: No
// Invention). A correlação entre canais é SEMPRE explícita: quem chama
// `registrarInteracaoEpisodica` já resolveu `clienteId` por um meio concreto
// (identificador normalizado informado pelo próprio cliente, vínculo manual
// feito por um operador, etc.) — este módulo só INDEXA interações já
// correlacionadas, de forma que a leitura de volta seja O(1).
//
// Formato de grafo simplificado: um nó por cliente
// (`episodicMemoryNodes/{workspaceId}__{clienteId}`) carrega a lista de
// canais conhecidos (arestas) e uma janela rolante dos últimos episódios —
// nunca o histórico completo de mensagens. Isso é o que garante as duas
// propriedades pedidas:
//
//   1. Leitura em milissegundos: UM único `get()` de documento nomeado, sem
//      nenhuma query de agregação entre coleções/canais.
//   2. Payload de tokens contido: o resumo injetável no prompt
//      (`formatarResumoUnificado`) tem tamanho limitado por desenho (janela
//      rolante de `MAX_EPISODIOS_RECENTES`, cada resumo truncado) — nunca
//      cresce linearmente com o histórico do cliente.

import type { Transaction } from "firebase-admin/firestore";
import type { Canal, ConversionOutcome } from "@/types";
import { firestoreAdmin } from "./firebaseAdmin";

const COLECAO_NOS = "episodicMemoryNodes";

/** Janela rolante de episódios recentes guardados por cliente — define o teto do payload de tokens injetável no prompt. */
const MAX_EPISODIOS_RECENTES = 8;

/** Tamanho máximo do resumo curto de cada episódio, em caracteres — mesmo princípio de contenção de `MAX_EPISODIOS_RECENTES`. */
const MAX_CHARS_RESUMO_EPISODIO = 140;

const ROTULO_CANAL: Record<Canal, string> = {
  whatsapp: "WhatsApp",
  webchat: "Web Widget",
  instagram: "Instagram",
  facebook: "Facebook",
  email: "E-mail",
  sms: "SMS",
};

export interface EpisodioResumo {
  canal: Canal;
  conversationId: string;
  assunto: string;
  resumoCurto: string;
  desfechoConversao: ConversionOutcome | null;
  ocorridoEm: string;
}

/** Nó do grafo relacional simplificado: um cliente, com as arestas (canais conhecidos) e a janela rolante de episódios recentes. */
export interface NoClienteEpisodico {
  workspaceId: string;
  clienteId: string;
  canaisConhecidos: Canal[];
  totalInteracoes: number;
  ultimoCanal: Canal;
  ultimaInteracaoEm: string;
  episodiosRecentes: EpisodioResumo[];
  atualizadoEm: string;
}

export interface RegistrarInteracaoInput {
  workspaceId: string;
  /** Identidade já correlacionada entre canais pelo chamador — ver nota de "No Invention" no cabeçalho deste arquivo. */
  clienteId: string;
  canal: Canal;
  conversationId: string;
  assunto: string;
  resumoCurto: string;
  desfechoConversao?: ConversionOutcome | null;
}

function chaveNo(workspaceId: string, clienteId: string): string {
  return `${workspaceId}__${clienteId}`;
}

function truncar(texto: string, maxChars: number): string {
  const limpo = texto.trim();
  if (limpo.length <= maxChars) return limpo;
  return `${limpo.slice(0, maxChars - 1).trimEnd()}…`;
}

/**
 * Reducer puro: aplica uma nova interação ao estado atual do nó (ou cria um
 * nó novo, quando `noAtual` é `null`).
 *
 * Pura e 100% testável sem Firestore — mesmo padrão de separação já usado em
 * `executarTransacaoDeSelo` (`./auditChainStore`): a regra de negócio fica
 * isolada da transação que a persiste.
 */
export function aplicarInteracao(
  noAtual: NoClienteEpisodico | null,
  interacao: RegistrarInteracaoInput,
  ocorridoEmIso: string
): NoClienteEpisodico {
  const episodio: EpisodioResumo = {
    canal: interacao.canal,
    conversationId: interacao.conversationId,
    assunto: interacao.assunto,
    resumoCurto: truncar(interacao.resumoCurto, MAX_CHARS_RESUMO_EPISODIO),
    desfechoConversao: interacao.desfechoConversao ?? null,
    ocorridoEm: ocorridoEmIso,
  };

  const canaisAnteriores = noAtual?.canaisConhecidos ?? [];
  const canaisConhecidos = canaisAnteriores.includes(interacao.canal)
    ? canaisAnteriores
    : [...canaisAnteriores, interacao.canal];

  const episodiosRecentes = [episodio, ...(noAtual?.episodiosRecentes ?? [])].slice(
    0,
    MAX_EPISODIOS_RECENTES
  );

  return {
    workspaceId: interacao.workspaceId,
    clienteId: interacao.clienteId,
    canaisConhecidos,
    totalInteracoes: (noAtual?.totalInteracoes ?? 0) + 1,
    ultimoCanal: interacao.canal,
    ultimaInteracaoEm: ocorridoEmIso,
    episodiosRecentes,
    atualizadoEm: ocorridoEmIso,
  };
}

/** `true` quando o cliente já interagiu por mais de um canal — sinal direto de que a troca de canal é real, não hipotética. */
export function temContextoCrossChannel(no: NoClienteEpisodico): boolean {
  return no.canaisConhecidos.length > 1;
}

/**
 * Formata o resumo unificado injetável no prompt — texto curto e
 * determinístico, do mesmo jeito que `gerarContextoConversaoIA`
 * (`@/lib/inbox/conversionFeedback`) e `gerarContextoNicho`
 * (`@/lib/nichePrompts`): nunca a lista bruta de mensagens, sempre um resumo
 * de tamanho limitado — pronto para `montarPrompt` injetar sem inflar o
 * payload de tokens enviado ao modelo.
 */
export function formatarResumoUnificado(no: NoClienteEpisodico): string {
  const canais = no.canaisConhecidos.map((canal) => ROTULO_CANAL[canal]).join(", ");
  const linhas = [
    `Histórico cross-channel deste cliente: ${no.totalInteracoes} interação(ões) em ` +
      `${no.canaisConhecidos.length} canal(is) (${canais}). Último contato por ` +
      `${ROTULO_CANAL[no.ultimoCanal]} em ${no.ultimaInteracaoEm}.`,
  ];

  if (no.episodiosRecentes.length > 0) {
    linhas.push("Episódios recentes (mais novo primeiro):");
    for (const episodio of no.episodiosRecentes) {
      const desfecho = episodio.desfechoConversao ? ` [${episodio.desfechoConversao}]` : "";
      linhas.push(
        `- ${ROTULO_CANAL[episodio.canal]}: ${episodio.assunto} — ${episodio.resumoCurto}${desfecho}`
      );
    }
  }

  return linhas.join("\n");
}

/**
 * Corpo da transação, independente do Firestore real — recebe um objeto que
 * implementa apenas `get`/`set` (o subconjunto de `Transaction` que usa), o
 * que permite testá-lo com um dublê de teste sem Firestore nem emulador
 * (mesmo padrão de `executarTransacaoDeSelo`).
 */
export async function executarTransacaoDeInteracao(
  tx: Pick<Transaction, "get" | "set">,
  db: Pick<ReturnType<typeof firestoreAdmin>, "collection">,
  interacao: RegistrarInteracaoInput,
  ocorridoEmIso: string
): Promise<NoClienteEpisodico> {
  const ref = db.collection(COLECAO_NOS).doc(chaveNo(interacao.workspaceId, interacao.clienteId));
  const snap = await tx.get(ref);
  const noAtual = snap.exists ? (snap.data() as NoClienteEpisodico) : null;

  const noAtualizado = aplicarInteracao(noAtual, interacao, ocorridoEmIso);
  tx.set(ref, noAtualizado);
  return noAtualizado;
}

/**
 * Indexa uma nova interação no grafo do cliente, atomicamente — mesma
 * garantia de `selarEPersistirEntrada` (`./auditChainStore`): duas
 * interações concorrentes do mesmo cliente (ex.: mensagens quase
 * simultâneas em dois canais) nunca perdem uma atualização por corrida de
 * leitura.
 */
export async function registrarInteracaoEpisodica(
  interacao: RegistrarInteracaoInput,
  agora: Date = new Date()
): Promise<NoClienteEpisodico> {
  const db = firestoreAdmin();
  return db.runTransaction((tx) => executarTransacaoDeInteracao(tx, db, interacao, agora.toISOString()));
}

/**
 * Leitura rápida do resumo unificado — UM único `get()` de documento nomeado,
 * O(1) independentemente de quantas conversas o cliente tenha em quantos
 * canais. `null` quando o cliente ainda não tem nenhuma interação indexada
 * (nunca lança — ausência de histórico é um estado válido, não um erro).
 */
export async function obterResumoUnificadoCliente(
  workspaceId: string,
  clienteId: string
): Promise<string | null> {
  const no = await obterNoClienteEpisodico(workspaceId, clienteId);
  return no ? formatarResumoUnificado(no) : null;
}

/** Leitura do nó bruto — usado por rotas que precisam do objeto estruturado, não apenas do texto já formatado para prompt. */
export async function obterNoClienteEpisodico(
  workspaceId: string,
  clienteId: string
): Promise<NoClienteEpisodico | null> {
  const snap = await firestoreAdmin().collection(COLECAO_NOS).doc(chaveNo(workspaceId, clienteId)).get();
  return snap.exists ? (snap.data() as NoClienteEpisodico) : null;
}
