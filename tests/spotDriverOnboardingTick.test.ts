// `processarTickSpotDriverOnboardingAdmin` (`@/lib/server/spotDriverOnboardingAdmin`) —
// o wrapper de IO (Admin SDK) em torno do núcleo puro já coberto por
// `tests/spotDriverOnboarding.test.ts` (que testa só `decidirProximaAcaoOnboardingSpot`
// e companhia, nunca este wrapper).
//
// Cobre especificamente a proteção contra duplo-efeito sob execução
// concorrente do tick (cron duplicado / retry da Vercel) — mesmo racional de
// `tests/arRecoveryEngineTick.test.ts`: cada dossiê é reivindicado numa
// transação que RELÊ `ticketAbertoEm`/`status`/`aprovadoEm` antes de abrir o
// ticket HITL/creditar ROI; se outra execução já avançou o dossiê, esta
// reivindicação desiste sem repetir o efeito.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DossieMotoristaSpot } from "@/types";

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

const REFERENCIA = new Date("2026-03-15T12:00:00.000Z");

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
      dossie({ status: "vermelho", pendencias: ["CNH vencida há 5 dia(s)."] }) as unknown as Record<string, unknown>
    );
    const { processarTickSpotDriverOnboardingAdmin } = await import("@/lib/server/spotDriverOnboardingAdmin");

    const resultado = await processarTickSpotDriverOnboardingAdmin("ws-a", { referencia: REFERENCIA });

    expect(resultado.escalonamentosAbertos).toBe(1);
    expect(resultado.aprovacoesPendentesAbertas).toBe(0);
    expect(mockAbrirTransbordo).toHaveBeenCalledTimes(1);
    expect(mockGanhoOperacional).not.toHaveBeenCalled();
    expect(armazenamento.get("motoristasSpot/motorista-1")?.ticketAbertoEm).toBe(REFERENCIA.toISOString());
  });

  it("abre aprovação pendente e credita ROI quando o dossiê está verde", async () => {
    armazenamento.set("motoristasSpot/motorista-1", dossie({ status: "verde" }) as unknown as Record<string, unknown>);
    const { processarTickSpotDriverOnboardingAdmin } = await import("@/lib/server/spotDriverOnboardingAdmin");

    const resultado = await processarTickSpotDriverOnboardingAdmin("ws-a", { referencia: REFERENCIA });

    expect(resultado.aprovacoesPendentesAbertas).toBe(1);
    expect(mockAbrirTransbordo).toHaveBeenCalledTimes(1);
    expect(mockGanhoOperacional).toHaveBeenCalledTimes(1);
  });

  it("nunca processa dossiê já aprovado", async () => {
    armazenamento.set(
      "motoristasSpot/motorista-1",
      dossie({ status: "verde", aprovadoEm: "2026-02-01T00:00:00.000Z" }) as unknown as Record<string, unknown>
    );
    const { processarTickSpotDriverOnboardingAdmin } = await import("@/lib/server/spotDriverOnboardingAdmin");

    const resultado = await processarTickSpotDriverOnboardingAdmin("ws-a", { referencia: REFERENCIA });

    expect(resultado.dossiesVerificados).toBe(0);
    expect(mockAbrirTransbordo).not.toHaveBeenCalled();
  });

  it("corrida: se outra execução já reivindicou o dossiê entre a varredura e a transação, não repete o efeito", async () => {
    armazenamento.set("motoristasSpot/motorista-1", dossie({ status: "verde" }) as unknown as Record<string, unknown>);
    // Simula que, no instante em que ESTA execução tenta reivindicar o
    // dossiê, uma execução concorrente já marcou `ticketAbertoEm`.
    patchDivergenteNaTransacao.set("motoristasSpot/motorista-1", { ticketAbertoEm: "2026-03-15T11:59:00.000Z" });

    const { processarTickSpotDriverOnboardingAdmin } = await import("@/lib/server/spotDriverOnboardingAdmin");
    const resultado = await processarTickSpotDriverOnboardingAdmin("ws-a", { referencia: REFERENCIA });

    expect(resultado.aprovacoesPendentesAbertas).toBe(0);
    expect(mockAbrirTransbordo).not.toHaveBeenCalled();
    expect(mockGanhoOperacional).not.toHaveBeenCalled();
  });

  it("um erro em um dossiê não impede o processamento dos demais", async () => {
    armazenamento.set(
      "motoristasSpot/motorista-1",
      dossie({ id: "motorista-1", status: "vermelho", pendencias: ["CNH vencida."] }) as unknown as Record<string, unknown>
    );
    armazenamento.set(
      "motoristasSpot/motorista-2",
      dossie({ id: "motorista-2", status: "verde" }) as unknown as Record<string, unknown>
    );
    mockAbrirTransbordo.mockRejectedValueOnce(new Error("falha simulada no primeiro dossiê"));

    const { processarTickSpotDriverOnboardingAdmin } = await import("@/lib/server/spotDriverOnboardingAdmin");
    const resultado = await processarTickSpotDriverOnboardingAdmin("ws-a", { referencia: REFERENCIA });

    expect(resultado.dossiesVerificados).toBe(2);
    expect(resultado.escalonamentosAbertos).toBe(0);
    expect(resultado.aprovacoesPendentesAbertas).toBe(1);
  });
});
