// `processarTickArRecoveryEngine` (`@/lib/server/arRecoveryEngine`) — o
// wrapper de IO (Admin SDK) em torno do núcleo puro já coberto por
// `tests/arRecoveryEngine.test.ts` (que testa só `decidirProximaAcaoCobranca`
// e companhia, nunca este wrapper).
//
// Cobre especificamente a proteção contra duplo-efeito sob execução
// concorrente do tick (cron duplicado / retry da Vercel): cada documento é
// reivindicado numa transação que RELÊ o status atual antes de aplicar
// cobrança/escalonamento — se, entre a varredura e a transação, outra
// execução já avançou o status deste documento, esta reivindicação falha e
// o efeito (crédito de ROI / ticket HITL) nunca roda duas vezes para o
// mesmo documento.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentoPendente } from "@/types";

interface RefFalsa {
  _caminho: string;
  get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
  update: (patch: Record<string, unknown>) => Promise<void>;
}

const armazenamento = new Map<string, Record<string, unknown>>();
// Permite simular que, no instante em que a transação relê o documento, uma
// execução CONCORRENTE já mudou o estado — a varredura inicial
// (`where status in [...]`) já tinha capturado o valor antigo antes dessa
// mudança, exatamente a janela de corrida que o tick precisa fechar. Um
// patch arbitrário (não só `status`) porque a corrida mais sutil deste
// motor é `tentativasCobranca` avançar com o `status` continuando
// `em-cobranca` (ver teste "corrida: segunda cobrança...").
const patchDivergenteNaTransacao = new Map<string, Record<string, unknown>>();

function refPara(caminho: string): RefFalsa {
  return {
    _caminho: caminho,
    get: async () => {
      const divergente = patchDivergenteNaTransacao.get(caminho);
      const dados = armazenamento.get(caminho);
      if (dados === undefined) return { exists: false, data: () => undefined };
      return { exists: true, data: () => (divergente ? { ...dados, ...divergente } : dados) };
    },
    update: async (patch: Record<string, unknown>) => {
      const atual = armazenamento.get(caminho) ?? {};
      armazenamento.set(caminho, { ...atual, ...patch });
    },
  };
}

function criarDbFalso() {
  return {
    collection: (nome: string) => ({
      doc: (id: string) => refPara(`${nome}/${id}`),
      where: (_campo: string, _op: string, _valor: unknown) => ({
        where: () => ({
          get: async () => {
            const docs = [...armazenamento.entries()]
              .filter(([chave]) => chave.startsWith(`${nome}/`) && !chave.slice(nome.length + 1).includes("/"))
              .map(([chave, dados]) => ({ id: chave.slice(nome.length + 1), data: () => dados }));
            return { docs, size: docs.length, empty: docs.length === 0 };
          },
        }),
      }),
    }),
    runTransaction: async <T>(fn: (tx: { get: (ref: RefFalsa) => ReturnType<RefFalsa["get"]>; update: (ref: RefFalsa, patch: Record<string, unknown>) => void }) => Promise<T>) =>
      fn({
        get: (ref) => ref.get(),
        update: (ref, patch) => {
          const atual = armazenamento.get(ref._caminho) ?? {};
          armazenamento.set(ref._caminho, { ...atual, ...patch });
        },
      }),
  };
}

vi.mock("@/lib/server/firebaseAdmin", () => ({
  firestoreAdmin: () => criarDbFalso(),
}));

const mockGanhoOperacional = vi.fn(async () => ({}) as never);
const mockAbrirTransbordo = vi.fn(async () => ({ id: "ticket-1" }) as never);

vi.mock("@/lib/server/backOfficeRoi", () => ({
  registrarGanhoOperacionalAdmin: mockGanhoOperacional,
}));
vi.mock("@/lib/server/hitlStore", () => ({
  abrirTransbordoAdmin: mockAbrirTransbordo,
}));

function documentoPendente(parcial: Partial<DocumentoPendente> = {}): DocumentoPendente {
  return {
    id: "doc-1",
    workspaceId: "ws-a",
    tipo: "fatura",
    referencia: "NF-1001",
    devedorNome: "Maria",
    devedorContato: null,
    valorBrl: null,
    vencimentoEm: "2026-01-01T00:00:00.000Z",
    status: "pendente",
    tentativasCobranca: 0,
    ultimaCobrancaEm: null,
    criadoEm: "2026-01-01T00:00:00.000Z",
    ...parcial,
  };
}

const REFERENCIA = new Date("2026-03-15T12:00:00.000Z"); // bem depois do vencimento — gera "enviar-cobranca"

describe("processarTickArRecoveryEngine", () => {
  beforeEach(() => {
    armazenamento.clear();
    patchDivergenteNaTransacao.clear();
    mockGanhoOperacional.mockClear();
    mockAbrirTransbordo.mockClear();
  });

  it("aplica a cobrança e credita o ROI uma única vez no caminho normal", async () => {
    armazenamento.set("documentosPendentes/doc-1", documentoPendente() as unknown as Record<string, unknown>);
    const { processarTickArRecoveryEngine } = await import("@/lib/server/arRecoveryEngine");

    const resultado = await processarTickArRecoveryEngine("ws-a", { referencia: REFERENCIA });

    expect(resultado.cobrancasEnviadas).toBe(1);
    expect(mockGanhoOperacional).toHaveBeenCalledTimes(1);
    expect(armazenamento.get("documentosPendentes/doc-1")?.status).toBe("em-cobranca");
  });

  it("corrida: se o status já mudou entre a varredura e a transação (execução concorrente do tick), não repete o efeito", async () => {
    armazenamento.set("documentosPendentes/doc-1", documentoPendente() as unknown as Record<string, unknown>);
    // Simula que, no instante em que ESTA execução tenta reivindicar o
    // documento, uma execução concorrente já o moveu para "em-cobranca".
    patchDivergenteNaTransacao.set("documentosPendentes/doc-1", { status: "em-cobranca", tentativasCobranca: 1 });

    const { processarTickArRecoveryEngine } = await import("@/lib/server/arRecoveryEngine");
    const resultado = await processarTickArRecoveryEngine("ws-a", { referencia: REFERENCIA });

    expect(resultado.cobrancasEnviadas).toBe(0);
    expect(mockGanhoOperacional).not.toHaveBeenCalled();
    // Nenhuma escrita desta execução chega ao documento — ela desiste assim
    // que a transação relê um estado diferente do que a varredura capturou.
    expect(armazenamento.get("documentosPendentes/doc-1")?.status).toBe("pendente");
  });

  it("corrida: segunda cobrança concorrente para o MESMO documento já `em-cobranca` (status não muda, só tentativasCobranca) não dobra o efeito", async () => {
    // Bug real corrigido: a guarda antiga comparava só `status`, que não
    // muda entre lembretes sucessivos — só `tentativasCobranca` muda. Duas
    // execuções do tick vendo o mesmo documento `em-cobranca` na varredura
    // passavam as duas pela guarda antiga.
    armazenamento.set(
      "documentosPendentes/doc-1",
      documentoPendente({ status: "em-cobranca", tentativasCobranca: 1 }) as unknown as Record<string, unknown>
    );
    // Simula que, no instante em que ESTA execução tenta reivindicar o
    // documento, uma execução concorrente já enviou o lembrete seguinte —
    // MESMO status (`em-cobranca`), só `tentativasCobranca` avançou.
    patchDivergenteNaTransacao.set("documentosPendentes/doc-1", {
      tentativasCobranca: 2,
      ultimaCobrancaEm: "2026-03-15T11:00:00.000Z",
    });

    const { processarTickArRecoveryEngine } = await import("@/lib/server/arRecoveryEngine");
    const resultado = await processarTickArRecoveryEngine("ws-a", { referencia: REFERENCIA });

    expect(resultado.cobrancasEnviadas).toBe(0);
    expect(mockGanhoOperacional).not.toHaveBeenCalled();
    // Nenhuma escrita desta execução chega ao documento — ela desiste assim
    // que a transação relê `tentativasCobranca` diferente do que a
    // varredura capturou (o fake simula a leitura divergente da
    // concorrente; a escrita real de QUEM ganhou a corrida não é desta
    // execução, então `armazenamento` continua no valor pré-corrida).
    expect(armazenamento.get("documentosPendentes/doc-1")?.tentativasCobranca).toBe(1);
  });

  it("escalonamento humano também respeita a mesma proteção contra corrida", async () => {
    armazenamento.set(
      "documentosPendentes/doc-1",
      documentoPendente({ tentativasCobranca: 10, status: "em-cobranca" }) as unknown as Record<string, unknown>
    );
    patchDivergenteNaTransacao.set("documentosPendentes/doc-1", { status: "escalado" });

    const { processarTickArRecoveryEngine } = await import("@/lib/server/arRecoveryEngine");
    const resultado = await processarTickArRecoveryEngine("ws-a", { referencia: REFERENCIA });

    expect(resultado.escalonamentosAbertos).toBe(0);
    expect(mockAbrirTransbordo).not.toHaveBeenCalled();
  });
});
