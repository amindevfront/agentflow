import { describe, expect, it } from "vitest";
import {
  buildExecutiveHandoffSummary,
  detectShowingRequest,
  extractBudgetRange,
  extractMappedObjection,
  extractProofOfFundsSignal,
  extractPropertyInterest,
} from "@/lib/server/usRealEstateLuxury";

describe("detectShowingRequest", () => {
  it("detects in-person showing requests in common phrasings", () => {
    expect(detectShowingRequest("Can we schedule a showing for Saturday?")).toBe(true);
    expect(detectShowingRequest("I'd love to tour the property this week.")).toBe(true);
    expect(detectShowingRequest("Could we book an in-person visit?")).toBe(true);
  });

  it("does not flag messages without showing intent", () => {
    expect(detectShowingRequest("What's the square footage of this unit?")).toBe(false);
    expect(detectShowingRequest("")).toBe(false);
  });
});

describe("extractProofOfFundsSignal", () => {
  it("identifies a cash buyer", () => {
    expect(extractProofOfFundsSignal(["I'm a cash buyer, ready to move fast."])).toBe("Cash buyer");
  });

  it("identifies proof of funds mentioned", () => {
    expect(extractProofOfFundsSignal(["I have proof of funds ready to share."])).toBe("Proof of funds mentioned");
  });

  it("identifies mortgage pre-approval", () => {
    expect(extractProofOfFundsSignal(["We're pre-approved for the mortgage already."])).toBe(
      "Pre-approved for mortgage"
    );
  });

  it("returns null when no financial-capacity signal was mentioned (never invented)", () => {
    expect(extractProofOfFundsSignal(["Just browsing for now, thanks."])).toBeNull();
    expect(extractProofOfFundsSignal([])).toBeNull();
  });
});

describe("extractMappedObjection", () => {
  it("identifies price objection", () => {
    expect(extractMappedObjection(["That's too expensive for what it offers."])).toBe(
      "Price above expected budget"
    );
  });

  it("identifies comparison with another listing", () => {
    expect(extractMappedObjection(["We're comparing with another listing nearby."])).toBe(
      "Comparing with another listing/competitor"
    );
  });

  it("identifies financing difficulty", () => {
    expect(extractMappedObjection(["Unfortunately our financing fell through."])).toBe(
      "Financing/mortgage difficulty"
    );
  });

  it("returns null when no objection is identified (never invented)", () => {
    expect(extractMappedObjection(["Loved the place, let's move forward!"])).toBeNull();
  });
});

describe("extractPropertyInterest", () => {
  it("identifies property type mentioned", () => {
    expect(extractPropertyInterest(["Looking for a penthouse with ocean views."])).toMatch(/penthouse/i);
  });

  it("identifies luxury neighborhood mentioned", () => {
    expect(extractPropertyInterest(["We'd like something in Coral Gables."])).toMatch(/coral gables/i);
  });

  it("returns null when no type/neighborhood is mentioned", () => {
    expect(extractPropertyInterest(["What's the HOA fee?"])).toBeNull();
  });
});

describe("extractBudgetRange", () => {
  it("extracts a 'between X and Y' range", () => {
    expect(extractBudgetRange(["We're looking for something between $800k and $1.2M."])).toMatch(
      /between \$800k and \$1\.2m/i
    );
  });

  it("extracts an 'up to X' range", () => {
    expect(extractBudgetRange(["Our budget is up to $2 million."])).toMatch(/up to \$2 million/i);
  });

  it("never extracts the exact BRL/USD figure already masked by the Shield-Layer", () => {
    expect(extractBudgetRange(["Our budget is [[PII:VALOR-FINANCEIRO:1]]."])).toBeNull();
  });

  it("returns null when no budget range is mentioned", () => {
    expect(extractBudgetRange(["Tell me more about the building amenities."])).toBeNull();
  });
});

describe("buildExecutiveHandoffSummary", () => {
  it("builds the full card when every signal is present", () => {
    const summary = buildExecutiveHandoffSummary({
      clientName: "Jordan",
      recentClientMessages: [
        "Looking for a penthouse in Brickell, up to $2 million.",
        "A bit pricier than expected, still deciding.",
      ],
    });

    expect(summary.nome).toBe("Jordan");
    expect(summary.imovelInteresse).toMatch(/penthouse/i);
    expect(summary.faixaOrcamento).toMatch(/\$2 million/i);
    expect(summary.objecaoMapeada).toBe("Undecided / still deciding");
  });

  it("leaves missing fields as null, never invents a value (Article IV — No Invention)", () => {
    const summary = buildExecutiveHandoffSummary({
      clientName: "Website visitor",
      recentClientMessages: ["Hi, I'd like more information."],
    });

    expect(summary.faixaOrcamento).toBeNull();
    expect(summary.imovelInteresse).toBeNull();
    expect(summary.objecaoMapeada).toBeNull();
  });
});
