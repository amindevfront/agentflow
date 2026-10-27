import { describe, expect, it } from "vitest";
import { codigoErroFirestore } from "@/lib/firestoreErrors";

describe("codigoErroFirestore", () => {
  it("reconhece permission-denied", () => {
    expect(codigoErroFirestore({ code: "permission-denied" })).toBe("permission-denied");
  });

  it("reconhece unavailable", () => {
    expect(codigoErroFirestore({ code: "unavailable" })).toBe("unavailable");
  });

  it("reconhece deadline-exceeded", () => {
    expect(codigoErroFirestore({ code: "deadline-exceeded" })).toBe("deadline-exceeded");
  });

  it("reconhece unauthenticated", () => {
    expect(codigoErroFirestore({ code: "unauthenticated" })).toBe("unauthenticated");
  });

  it("cai em desconhecido para codigos nao mapeados", () => {
    expect(codigoErroFirestore({ code: "internal" })).toBe("desconhecido");
  });

  it("cai em desconhecido quando nao ha codigo (ex.: erro de timeout local)", () => {
    expect(codigoErroFirestore(new Error("timeout"))).toBe("desconhecido");
  });

  it("cai em desconhecido para valores nao-objeto", () => {
    expect(codigoErroFirestore("erro qualquer")).toBe("desconhecido");
    expect(codigoErroFirestore(null)).toBe("desconhecido");
    expect(codigoErroFirestore(undefined)).toBe("desconhecido");
  });
});
