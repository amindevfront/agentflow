import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearPendingProfile, readPendingProfile, savePendingProfile } from "@/lib/pendingWorkspace";
import type { AppUser, Workspace } from "@/types";

const APP_USER: AppUser = {
  uid: "uid-1",
  nome: "Caio",
  email: "caio@example.com",
  papel: "admin",
  workspaceId: "ws-1",
};

const WORKSPACE: Workspace = {
  id: "ws-1",
  nome: "Workspace de teste",
  setor: "outros",
  criadoEm: "2026-10-24T00:00:00.000Z",
  playbooksSugeridos: [],
};

describe("pendingWorkspace (ambiente sem sessionStorage cai para memória)", () => {
  beforeEach(() => {
    clearPendingProfile(APP_USER.uid);
  });

  it("retorna null quando nada foi salvo", () => {
    expect(readPendingProfile(APP_USER.uid)).toBeNull();
  });

  it("salva e lê de volta o mesmo perfil", () => {
    savePendingProfile(APP_USER.uid, { appUser: APP_USER, workspace: WORKSPACE });
    const lido = readPendingProfile(APP_USER.uid);
    expect(lido?.appUser).toEqual(APP_USER);
    expect(lido?.workspace).toEqual(WORKSPACE);
  });

  it("isola entradas por uid", () => {
    savePendingProfile(APP_USER.uid, { appUser: APP_USER, workspace: WORKSPACE });
    expect(readPendingProfile("outro-uid")).toBeNull();
  });

  it("clearPendingProfile remove a entrada", () => {
    savePendingProfile(APP_USER.uid, { appUser: APP_USER, workspace: WORKSPACE });
    clearPendingProfile(APP_USER.uid);
    expect(readPendingProfile(APP_USER.uid)).toBeNull();
  });

  it("expira entradas mais antigas que o TTL (30min)", () => {
    vi.useFakeTimers();
    try {
      savePendingProfile(APP_USER.uid, { appUser: APP_USER, workspace: WORKSPACE });
      expect(readPendingProfile(APP_USER.uid)).not.toBeNull();

      vi.advanceTimersByTime(31 * 60 * 1000);
      expect(readPendingProfile(APP_USER.uid)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
