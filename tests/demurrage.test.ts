import { describe, expect, it } from "vitest";
import type { Shipment, ShipmentStatus } from "@/types";
import { calcularRiscoDemurrage } from "@/lib/demurrage";

const AGORA = new Date(2026, 0, 10, 12, 0, 0);

function horasAtras(horas: number): string {
  return new Date(AGORA.getTime() - horas * 60 * 60 * 1000).toISOString();
}

function criarCarga(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: "ship_1",
    workspaceId: "default",
    codigoRastreio: "BRX-004521",
    origem: "Shanghai",
    destino: "Itajaí",
    status: "aduana",
    previsaoEntrega: horasAtras(-48),
    freeTimeDias: 7,
    custoDiarioDemurrageBrl: 350,
    atualizadoEm: AGORA.toISOString(),
    criadoEm: AGORA.toISOString(),
    historico: [{ status: "aduana", ocorridoEm: horasAtras(96) }],
    ...overrides,
  };
}

describe("calcularRiscoDemurrage", () => {
  it("devolve null sem freeTimeDias configurado", () => {
    expect(calcularRiscoDemurrage(criarCarga({ freeTimeDias: undefined }), AGORA)).toBeNull();
  });

  it("devolve null sem custoDiarioDemurrageBrl configurado", () => {
    expect(calcularRiscoDemurrage(criarCarga({ custoDiarioDemurrageBrl: undefined }), AGORA)).toBeNull();
  });

  it("devolve null quando a carga nunca chegou à aduana", () => {
    const carga = criarCarga({ status: "em-transito", historico: [{ status: "coletado", ocorridoEm: horasAtras(96) }] });
    expect(calcularRiscoDemurrage(carga, AGORA)).toBeNull();
  });

  it("dentro do free time quando poucos dias se passaram desde a chegada", () => {
    const carga = criarCarga({ historico: [{ status: "aduana", ocorridoEm: horasAtras(24) }] });
    const risco = calcularRiscoDemurrage(carga, AGORA);
    expect(risco?.nivelAlerta).toBe("dentro-do-free-time");
    expect(risco?.diasExcedentes).toBe(0);
    expect(risco?.custoProjetadoBrl).toBe(0);
  });

  it("próximo do limite quando restam poucos dias de free time", () => {
    // 7 dias de free time, chegou há 5.5 dias (144h) — restam 1.5 dia.
    const carga = criarCarga({ historico: [{ status: "aduana", ocorridoEm: horasAtras(132) }] });
    const risco = calcularRiscoDemurrage(carga, AGORA);
    expect(risco?.nivelAlerta).toBe("proximo-do-limite");
    expect(risco?.diasExcedentes).toBe(0);
  });

  it("acumula custo proporcional aos dias excedentes ao free time", () => {
    // 7 dias de free time, chegou há 10 dias (240h) — 3 dias excedentes × R$350.
    const carga = criarCarga({ historico: [{ status: "aduana", ocorridoEm: horasAtras(240) }] });
    const risco = calcularRiscoDemurrage(carga, AGORA);
    expect(risco?.nivelAlerta).toBe("acumulando-custo");
    expect(risco?.diasExcedentes).toBe(3);
    expect(risco?.custoProjetadoBrl).toBe(1050);
  });

  it("congela o cálculo no instante da entrega — o relógio não continua correndo depois", () => {
    const carga = criarCarga({
      status: "entregue",
      historico: [
        { status: "aduana", ocorridoEm: horasAtras(240) },
        // entregue 8 dias (192h) depois da chegada — 1 dia excedente.
        { status: "entregue", ocorridoEm: horasAtras(240 - 192) },
      ],
    });
    // Mesmo rodando a verificação muito depois da entrega, o custo não cresce.
    const risco = calcularRiscoDemurrage(carga, new Date(AGORA.getTime() + 30 * 24 * 60 * 60 * 1000));
    expect(risco?.diasExcedentes).toBe(1);
    expect(risco?.custoProjetadoBrl).toBe(350);
    expect(risco?.nivelAlerta).toBe("acumulando-custo");
  });

  it("marca como 'evitado' quando a entrega ocorreu dentro do free time", () => {
    const carga = criarCarga({
      status: "entregue",
      historico: [
        { status: "aduana", ocorridoEm: horasAtras(240) },
        { status: "entregue", ocorridoEm: horasAtras(240 - 48) },
      ],
    });
    const risco = calcularRiscoDemurrage(carga, AGORA);
    expect(risco?.nivelAlerta).toBe("evitado");
    expect(risco?.custoProjetadoBrl).toBe(0);
  });

  it.each(["coletado", "em-transito"] as ShipmentStatus[])(
    "usa o PRIMEIRO evento 'aduana' do histórico como início da contagem, independente do status atual '%s'",
    (status) => {
      const carga = criarCarga({
        status,
        historico: [
          { status: "aduana", ocorridoEm: horasAtras(240) },
          { status: "atrasado", ocorridoEm: horasAtras(100) },
        ],
      });
      const risco = calcularRiscoDemurrage(carga, AGORA);
      expect(risco?.chegadaAduanaEm).toBe(new Date(horasAtras(240)).toISOString());
    }
  );
});
