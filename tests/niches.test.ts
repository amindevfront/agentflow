import { describe, expect, it } from "vitest";
import { NICHE_ORDER, NICHE_PRESETS } from "@/lib/niches";

describe("NICHE_PRESETS", () => {
  it("tem uma entrada para cada chave em NICHE_ORDER, sem duplicatas", () => {
    expect(new Set(NICHE_ORDER).size).toBe(NICHE_ORDER.length);
    for (const key of NICHE_ORDER) {
      expect(NICHE_PRESETS[key]).toBeDefined();
      expect(NICHE_PRESETS[key].key).toBe(key);
    }
  });

  it("todo preset tem label e descrição não vazios", () => {
    for (const key of NICHE_ORDER) {
      const preset = NICHE_PRESETS[key];
      expect(preset.label.trim().length).toBeGreaterThan(0);
      expect(preset.descricao.trim().length).toBeGreaterThan(0);
    }
  });

  it("playbooksSugeridos é sempre um array (pode ser vazio, nunca ausente)", () => {
    for (const key of NICHE_ORDER) {
      expect(Array.isArray(NICHE_PRESETS[key].playbooksSugeridos)).toBe(true);
    }
  });

  it("nichos verticais (fora de 'outros') sugerem ao menos um playbook", () => {
    for (const key of NICHE_ORDER) {
      if (key === "outros") continue;
      expect(NICHE_PRESETS[key].playbooksSugeridos.length).toBeGreaterThan(0);
    }
  });
});
