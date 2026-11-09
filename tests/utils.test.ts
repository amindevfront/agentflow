import { describe, expect, it } from "vitest";
import { formatRelativeTime, initials } from "@/lib/utils";

describe("formatRelativeTime", () => {
  it("nunca mostra 'NaN' quando a data é inválida (campo ausente/malformado em qualquer gaveta)", () => {
    expect(formatRelativeTime(new Date(undefined as unknown as string))).toBe("—");
    expect(formatRelativeTime(new Date("isso não é uma data"))).toBe("—");
  });

  it("formata os intervalos esperados", () => {
    const agora = new Date();
    expect(formatRelativeTime(agora)).toBe("agora");
    expect(formatRelativeTime(new Date(agora.getTime() - 5 * 60_000))).toBe("há 5 min");
    expect(formatRelativeTime(new Date(agora.getTime() - 3 * 3_600_000))).toBe("há 3h");
    expect(formatRelativeTime(new Date(agora.getTime() - 25 * 3_600_000))).toBe("ontem");
    expect(formatRelativeTime(new Date(agora.getTime() - 3 * 86_400_000))).toBe("há 3 dias");
  });
});

describe("initials", () => {
  it("nunca lança para nome vazio ou só com espaços", () => {
    expect(initials("")).toBe("");
    expect(initials("   ")).toBe("");
  });

  it("gera as iniciais a partir do primeiro e último nome", () => {
    expect(initials("Marina Castello")).toBe("MC");
    expect(initials("Único")).toBe("ÚN");
  });
});
