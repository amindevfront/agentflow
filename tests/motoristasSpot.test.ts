// `aprovarMotoristaSpot` (`@/lib/motoristasSpot`) é o gate final de
// compliance do Fleet & SPOT Driver Onboarding — a ação que de fato libera
// a frota. Cobre especificamente que ela NUNCA confia no `dossie.status`
// recebido do chamador (que pode estar obsoleto — o mesmo drift que
// `tests/spotDriverOnboardingTick.test.ts` cobre do lado do tick): sempre
// recalcula `avaliarDossieMotoristaSpot` a partir dos `documentos` reais e
// de "agora" antes de escrever `aprovadoEm`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentoMotoristaSpot, DossieMotoristaSpot } from "@/types";

vi.mock("@/lib/firebase", () => ({ db: {}, auth: { currentUser: { uid: "user-1" } }, storage: undefined }));

const updateDocMock = vi.fn(async (_ref: unknown, _patch: Record<string, unknown>) => undefined);
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  doc: (_db: unknown, colecao: string, id: string) => ({ colecao, id }),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: (ref: unknown, patch: Record<string, unknown>) => updateDocMock(ref, patch),
  where: vi.fn(),
}));

const { aprovarMotoristaSpot } = await import("@/lib/motoristasSpot");

const REFERENCIA = new Date("2026-03-15T12:00:00.000Z");

function documento(parcial: Partial<DocumentoMotoristaSpot>): DocumentoMotoristaSpot {
  return { tipo: "cnh", status: "pendente", validadeEm: null, motivoInvalido: null, recebidoEm: null, ...parcial };
}

function documentosValidos(): DocumentoMotoristaSpot[] {
  return [
    documento({ tipo: "cnh", status: "recebido", validadeEm: new Date(REFERENCIA.getTime() + 30 * 86_400_000).toISOString() }),
    documento({ tipo: "crlv", status: "recebido" }),
    documento({ tipo: "antt", status: "recebido", validadeEm: new Date(REFERENCIA.getTime() + 30 * 86_400_000).toISOString() }),
    documento({ tipo: "comprovante-residencia", status: "recebido" }),
  ];
}

function dossie(parcial: Partial<DossieMotoristaSpot> = {}): DossieMotoristaSpot {
  return {
    id: "motorista-1",
    workspaceId: "ws-1",
    nomeMotorista: "João",
    placaVeiculo: null,
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

describe("aprovarMotoristaSpot", () => {
  beforeEach(() => {
    updateDocMock.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(REFERENCIA);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejeita quando os documentos NÃO avaliam para verde, mesmo com `status: verde` obsoleto vindo do chamador", async () => {
    const semDocumentos = dossie({ status: "verde", documentos: [] });
    await expect(aprovarMotoristaSpot(semDocumentos)).rejects.toThrow(/não está mais completa/);
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it("rejeita quando uma CNH venceu entre a última leitura do painel e o clique de aprovar", async () => {
    const documentos = documentosValidos().map((d) =>
      d.tipo === "cnh" ? { ...d, validadeEm: "2020-01-01T00:00:00.000Z" } : d
    );
    const comCnhVencida = dossie({ status: "verde", documentos });
    await expect(aprovarMotoristaSpot(comCnhVencida)).rejects.toThrow();
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it("aprova e registra quem aprovou quando os documentos realmente avaliam para verde", async () => {
    const pronto = dossie({ status: "verde", documentos: documentosValidos() });
    await expect(aprovarMotoristaSpot(pronto)).resolves.toBeUndefined();

    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const [, patch] = updateDocMock.mock.calls[0];
    expect(patch.aprovadoPor).toBe("user-1");
    expect(patch.aprovadoEm).toBe(REFERENCIA.toISOString());
    expect(patch.atualizadoEm).toBe(REFERENCIA.toISOString());
  });
});
