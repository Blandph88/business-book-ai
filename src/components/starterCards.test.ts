// Education-card builder: the empty-chat teach surface. The load-bearing guarantee is that a card
// which names a person only ever names one derived from the live book (or falls back to generic),
// and that every supported CATEGORY is always present (that's the teaching value).
import { describe, it, expect } from "vitest";
import { buildStarterCards } from "./CopilotBar";

const CATS = ["brief", "pipeline", "gaps", "log", "draft", "recall"];

describe("buildStarterCards", () => {
  it("always emits one card per supported category, in order", () => {
    const cards = buildStarterCards("Robert Schmidt", 0);
    expect(cards.map((c) => c.key)).toEqual(CATS);
  });

  it("injects the live warm-contact name into the person-naming cards", () => {
    const cards = buildStarterCards("Robert Schmidt", 0);
    const brief = cards.find((c) => c.key === "brief")!;
    const draft = cards.find((c) => c.key === "draft")!;
    expect(brief.text).toContain("Robert Schmidt");
    expect(draft.text).toContain("Robert Schmidt");
  });

  it("falls back to generic phrasing (no fabricated name) when the book has no warm contact", () => {
    const cards = buildStarterCards(undefined, 0);
    const brief = cards.find((c) => c.key === "brief")!;
    const draft = cards.find((c) => c.key === "draft")!;
    // Generic, routable, and — critically — names no specific person.
    expect(brief.text).toMatch(/warmest lead|strongest contact/i);
    expect(draft.text).toMatch(/warmest lead/i);
    expect(draft.text).not.toMatch(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/); // no "Firstname Lastname"
  });

  it("is deterministic and rotates phrasing by seed", () => {
    // Same seed → same cards (no Math.random under the sealed runtime).
    expect(buildStarterCards("Ada Lovelace", 3)).toEqual(buildStarterCards("Ada Lovelace", 3));
    // A category with multiple variants changes phrasing across seeds.
    const t0 = buildStarterCards("Ada Lovelace", 0).find((c) => c.key === "pipeline")!.text;
    const t1 = buildStarterCards("Ada Lovelace", 1).find((c) => c.key === "pipeline")!.text;
    expect(t0).not.toBe(t1);
  });
});
