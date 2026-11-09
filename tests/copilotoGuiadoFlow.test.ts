// E2E lógico do Modo Copiloto Guiado — Protocolo de estresse pedido pelo
// usuário: simular a jornada completa de um operador novato (conta zerada
// → nicho → Preenchimento Mágico → salvar Fluxo → Sandbox → Neural Inbox →
// Governança), encadeando as MESMAS funções reais que cada botão da tela
// chama — não um clique de verdade (este projeto não tem React Testing
// Library nem um browser disponível nesta sessão, ver `vitest.config.ts`:
// ambiente "node", sem DOM), mas a mesma classe de verificação do já
// existente `tests/smokeCriticalFlow.test.ts`: orquestração de dados entre
// módulos reais, com um Firestore falso minimalista só onde há escrita de
// verdade (`createFlow`).
//
// O que isto PEGA que um teste unitário isolado por módulo não pegaria:
// `obterExemploFluxo` devolvendo um `gatilho` que a validação do formulário
// rejeitaria, o payload de exemplo não tendo nenhuma chave que
// `extrairClienteSimulado` reconheça, ou a gaveta resolvida no Passo 1
// divergir entre o que a Neural Inbox injeta e o que a Governança usa pra
// decidir o que mostrar na aba Back-office.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { obterExemploFluxo } from "@/lib/flowDemoData";
import { extrairClienteSimulado } from "@/lib/payloadSimulatorInbox";
import { precisaConfigurarNicho } from "@/lib/governanceGuards";
import {
  construirTabelaPipelinePadrao,
  obterIdsModulosAtivos,
  obterModulo,
  obterModulosAtivos,
} from "@/modules/registry";
import { INBOX_EXTRAS_REGISTRY } from "@/modules/registry.client";
import { NICHE_ORDER } from "@/lib/niches";
import type { NicheKey, Workspace } from "@/types";

// ---------------------------------------------------------------------------
// Firestore falso minimalista — mesmo padrão de `tests/smokeCriticalFlow.test.ts`,
// só a superfície que `createFlow` toca.
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
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  serverTimestamp: vi.fn(),
}));

const WORKSPACE_ID = "ws-copiloto-e2e";

describe("E2E lógico: Copiloto Guiado — conta zerada até Inbox e Governança (Horizon BC)", () => {
  beforeEach(() => {
    banco.clear();
    contadorId = 0;
  });

  it("Passo 1 — nicho escolhido resolve a MESMA gaveta que a Neural Inbox injeta", () => {
    const workspace: Pick<Workspace, "setor" | "modulosAtivos"> = { setor: "construtora-imobiliaria" };
    const ids = obterIdsModulosAtivos(workspace);
    expect(ids).toEqual(["construtora-imobiliaria"]);

    const modulo = obterModulo(ids[0]);
    expect(modulo?.nome).toBe("Construtoras & Imobiliárias de Alto Padrão");
    expect(modulo?.temInboxExtras).toBe(true);

    // Mesma leitura que `NeuralInbox.tsx` faz via `obterInboxExtras` —
    // conferir a chave diretamente prova que as duas telas nunca divergem,
    // porque são o mesmo registro.
    expect(INBOX_EXTRAS_REGISTRY["construtora-imobiliaria"]).toBeDefined();
  });

  it("Passo 2 — Preenchimento Mágico gera dados válidos, e Salvar persiste o fluxo 'Horizon BC' com workspaceId propagado", async () => {
    const exemplo = obterExemploFluxo("construtora-imobiliaria");
    expect(exemplo.nomeFluxo).toContain("Horizon BC");
    expect(exemplo.nomeFluxo.trim().length).toBeGreaterThanOrEqual(3); // mesma regra de `FlowSettingsForm` (mín. 3 caracteres)

    const { createFlow } = await import("@/lib/firestore");

    const flowId = await createFlow(WORKSPACE_ID, {
      nome: exemplo.nomeFluxo,
      gatilho: exemplo.gatilho,
      origem: exemplo.origem,
      // Mesmo endpoint de teste que o botão "usar URL de teste" preenche —
      // obrigatório porque o exemplo usa gatilho "webhook".
      webhookUrl: "https://agentflow-black.vercel.app/api/webhook",
      status: "ocioso",
      steps: [{ id: "etapa-1", titulo: "Receber gatilho" }],
    });

    const persistido = banco.get(`flows/${flowId}`);
    expect(persistido).toMatchObject({
      nome: exemplo.nomeFluxo,
      gatilho: "webhook",
      workspaceId: WORKSPACE_ID,
      status: "ocioso",
    });
  });

  it("Passo 3 — payload de exemplo do Sandbox é EXATAMENTE o que a Neural Inbox extrai como lead", () => {
    const exemplo = obterExemploFluxo("construtora-imobiliaria");

    // "✨ Simular payload de exemplo" preenche a textarea com isto:
    const textoDaTextarea = JSON.stringify(exemplo.payloadExemplo, null, 2);
    // "Executar teste" faz isto:
    const payloadValidado = JSON.parse(textoDaTextarea);
    // "Enviar como lead de teste para a Neural Inbox" faz isto:
    const lead = extrairClienteSimulado(payloadValidado);

    expect(lead.nome).toBe(exemplo.payloadExemplo.nome);
    expect(lead.texto).toBe(exemplo.payloadExemplo.texto);
    expect(lead.nome).toBe("Marina Castello");
  });

  it("Passo 4 — a gaveta do Passo 1 participa do Pipeline de Governança, e gavetas de back-office continuam corretamente ausentes (sem toggle extra)", () => {
    const idsAtivos = obterIdsModulosAtivos({ setor: "construtora-imobiliaria" });

    // Oportunidade & Pipeline (Governança): mesma tabela que `roiDashboard.ts` usa.
    const tabela = construirTabelaPipelinePadrao(idsAtivos);
    expect(tabela["construtora-imobiliaria"]).toBeGreaterThan(0);

    // Aba Back-office (Governança): real-estate não é uma gaveta de
    // back-office — ausência aqui é o comportamento CORRETO, não uma lacuna.
    expect(idsAtivos.includes("document-ai-vault")).toBe(false);
    expect(idsAtivos.includes("ar-recovery-engine")).toBe(false);
  });

  it("Settings → Governança: ligar uma gaveta extra em 'Gavetas extras' é visto IDENTICAMENTE pela aba Back-office", () => {
    // Mesmo patch que `handleToggleGaveta` (Configurações) grava quando o
    // operador liga o interruptor "Document AI Vault".
    const workspaceComExtra: Pick<Workspace, "setor" | "modulosAtivos"> = {
      setor: "construtora-imobiliaria",
      modulosAtivos: ["construtora-imobiliaria", "document-ai-vault"],
    };

    const idsAtivos = obterIdsModulosAtivos(workspaceComExtra);
    // Exatamente a expressão que `GovernancePage` usa para decidir se mostra
    // o painel de verdade ou o atalho pra Configurações.
    const documentAiVaultAtivo = idsAtivos.includes("document-ai-vault");
    expect(documentAiVaultAtivo).toBe(true);

    const modulos = obterModulosAtivos(workspaceComExtra);
    expect(modulos.map((m) => m.id)).toEqual(["construtora-imobiliaria", "document-ai-vault"]);
  });

  it("Regressão do bug real (HTTP 500/'Nicho ainda não configurado'): conta zerada pulando direto para Governança, sem passar por Configurações, nunca quebra — só pede para voltar", () => {
    // Nenhum `setor` ainda — exatamente quem pula o Passo 1 e vai direto
    // para a Governança por URL, com `pendingSync` já resolvido (não é mais
    // uma gravação em voo, é ausência real de configuração).
    const workspaceSemNicho: Pick<Workspace, "setor" | "modulosAtivos"> = {};

    // Guia de 4 Passos: o aviso único de "volte para Configurações" dispara.
    expect(
      precisaConfigurarNicho({ pendingSync: false, workspaceCarregando: false, workspace: workspaceSemNicho })
    ).toBe(true);

    // Nenhum painel por baixo lança: back-office cai para "desligado" (nunca
    // acessa `NICHE_PRESETS[undefined]`), e a tabela de pipeline não tem
    // nenhuma gaveta ativa para somar.
    const idsAtivos = obterIdsModulosAtivos(workspaceSemNicho);
    expect(idsAtivos).toEqual([]);
    expect(() => construirTabelaPipelinePadrao(idsAtivos)).not.toThrow();

    // Enquanto a mesma ausência de `setor` é só a confirmação da gravação
    // otimista ainda em voo (ver `prepareWorkspace`/`persistWorkspace`), o
    // aviso NÃO dispara — essa é a causa raiz real do bug, e o utilitário
    // precisa distinguir os dois casos.
    expect(
      precisaConfigurarNicho({ pendingSync: true, workspaceCarregando: false, workspace: workspaceSemNicho })
    ).toBe(false);
  });

  it("o mesmo roteiro funciona para QUALQUER nicho de indústria, não só Horizon BC — Preenchimento Mágico nunca devolve um exemplo inválido", () => {
    for (const setor of NICHE_ORDER) {
      const exemplo = obterExemploFluxo(setor as NicheKey);
      expect(exemplo.nomeFluxo.trim().length).toBeGreaterThanOrEqual(3);
      const temCampoReconhecido = ["nome", "name", "texto", "message"].some((chave) => chave in exemplo.payloadExemplo);
      expect(temCampoReconhecido).toBe(true);
    }
  });
});
