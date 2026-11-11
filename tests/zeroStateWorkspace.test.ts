// Regressão do Zero-State do onboarding self-serve.
//
// Contexto: `prepareWorkspace`/`persistWorkspace` (`@/lib/firestore`) já
// nascem limpos hoje — nenhum seed automático de conversa ou fluxo fictício
// (ex.: "Salão da Mãe", que só existe em `@/lib/flowDemoData` como dado
// OPT-IN do botão "Preencher com Dados de Demonstração"). Este teste não
// corrige um bug: ele TRAVA o comportamento correto atual, para que uma
// mudança futura que volte a seedar dado fictício no onboarding quebre a
// suíte imediatamente, em vez de ser descoberta por um cliente real vendo
// "Salão da Mãe" no workspace dele.
//
// Mesmo Firestore falso minimalista de `tests/smokeCriticalFlow.test.ts`,
// estendido com `query`/`where`/`getDocs` reais sobre o mesmo mapa em
// memória — para que a asserção "nenhuma conversa/fluxo existe" consulte de
// fato as coleções `conversations`/`flows`, não apenas o documento do
// workspace.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NICHE_PRESETS } from "@/lib/niches";
import type { NicheKey } from "@/types";

interface RefFalsa {
  colecao: string;
  id: string;
}

interface ClausulaWhere {
  tipo: "where";
  campo: string;
  valor: unknown;
}

interface QueryFalsa {
  colecao: string;
  clausulas: ClausulaWhere[];
}

const banco = new Map<string, Record<string, unknown>>();

function chave(ref: RefFalsa): string {
  return `${ref.colecao}/${ref.id}`;
}

let contadorId = 0;
function gerarId(): string {
  contadorId += 1;
  return `fake-id-${contadorId}`;
}

vi.mock("@/lib/firebase", () => ({ db: {}, auth: undefined, storage: undefined }));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, colecao: string) => ({ colecao }),
  doc: (dbOuColecao: { colecao: string } | unknown, colecaoOuId?: string, id?: string) => {
    if (dbOuColecao && typeof dbOuColecao === "object" && "colecao" in dbOuColecao && colecaoOuId === undefined) {
      return { colecao: (dbOuColecao as { colecao: string }).colecao, id: gerarId() };
    }
    return { colecao: colecaoOuId as string, id: id as string };
  },
  setDoc: async (ref: RefFalsa, dados: Record<string, unknown>, opcoes?: { merge?: boolean }) => {
    const existente = banco.get(chave(ref));
    banco.set(chave(ref), opcoes?.merge ? { ...existente, ...dados } : dados);
  },
  addDoc: async (colecaoRef: { colecao: string }, dados: Record<string, unknown>) => {
    const ref = { colecao: colecaoRef.colecao, id: gerarId() };
    banco.set(chave(ref), dados);
    return ref;
  },
  getDoc: async (ref: RefFalsa) => {
    const dados = banco.get(chave(ref));
    return { exists: () => dados !== undefined, data: () => dados, id: ref.id };
  },
  updateDoc: async (ref: RefFalsa, patch: Record<string, unknown>) => {
    const existente = banco.get(chave(ref));
    banco.set(chave(ref), { ...existente, ...patch });
  },
  // Consulta real sobre o mesmo mapa `banco` — qualquer doc que viesse a ser
  // seedado em `conversations`/`flows` durante a criação do workspace
  // apareceria aqui, exatamente como apareceria numa consulta real.
  query: (colecaoRef: { colecao: string }, ...clausulas: ClausulaWhere[]): QueryFalsa => ({
    colecao: colecaoRef.colecao,
    clausulas,
  }),
  where: (campo: string, _operador: string, valor: unknown): ClausulaWhere => ({ tipo: "where", campo, valor }),
  orderBy: () => ({ tipo: "orderBy" }) as const,
  limit: () => ({ tipo: "limit" }) as const,
  getDocs: async (queryRef: QueryFalsa) => {
    const prefixo = `${queryRef.colecao}/`;
    const docs = [...banco.entries()]
      .filter(([k]) => k.startsWith(prefixo))
      .filter(([, dados]) => queryRef.clausulas.every((c) => dados[c.campo] === c.valor))
      .map(([k, dados]) => ({ id: k.slice(prefixo.length), data: () => dados }));
    return { docs, empty: docs.length === 0, size: docs.length };
  },
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(),
}));

describe("Zero-State: workspace recém-criado não carrega nenhum dado de demonstração", () => {
  beforeEach(() => {
    banco.clear();
    contadorId = 0;
  });

  it("não contém conversas, fluxos, nem texto hardcoded de demo (ex. 'Salão da Mãe') logo após a criação", async () => {
    const { prepareWorkspace, persistWorkspace, getWorkspace } = await import("@/lib/firestore");
    const { collection, getDocs, query, where } = await import("firebase/firestore");
    // O mock de `@/lib/firebase` devolve `{}` em runtime (ver `vi.mock` acima) —
    // o cast evita que o tipo real `Firestore | undefined` do módulo importado
    // exija um Firestore de verdade só para satisfazer o compilador neste teste.
    const db = (await import("@/lib/firebase")).db as unknown as Parameters<typeof collection>[0];

    const setor: NicheKey = "salao-beleza";
    const { ref, workspace } = prepareWorkspace("Workspace de Onboarding", setor, "uid-zero-state-001");
    await persistWorkspace(ref, workspace);

    const workspacePersistido = await getWorkspace(workspace.id);
    expect(workspacePersistido).not.toBeNull();

    // Só os campos esperados do zero-state — nenhum campo extra de conversa/fluxo embutido no próprio documento.
    expect(Object.keys(workspacePersistido!).sort()).toEqual(
      ["id", "nome", "donoUid", "setor", "criadoEm", "playbooksSugeridos"].sort()
    );

    // Nenhuma conversa real na Neural Inbox para este workspace.
    const conversasSnap = await getDocs(
      query(collection(db, "conversations"), where("workspaceId", "==", workspace.id))
    );
    expect(conversasSnap.empty).toBe(true);
    expect(conversasSnap.docs).toHaveLength(0);

    // Nenhum fluxo em Fluxos para este workspace.
    const flowsSnap = await getDocs(query(collection(db, "flows"), where("workspaceId", "==", workspace.id)));
    expect(flowsSnap.empty).toBe(true);
    expect(flowsSnap.docs).toHaveLength(0);

    // Nenhum texto hardcoded de dados de demonstração vazou para o documento real.
    const serializado = JSON.stringify(workspacePersistido);
    expect(serializado).not.toContain("Salão da Mãe");
    expect(serializado).not.toContain("Horizon BC");

    // `playbooksSugeridos` é só uma lista de NOMES sugeridos (texto de UI),
    // nunca objetos de conversa/fluxo prontos — reflexo do preset do nicho,
    // não um seed de dado fictício.
    expect(workspacePersistido!.playbooksSugeridos).toEqual(NICHE_PRESETS[setor].playbooksSugeridos);
    for (const playbook of workspacePersistido!.playbooksSugeridos ?? []) {
      expect(typeof playbook).toBe("string");
    }
  });
});
