import { describe, expect, it } from "vitest";
import {
  buildExecutiveHandoffSummary,
  detectEstimateVisitRequest,
  detectProjectType,
  detectUrgency,
  estimatePreliminaryRange,
  extractMappedObjection,
  extractSquareFootage,
  extractStatedBudget,
} from "@/lib/server/usConstructionRemodeling";

describe("detectProjectType", () => {
  it("detects common project types", () => {
    expect(detectProjectType("We need a kitchen remodel for our place.")?.type).toBe("kitchen-remodel");
    expect(detectProjectType("Looking to add a room addition.")?.type).toBe("room-addition");
    expect(detectProjectType("Just need a deck built in the backyard.")?.type).toBe("deck-patio");
    expect(detectProjectType("Our roof needs replacement after the storm.")?.type).toBe("roofing");
  });

  it("returns null when no project type is identified (never guessed)", () => {
    expect(detectProjectType("What are your business hours?")).toBeNull();
    expect(detectProjectType("")).toBeNull();
  });
});

describe("detectUrgency", () => {
  it("flags urgent requests", () => {
    expect(detectUrgency("Need this done ASAP!")).toBe(true);
    expect(detectUrgency("This is urgent, please help.")).toBe(true);
  });

  it("does not flag messages without urgency signals", () => {
    expect(detectUrgency("No rush, just gathering quotes.")).toBe(false);
    expect(detectUrgency("")).toBe(false);
  });
});

describe("detectEstimateVisitRequest", () => {
  it("detects requests to schedule an on-site estimate", () => {
    expect(detectEstimateVisitRequest("Can you schedule an estimate for next week?")).toBe(true);
    expect(detectEstimateVisitRequest("Can someone come take a look at the kitchen?")).toBe(true);
  });

  it("does not flag messages without visit intent", () => {
    expect(detectEstimateVisitRequest("What brands of cabinets do you install?")).toBe(false);
  });
});

describe("extractMappedObjection", () => {
  it("identifies price objection", () => {
    expect(extractMappedObjection(["That's higher than I expected."])).toBe("Price above expected budget");
  });

  it("identifies comparison with other contractor quotes", () => {
    expect(extractMappedObjection(["We're getting other quotes before deciding."])).toBe(
      "Comparing with other contractor quotes"
    );
  });

  it("identifies financing approval pending", () => {
    expect(extractMappedObjection(["Still waiting on financing to go through."])).toBe(
      "Financing/loan approval pending"
    );
  });

  it("identifies insurance claim pending", () => {
    expect(extractMappedObjection(["Insurance claim pending on our end."])).toBe("Insurance claim pending");
  });

  it("returns null when no objection is identified (never invented)", () => {
    expect(extractMappedObjection(["Sounds great, let's move forward!"])).toBeNull();
  });
});

describe("extractStatedBudget", () => {
  it("extracts 'budget of $X' phrasing", () => {
    expect(extractStatedBudget(["Our budget of $15k should cover it, right?"])).toMatch(/budget of \$15k/i);
  });

  it("extracts 'around $X' phrasing", () => {
    expect(extractStatedBudget(["We have around $8k set aside for this."])).toMatch(/around \$8k/i);
  });

  it("returns null when no budget is mentioned", () => {
    expect(extractStatedBudget(["What's your availability next week?"])).toBeNull();
  });
});

describe("extractSquareFootage", () => {
  it("extracts square footage in common phrasings", () => {
    expect(extractSquareFootage("It's about 1200 sq ft.")).toBe(1200);
    expect(extractSquareFootage("The space is 1,500 square feet.")).toBe(1500);
  });

  it("returns null when no square footage is mentioned", () => {
    expect(extractSquareFootage("It's a medium-sized kitchen.")).toBeNull();
  });
});

describe("estimatePreliminaryRange", () => {
  it("computes a preliminary range from project type and square footage", () => {
    const range = estimatePreliminaryRange("kitchen-remodel", 100);
    expect(range).toEqual({ minUsd: 15_000, maxUsd: 30_000 });
  });

  it("never fabricates a range when the project type is missing", () => {
    expect(estimatePreliminaryRange(null, 100)).toBeNull();
  });

  it("never fabricates a range when the square footage is missing", () => {
    expect(estimatePreliminaryRange("kitchen-remodel", null)).toBeNull();
  });
});

describe("buildExecutiveHandoffSummary", () => {
  it("builds the card from the most recent message's project type plus budget/objection across messages", () => {
    const summary = buildExecutiveHandoffSummary({
      clientName: "Taylor",
      recentClientMessages: [
        "Kitchen remodel, around 400 sq ft.",
        "Budget of $20k, hoping that's enough — still deciding on the finishes though.",
      ],
    });

    expect(summary.nome).toBe("Taylor");
    expect(summary.imovelInteresse).toBe("Kitchen remodel");
    expect(summary.faixaOrcamento).toMatch(/\$20k/i);
  });

  it("leaves missing fields as null, never invents a value (Article IV — No Invention)", () => {
    const summary = buildExecutiveHandoffSummary({
      clientName: "Website visitor",
      recentClientMessages: ["Hi, do you offer free estimates?"],
    });

    expect(summary.faixaOrcamento).toBeNull();
    expect(summary.imovelInteresse).toBeNull();
    expect(summary.objecaoMapeada).toBeNull();
  });
});
