// `processarTickSpotDriverOnboardingAdmin` (`@/lib/server/spotDriverOnboardingAdmin`) —
// o wrapper de IO (Admin SDK) em torno do núcleo puro já coberto por
// `tests/spotDriverOnboarding.test.ts` (que testa só `decidirProximaAcaoOnboardingSpot`
// e companhia, nunca este wrapper).
//
// Cobre duas garantias:
//
// 1. Proteção contra duplo-efeito sob execução concorrente do tick (cron
//    duplicado / retry da Vercel) — mesmo racional de
//    `tests/arRecoveryEngineTick.test.ts`: cada dossiê é reivindicado numa
//    transação que RELÊ `documentos`/`ticketAbertoEm`/`aprovadoEm` antes de
//    abrir o ticket HITL/creditar ROI.
// 2. RECÁLCULO de `status`/`pendencias` a partir dos `documentos` e da
//    referência do tick, nunca confiando no `status` persistido no último
//    write do cliente — uma CNH/ANTT pode vencer só pelo tempo passar entre
//    um tick e o outro, sem que ninguém tenha editado o dossiê. Sem esse
//    recálculo, um dossiê que ficou `verde` poderia ser aprovado por um
//    humano dias depois com a CNH já vencida.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentoMotoristaSpot, DossieMotoristaSpot } from "@/types";

interface RefFalsa {
  _caminho: string;
  get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
  update: (patch: Record<string, unknown>) => Promise<void>;
}

const armazenamento = new Map<string, Record<string, unknown>>();
// Permite simular que, no instante em que a transação relê o dossiê, uma
// execução CONCORRENTE já o reivindicou (ticketAbertoEm preenchido) — a
// varredura inicial já tinha capturado o estado antigo antes dessa mudança.
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
        get: async () => {
          const docs = [...armazenamento.entries()]
            .filter(([chave]) => chave.startsWith(`${nome}/`) && !chave.slice(nome.length + 1).includes("/"))
            .map(([chave, dados]) => ({ id: chave.slice(nome.length + 1), data: () => dados }));
          return { docs, size: docs.length, empty: docs.length === 0 };
        },
      }),
    }),
    runTransaction: async <T>(
      fn: (tx: { get: (ref: RefFalsa) => ReturnType<RefFalsa["get"]>; update: (ref: RefFalsa, patch: Record<string, unknown>) => void }) => Promise<T>
    ) =>
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

const REFERENCIA = new Date("2026-03-15T12:00:00.000Z");
const DIA_MS = 24 * 60 * 60 * 1000;

function documento(parcial: Partial<DocumentoMotoristaSpot>): DocumentoMotoristaSpot {
  return { tipo: "cnh", status: "pendente", validadeEm: null, motivoInvalido: null, recebidoEm: null, ...parcial };
}

/** Os quatro documentos obrigatórios, todos válidos na `REFERENCIA` — dossiê avalia para `verde`. */
function documentosValidos(): DocumentoMotoristaSpot[] {
  return [
    documento({ tipo: "cnh", status: "recebido", validadeEm: new Date(REFERENCIA.getTime() + 30 * DIA_MS).toISOString() }),
    documento({ tipo: "crlv", status: "recebido" }),
    documento({ tipo: "antt", status: "recebido", validadeEm: new Date(REFERENCIA.getTime() + 30 * DIA_MS).toISOString() }),
    documento({ tipo: "comprovante-residencia", status: "recebido" }),
  ];
}

/** Mesmos quatro documentos, mas a CNH já venceu na `REFERENCIA` — dossiê avalia para `vermelho`. */
function documentosComCnhVencida(): DocumentoMotoristaSpot[] {
  return documentosValidos().map((d) =>
    d.tipo === "cnh" ? { ...d, validadeEm: new Date(REFERENCIA.getTime() - 5 * DIA_MS).toISOString() } : d
  );
}

function dossie(parcial: Partial<DossieMotoristaSpot> = {}): DossieMotoristaSpot {
  return {
    id: "motorista-1",
    workspaceId: "ws-a",
    nomeMotorista: "João",
    placaVeiculo: "ABC1D23",
    documentos: [],
    status: "amarelo",
    pendencias: [],
    ticketAbertoEm: null,
    criadoEm: "2026-01-01T00:00:00.000Z",
    atualizadoEm: "2026-01-01T00:00:00.000Z",
    aprovadoEm: null,
    ...parcial,
  };
}

describe("processarTickSpotDriverOnboardingAdmin", () => {
  beforeEach(() => {
    armazenamento.clear();
    patchDivergenteNaTransacao.clear();
    mockGanhoOperacional.mockClear();
    mockAbrirTransbordo.mockClear();
  });

  it("escala documentação irregular e abre o ticket HITL uma única vez no caminho normal", async () => {
    armazenamento.set(
      "motoristasSpot/motorista-1",
      dossie({ documentos: documentosComCnhVencida(), status: "amarelo" }) as unknown as Record<string, unknown>
    );
    const { processarTickSpotDriverOnboardingAdmin } = await import("@/lib/server/spotDriverOnboardingAdmin");

    const resultado = await processarTickSpotDriverOnboardingAdmin("ws-a", { referencia: REFERENCIA });

    expect(resultado.escalonamentosAbertos).toBe(1);
    expect(resultado.aprovacoesPendentesAbertas).toBe(0);
    expect(mockAbrirTransbordo).toHaveBeenCalledTimes(1);
    expect(mockGanhoOperacional).not.toHaveBeenCalled();
    const persistido = armazenamento.get("motoristasSpot/motorista-1");
    expect(persistido?.status).toBe("vermelho");
    expect(persistido?.ticketAbertoEm).toBe(REFERENCIA.toISOString());
  });

  it("abre aprovação pendente e credita ROI quando os documentos avaliam para verde", async () => {
    armazenamento.set(
      "motoristasSpot/motorista-1",
      dossie({ documentos: documentosValidos(), status: "amarelo" }) as unknown as Record<string, unknown>
    );
    const { processarTickSpotDriverOnboardingAdmin } = await import("@/lib/server/spotDriverOnboardingAdmin");

    const resultado = await processarTickSpotDriverOnboardingAdmin("ws-a", { referencia: REFERENCIA });

    expect(resultado.aprovacoesPendentesAbertas).toBe(1);
    expect(mockAbrirTransbordo).toHaveBeenCalledTimes(1);
    expect(mockGanhoOperacional).toHaveBeenCalledTimes(1);
    expect(armazenamento.get("motoristasSpot/motorista-1")?.status).toBe("verde");
  });

  it("nunca processa dossiê já aprovado, mesmo com documentos vencidos", async () => {
    armazenamento.set(
      "motoristasSpot/motorista-1",
      dossie({
        documentos: documentosComCnhVencida(),
        status: "verde",
        aprovadoEm: "2026-02-01T00:00:00.000Z",
      }) as unknown as Record<string, unknown>
    );
    const { processarTickSpotDriverOnboardingAdmin } = await import("@/lib/server/spotDriverOnboardingAdmin");

    const resultado = await processarTickSpotDriverOnboardingAdmin("ws-a", { referencia: REFERENCIA });

    expect(resultado.escalonamentosAbertos).toBe(0);
    expect(resultado.aprovacoesPendentesAbertas).toBe(0);
    expect(mockAbrirTransbordo).not.toHaveBeenCalled();
  });

  it("corrida: se outra execução já reivindicou o dossiê entre a varredura e a transação, não repete o efeito", async () => {
    armazenamento.set(
      "motoristasSpot/motorista-1",
      dossie({ documentos: documentosValidos(), status: "verde" }) as unknown as Record<string, unknown>
    );
    // Simula que, no instante em que ESTA execução tenta reivindicar o
    // dossiê, uma execução concorrente já marcou `ticketAbertoEm` para a
    // MESMA transição (status continua `verde`).
    patchDivergenteNaTransacao.set("motoristasSpot/motorista-1", { ticketAbertoEm: "2026-03-15T11:59:00.000Z" });

    const { processarTickSpotDriverOnboardingAdmin } = await import("@/lib/server/spotDriverOnboardingAdmin");
    const resultado = await processarTickSpotDriverOnboardingAdmin("ws-a", { referencia: REFERENCIA });

    expect(resultado.aprovacoesPendentesAbertas).toBe(0);
    expect(mockAbrirTransbordo).not.toHaveBeenCalled();
    expect(mockGanhoOperacional).not.toHaveBeenCalled();
  });

  it("detecta uma CNH vencida só pela passagem do tempo, mesmo sem nenhuma edição do dossiê — nunca libera frota com documentação vencida silenciosamente", async () => {
    // Estado persistido por um tick ANTERIOR, quando a CNH ainda era válida:
    // status `verde`, ticket de aprovação já aberto, ninguém decidiu ainda.
    // Entre aquele tick e este, a CNH venceu — SEM nenhum write do cliente.
    armazenamento.set(
      "motoristasSpot/motorista-1",
      dossie({
        documentos: documentosComCnhVencida(),
        status: "verde",
        ticketAbertoEm: "2026-03-01T00:00:00.000Z",
      }) as unknown as Record<string, unknown>
    );

    const { processarTickSpotDriverOnboardingAdmin } = await import("@/lib/server/spotDriverOnboardingAdmin");
    const resultado = await processarTickSpotDriverOnboardingAdmin("ws-a", { referencia: REFERENCIA });

    expect(resultado.escalonamentosAbertos).toBe(1);
    expect(resultado.aprovacoesPendentesAbertas).toBe(0);
    expect(mockAbrirTransbordo).toHaveBeenCalledTimes(1);
    const persistido = armazenamento.get("motoristasSpot/motorista-1");
    expect(persistido?.status).toBe("vermelho");
    // O novo ticket é para a transição `vermelho` recém-detectada, não uma
    // repetição do ticket antigo (que era para `verde`).
    expect(persistido?.ticketAbertoEm).toBe(REFERENCIA.toISOString());
  });

  it("um erro em um dossiê não impede o processamento dos demais", async () => {
    armazenamento.set(
      "motoristasSpot/motorista-1",
      dossie({ id: "motorista-1", documentos: documentosComCnhVencida(), status: "amarelo" }) as unknown as Record<
        string,
        unknown
      >
    );
    armazenamento.set(
      "motoristasSpot/motorista-2",
      dossie({ id: "motorista-2", documentos: documentosValidos(), status: "amarelo" }) as unknown as Record<
        string,
        unknown
      >
    );
    mockAbrirTransbordo.mockRejectedValueOnce(new Error("falha simulada no primeiro dossiê"));

    const { processarTickSpotDriverOnboardingAdmin } = await import("@/lib/server/spotDriverOnboardingAdmin");
    const resultado = await processarTickSpotDriverOnboardingAdmin("ws-a", { referencia: REFERENCIA });

    expect(resultado.dossiesVerificados).toBe(2);
    expect(resultado.escalonamentosAbertos).toBe(0);
    expect(resultado.aprovacoesPendentesAbertas).toBe(1);
  });
});
