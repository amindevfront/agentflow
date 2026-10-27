import { beforeEach, describe, expect, it, vi } from "vitest";

const { onSnapshotMock } = vi.hoisted(() => ({ onSnapshotMock: vi.fn() }));

vi.mock("firebase/firestore", () => ({
  onSnapshot: onSnapshotMock,
}));

import { assinarComFallbackDeIndice } from "@/lib/firestoreResilience";

interface ChamadaFalsa {
  query: unknown;
  onNext: (snap: { docs: Array<{ data: () => unknown }> }) => void;
  onError: (erro: unknown) => void;
}

function instalarOnSnapshotFalso() {
  const chamadas: ChamadaFalsa[] = [];
  const unsubscribes: Array<ReturnType<typeof vi.fn>> = [];
  onSnapshotMock.mockImplementation((query: unknown, onNext: ChamadaFalsa["onNext"], onError: ChamadaFalsa["onError"]) => {
    chamadas.push({ query, onNext, onError });
    const u = vi.fn();
    unsubscribes.push(u);
    return u;
  });
  return { chamadas, unsubscribes };
}

const ERRO_INDICE_AUSENTE = {
  code: "failed-precondition",
  message:
    "9 FAILED_PRECONDITION: The query requires an index. You can create it here: " +
    "https://console.firebase.google.com/v1/r/project/x/firestore/indexes?create_composite=abc",
};

describe("assinarComFallbackDeIndice", () => {
  beforeEach(() => {
    onSnapshotMock.mockReset();
  });

  it("ao detectar índice ausente, troca para a consulta de fallback e reordena em memória", () => {
    const { chamadas, unsubscribes } = instalarOnSnapshotFalso();
    const onChange = vi.fn();

    assinarComFallbackDeIndice({
      consultaPrincipal: "principal" as never,
      consultaFallback: "fallback" as never,
      mapearDoc: (d: { data: () => unknown }) => d.data() as number,
      ordenarFallback: (lista: number[]) => [...lista].sort((a, b) => b - a),
      onChange,
      contexto: "teste",
    });

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].query).toBe("principal");

    chamadas[0].onError(ERRO_INDICE_AUSENTE);

    // Cancelou a assinatura principal e abriu uma nova, na consulta de fallback.
    expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1].query).toBe("fallback");

    chamadas[1].onNext({ docs: [{ data: () => 1 }, { data: () => 3 }, { data: () => 2 }] });
    expect(onChange).toHaveBeenCalledWith([3, 2, 1]);
  });

  it("em qualquer outro erro, degrada para lista vazia sem tentar o fallback", () => {
    const { chamadas } = instalarOnSnapshotFalso();
    const onChange = vi.fn();
    const aoFalharDeFormaIrrecuperavel = vi.fn();

    assinarComFallbackDeIndice({
      consultaPrincipal: "principal" as never,
      consultaFallback: "fallback" as never,
      mapearDoc: (d: { data: () => unknown }) => d.data() as number,
      ordenarFallback: (lista: number[]) => lista,
      onChange,
      contexto: "teste",
      aoFalharDeFormaIrrecuperavel,
    });

    chamadas[0].onError({ code: "permission-denied", message: "Missing or insufficient permissions." });

    expect(chamadas).toHaveLength(1); // nunca assinou o fallback
    expect(onChange).toHaveBeenCalledWith([]);
    expect(aoFalharDeFormaIrrecuperavel).toHaveBeenCalledTimes(1);
  });

  it("nunca repassa o objeto de erro ao callback de falha irrecuperável", () => {
    const { chamadas } = instalarOnSnapshotFalso();
    const aoFalharDeFormaIrrecuperavel = vi.fn();

    assinarComFallbackDeIndice({
      consultaPrincipal: "principal" as never,
      consultaFallback: "fallback" as never,
      mapearDoc: (d: { data: () => unknown }) => d.data(),
      ordenarFallback: (lista) => lista,
      onChange: vi.fn(),
      contexto: "teste",
      aoFalharDeFormaIrrecuperavel,
    });

    chamadas[0].onError(new Error("detalhe técnico que não pode chegar na UI"));

    expect(aoFalharDeFormaIrrecuperavel).toHaveBeenCalledWith();
  });

  it("para de reagir a eventos depois de cancelada (unsubscribe)", () => {
    const { chamadas } = instalarOnSnapshotFalso();
    const onChange = vi.fn();

    const cancelar = assinarComFallbackDeIndice({
      consultaPrincipal: "principal" as never,
      consultaFallback: "fallback" as never,
      mapearDoc: (d: { data: () => unknown }) => d.data(),
      ordenarFallback: (lista) => lista,
      onChange,
      contexto: "teste",
    });

    cancelar();
    chamadas[0].onNext({ docs: [{ data: () => 1 }] });

    expect(onChange).not.toHaveBeenCalled();
  });
});
