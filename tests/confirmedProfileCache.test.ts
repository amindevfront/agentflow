import { describe, expect, it, vi } from "vitest";
import { readConfirmedProfile, saveConfirmedProfile } from "@/lib/confirmedProfileCache";
import type { AppUser } from "@/types";

function appUser(uid: string): AppUser {
  return {
    uid,
    nome: "Caio",
    email: "caio@example.com",
    papel: "admin",
    workspaceId: "ws-1",
  };
}

describe("confirmedProfileCache (ambiente sem localStorage cai para memória)", () => {
  it("retorna null quando nada foi confirmado ainda", () => {
    expect(readConfirmedProfile("uid-sem-cache")).toBeNull();
  });

  it("salva e lê de volta o mesmo perfil confirmado", () => {
    const user = appUser("uid-confirmado");
    saveConfirmedProfile(user.uid, user);
    expect(readConfirmedProfile(user.uid)).toEqual(user);
  });

  it("isola entradas por uid", () => {
    const user = appUser("uid-isolado");
    saveConfirmedProfile(user.uid, user);
    expect(readConfirmedProfile("outro-uid-isolado")).toBeNull();
  });

  it("expira entradas mais antigas que o TTL (7 dias)", () => {
    vi.useFakeTimers();
    try {
      const user = appUser("uid-expira");
      saveConfirmedProfile(user.uid, user);
      expect(readConfirmedProfile(user.uid)).not.toBeNull();

      vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);
      expect(readConfirmedProfile(user.uid)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
