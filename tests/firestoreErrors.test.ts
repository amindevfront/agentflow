import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codigoErroFirestore, extrairLinkIndice, isMissingIndexError, logIndiceAusente } from "@/lib/firestoreErrors";

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

const ERRO_INDICE = {
  code: "failed-precondition",
  message:
    "9 FAILED_PRECONDITION: The query requires an index. You can create it here: " +
    "https://console.firebase.google.com/v1/r/project/x/firestore/indexes?create_composite=abc123",
};

describe("isMissingIndexError", () => {
  it("reconhece failed-precondition com a mensagem de indice ausente", () => {
    expect(isMissingIndexError(ERRO_INDICE)).toBe(true);
  });

  it("nao reconhece failed-precondition com outra mensagem", () => {
    expect(isMissingIndexError({ code: "failed-precondition", message: "outra condicao qualquer" })).toBe(false);
  });

  it("nao reconhece outros codigos mesmo com a mensagem de indice", () => {
    expect(isMissingIndexError({ code: "permission-denied", message: ERRO_INDICE.message })).toBe(false);
  });

  it("nao reconhece erros sem code", () => {
    expect(isMissingIndexError(new Error("qualquer coisa"))).toBe(false);
    expect(isMissingIndexError(null)).toBe(false);
  });
});

describe("extrairLinkIndice", () => {
  it("extrai o link de criacao do indice da mensagem", () => {
    expect(extrairLinkIndice(ERRO_INDICE)).toBe(
      "https://console.firebase.google.com/v1/r/project/x/firestore/indexes?create_composite=abc123"
    );
  });

  it("retorna null quando nao ha link na mensagem", () => {
    expect(extrairLinkIndice(new Error("sem link nenhum"))).toBeNull();
  });
});

describe("logIndiceAusente", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("loga o link em desenvolvimento quando e indice ausente", () => {
    vi.stubEnv("NODE_ENV", "development");
    logIndiceAusente(ERRO_INDICE, "teste");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("teste");
    expect(warnSpy.mock.calls[0][0]).toContain("https://console.firebase.google.com");
  });

  it("nunca loga em producao, mesmo para indice ausente", () => {
    vi.stubEnv("NODE_ENV", "production");
    logIndiceAusente(ERRO_INDICE, "teste");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("nao loga quando o erro nao e de indice ausente", () => {
    vi.stubEnv("NODE_ENV", "development");
    logIndiceAusente(new Error("outro erro qualquer"), "teste");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
