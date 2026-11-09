// Regressão do bug real reproduzido em produção: "Enviar como lead de teste
// para a Neural Inbox" falhava com "Não foi possível enviar para a Neural
// Inbox agora" assim que o payload de exemplo era enviado — mesmo o fluxo
// e o workspace estando configurados corretamente.
//
// Causa raiz: `registrarMensagemCliente` fazia uma consulta COMPOSTA
// (`where("remetente", "==", "cliente")` + `orderBy("enviadaEm", "desc")`)
// no histórico recente de mensagens do cliente, sem nenhum `try/catch` ao
// redor — e o projeto não tinha (até este commit) nenhum
// `firestore.indexes.json` declarando o índice composto que essa consulta
// exige. Um `FAILED_PRECONDITION: The query requires an index` do Firestore
// derrubava a mensagem INTEIRA, mesmo sendo apenas uma etapa de contexto
// (Radar de Sentimento), não o registro em si da mensagem.
//
// Este teste prova que uma falha nessa consulta específica NUNCA mais
// impede o registro da mensagem do cliente — ela degrada para "sem
// histórico recente" e segue adiante, igual às outras etapas resilientes
// já documentadas na mesma função.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface RefFalsa {
  colecao: string;
  id: string;
}

const banco = new Map<string, Record<string, unknown>>();

function chave(ref: RefFalsa): string {
  return `${ref.colecao}/${ref.id}`;
}

vi.mock("@/lib/firebase", () => ({ db: {}, auth: { currentUser: null }, storage: undefined }));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, colecao: string, ...resto: string[]) => ({
    colecao: resto.length > 0 ? `${colecao}/${resto.join("/")}` : colecao,
  }),
  // Formas reais usadas neste arquivo: `doc(database, "colA", "idA", "colB", "idB")`
  // (caminho completo a partir do database) e `doc(collectionRef, "id")`.
  doc: (primeiro: { colecao: string } | unknown, ...segmentos: string[]) => {
    if (primeiro && typeof primeiro === "object" && "colecao" in primeiro) {
      return { colecao: (primeiro as { colecao: string }).colecao, id: segmentos[0] };
    }
    const id = segmentos[segmentos.length - 1];
    const colecao = segmentos.slice(0, -1).join("/");
    return { colecao, id };
  },
  setDoc: async (ref: RefFalsa, dados: Record<string, unknown>) => {
    banco.set(chave(ref), dados);
  },
  getDoc: async (ref: RefFalsa) => {
    const dados = banco.get(chave(ref));
    return { exists: () => dados !== undefined, data: () => dados, id: ref.id };
  },
  updateDoc: async (ref: RefFalsa, patch: Record<string, unknown>) => {
    const existente = banco.get(chave(ref));
    banco.set(chave(ref), { ...existente, ...patch });
  },
  // Simula o Firestore real recusando a consulta composta por índice
  // ausente — exatamente o que aconteceu em produção.
  getDocs: async () => {
    throw new Error(
      "FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/..."
    );
  },
  query: (ref: unknown) => ref,
  where: () => undefined,
  orderBy: () => undefined,
  limit: () => undefined,
}));

describe("registrarMensagemCliente — resiliente a índice composto ausente", () => {
  beforeEach(() => {
    banco.clear();
  });

  it("registra a mensagem do cliente mesmo quando a consulta de histórico recente falha", async () => {
    const { registrarMensagemCliente } = await import("@/lib/inbox/firestore");

    const workspaceId = "ws-teste";
    const conversationId = "conv-teste";
    banco.set(`conversations/${conversationId}`, {
      id: conversationId,
      workspaceId,
      prioridade: "p3",
      totalMensagens: 0,
      totalMensagensCliente: 0,
      ultimaMensagemEm: new Date(0).toISOString(),
      circuitBreakerAtivo: false,
      atribuidoTipo: "nenhum",
      status: "aberta",
    });

    const resultado = await registrarMensagemCliente({
      conversationId,
      texto: "Olá, vocês têm horário pra sábado de manhã?",
      canal: "webchat",
      workspaceId,
    });

    expect(resultado.mensagem.texto).toContain("sábado");
    expect(resultado.circuitBreakerDisparadoAgora).toBe(false);

    const conversaAtualizada = banco.get(`conversations/${conversationId}`);
    expect(conversaAtualizada).toMatchObject({ totalMensagens: 1, totalMensagensCliente: 1 });
  });
});
