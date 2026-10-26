// Smoke test do fluxo crítico de ponta a ponta — Registro → Onboarding →
// Criação de Workspace → Inicialização de Conectores (ver ADR-0005, item 3).
//
// Escopo honesto: isto valida a ORQUESTRAÇÃO DE DADOS entre os módulos reais
// do produto (validação Zod, sanitização, geração de id, propagação de
// workspaceId) usando um Firestore falso minimalista — NÃO é um teste de UI
// (exigiria React Testing Library, que este projeto não usa — todos os
// testes aqui são de lógica pura, sem DOM, ver `vitest.config.ts`) nem valida
// `firestore.rules` (ver `tests/firestoreRulesAudit.test.ts`) nem o
// comportamento real do SDK do Firestore (ver nota sobre o emulador exigir
// JDK 11+ na ADR-0005). O que ele PEGA: uma regressão em que a sanitização
// deixa de ser aplicada, um conector/fluxo criado sem `workspaceId`, ou o
// onboarding parando de propagar o nicho escolhido para os playbooks
// sugeridos — exatamente a classe de bug que um teste de unidade isolado por
// módulo não pegaria, porque cada módulo isoladamente "funciona".

import { beforeEach, describe, expect, it, vi } from "vitest";
import { signupSchema } from "@/lib/validation/schemas";
import { NICHE_PRESETS } from "@/lib/niches";
import type { NicheKey } from "@/types";

// ---------------------------------------------------------------------------
// Firestore falso minimalista — só a superfície que este fluxo toca.
// ---------------------------------------------------------------------------

interface RefFalsa {
  colecao: string;
  id: string;
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
    // `doc(collectionRef)` — gera um id novo, sem gravar nada (ver prepareWorkspace).
    if (dbOuColecao && typeof dbOuColecao === "object" && "colecao" in dbOuColecao && colecaoOuId === undefined) {
      return { colecao: (dbOuColecao as { colecao: string }).colecao, id: gerarId() };
    }
    // `doc(database, "colecao", "id")`.
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
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  serverTimestamp: vi.fn(),
}));

describe("smoke: fluxo crítico Registro -> Onboarding -> Workspace -> Conector", () => {
  beforeEach(() => {
    banco.clear();
    contadorId = 0;
  });

  it("produz documentos consistentes e sanitizados em cada etapa, com workspaceId propagado", async () => {
    // Timeout maior que o padrão (5s): a primeira sanitização do teste paga
    // o cold-start do jsdom usado por `isomorphic-dompurify` em Node — ver
    // src/lib/sanitize.ts.
    // 1. Registro — o payload que a tela de signup validaria antes de chamar o Firebase Auth.
    const payloadSignup = { email: "  Operador@Exemplo.COM  ", password: "Agentflow#2026" };
    const validado = signupSchema.safeParse(payloadSignup);
    expect(validado.success).toBe(true);
    if (!validado.success) return;

    const uid = "uid-smoke-001";

    // 2 + 3. Onboarding -> Criação de Workspace (ver src/app/onboarding/page.tsx).
    const { prepareWorkspace, persistWorkspace, upsertAppUser, getWorkspace, getAppUser, createConnector } =
      await import("@/lib/firestore");

    const setor: NicheKey = "logistica-portuaria";
    const { ref, workspace } = prepareWorkspace("  <b>Porto</b> Horizonte  ", setor);

    // A sanitização (ver src/lib/sanitize.ts) já deve ter agido dentro de prepareWorkspace.
    expect(workspace.nome).toBe("Porto Horizonte");
    expect(workspace.playbooksSugeridos).toEqual(NICHE_PRESETS[setor].playbooksSugeridos);

    await persistWorkspace(ref, workspace);
    await upsertAppUser({
      uid,
      nome: "Operador de Teste",
      email: validado.data.email,
      papel: "admin",
      workspaceId: workspace.id,
    });

    const workspacePersistido = await getWorkspace(workspace.id);
    const appUserPersistido = await getAppUser(uid);

    expect(workspacePersistido?.id).toBe(workspace.id);
    expect(workspacePersistido?.nome).toBe("Porto Horizonte");
    expect(appUserPersistido?.workspaceId).toBe(workspace.id);

    // 4. Inicialização de conector — precisa do MESMO workspaceId do passo anterior.
    const conectorId = await createConnector(workspace.id, {
      nome: "<script>alert(1)</script>Webhook de carga",
      tipo: "Webhook",
      status: "nao-configurado",
    });

    const conectorPersistido = banco.get(`connectors/${conectorId}`);
    expect(conectorPersistido).toMatchObject({
      nome: "Webhook de carga",
      tipo: "Webhook",
      status: "nao-configurado",
      workspaceId: workspace.id,
    });
  }, 15000);

  it("rejeita um signup com senha fraca ANTES de qualquer escrita (nenhum workspace deve existir)", () => {
    const resultado = signupSchema.safeParse({ email: "operador@exemplo.com", password: "123" });
    expect(resultado.success).toBe(false);
    expect(banco.size).toBe(0);
  });
});
