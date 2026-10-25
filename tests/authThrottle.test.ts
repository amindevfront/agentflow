import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  calcularProximoEstado,
  registrarFalhaAuth,
  registrarSucessoAuth,
  verificarBloqueioAuth,
} from "@/lib/authThrottle";

describe("calcularProximoEstado (puro)", () => {
  it("primeira falha não bloqueia", () => {
    const estado = calcularProximoEstado(null, 0);
    expect(estado.tentativas).toBe(1);
    expect(estado.bloqueadoAteMs).toBe(0);
  });

  it("bloqueia a partir da 5ª tentativa consecutiva, com backoff exponencial", () => {
    let estado = null as ReturnType<typeof calcularProximoEstado> | null;
    let agora = 0;
    for (let i = 0; i < 4; i++) {
      estado = calcularProximoEstado(estado, agora);
      expect(estado.bloqueadoAteMs).toBe(0);
      agora += 1000;
    }
    estado = calcularProximoEstado(estado, agora);
    expect(estado.tentativas).toBe(5);
    expect(estado.bloqueadoAteMs).toBe(agora + 30_000);

    // 6ª tentativa consecutiva: dobro do bloqueio anterior.
    estado = calcularProximoEstado(estado, agora + 1000);
    expect(estado.bloqueadoAteMs).toBe(agora + 1000 + 60_000);
  });

  it("satura no teto de 15 minutos", () => {
    let estado = calcularProximoEstado(null, 0);
    let agora = 0;
    for (let i = 0; i < 15; i++) {
      agora += 1000;
      estado = calcularProximoEstado(estado, agora);
    }
    expect(estado.bloqueadoAteMs - agora).toBeLessThanOrEqual(15 * 60_000);
  });

  it("zera a contagem se a última tentativa foi há mais que a janela de reset (15min)", () => {
    const primeira = calcularProximoEstado(null, 0);
    const depoisDaJanela = calcularProximoEstado(primeira, 16 * 60_000);
    expect(depoisDaJanela.tentativas).toBe(1);
  });
});

describe("registrarFalhaAuth / registrarSucessoAuth / verificarBloqueioAuth (sessionStorage)", () => {
  const IDENTIFICADOR = "teste@exemplo.com";

  beforeEach(() => {
    registrarSucessoAuth(IDENTIFICADOR);
  });

  it("não bloqueia antes do limiar de tentativas", () => {
    for (let i = 0; i < 4; i++) {
      const status = registrarFalhaAuth(IDENTIFICADOR);
      expect(status.bloqueado).toBe(false);
    }
  });

  it("bloqueia a partir da 5ª falha e `verificarBloqueioAuth` reflete o mesmo estado", () => {
    for (let i = 0; i < 5; i++) registrarFalhaAuth(IDENTIFICADOR);
    const status = verificarBloqueioAuth(IDENTIFICADOR);
    expect(status.bloqueado).toBe(true);
    expect(status.restanteSegundos).toBeGreaterThan(0);
  });

  it("registrarSucessoAuth limpa o histórico de falhas", () => {
    for (let i = 0; i < 5; i++) registrarFalhaAuth(IDENTIFICADOR);
    registrarSucessoAuth(IDENTIFICADOR);
    expect(verificarBloqueioAuth(IDENTIFICADOR).bloqueado).toBe(false);
  });

  it("o bloqueio expira com o tempo", () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 5; i++) registrarFalhaAuth(IDENTIFICADOR);
      expect(verificarBloqueioAuth(IDENTIFICADOR).bloqueado).toBe(true);
      vi.advanceTimersByTime(31_000);
      expect(verificarBloqueioAuth(IDENTIFICADOR).bloqueado).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("identificadores diferentes têm históricos isolados", () => {
    for (let i = 0; i < 5; i++) registrarFalhaAuth(IDENTIFICADOR);
    expect(verificarBloqueioAuth("outro@exemplo.com").bloqueado).toBe(false);
  });
});
