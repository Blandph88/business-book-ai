import { describe, it, expect } from "vitest";
import {
  SENIORITY,
  SECTOR_GROUPS,
  MEETING_STAGE,
  MEETING_TYPE,
  SENTIMENT,
  OPPORTUNITY_SPOTTED,
  RELATIONSHIP_STRENGTH,
  PRIORITY,
  DECISION_ROLE,
  SERVICE_LINE,
  OPPORTUNITY_PHASES,
  OPPORTUNITY_STEPS,
  CONSULTING_FIRMS,
  PROBABILITY,
  REVENUE_STATUS,
  WON_STEP,
  stepDef,
  stepIndex,
  stepLabel,
  stepShort,
  stepsByPhase,
  probabilityLabel,
  OTHER_FUNCTIONS,
} from "./vocab";
import {
  INDUSTRY_LABEL,
  INDUSTRIES,
  OTHER_INDUSTRY_LABEL,
  INDEPENDENT_LABEL,
} from "../config/markets";

// Helper: assert an array is a non-empty array of unique non-empty strings.
function expectUniqueStringArray(arr: readonly string[]) {
  expect(Array.isArray(arr)).toBe(true);
  expect(arr.length).toBeGreaterThan(0);
  for (const v of arr) {
    expect(typeof v).toBe("string");
    expect(v.length).toBeGreaterThan(0);
  }
  expect(new Set(arr).size).toBe(arr.length);
}

// ── SECTOR_GROUPS must mirror the taxonomy exactly ─────────────────────────────
describe("SECTOR_GROUPS", () => {
  it("is a unique, non-empty string list", () => {
    expectUniqueStringArray(SECTOR_GROUPS);
  });

  it("includes every INDUSTRY_LABEL value", () => {
    for (const label of Object.values(INDUSTRY_LABEL)) {
      expect(SECTOR_GROUPS as readonly string[]).toContain(label);
    }
  });

  it("includes the Independent + Other catch-all labels", () => {
    expect(SECTOR_GROUPS as readonly string[]).toContain(INDEPENDENT_LABEL);
    expect(SECTOR_GROUPS as readonly string[]).toContain(OTHER_INDUSTRY_LABEL);
  });

  it("has nothing stale — every entry is an industry label OR one of the two catch-alls", () => {
    const allowed = new Set<string>([
      ...Object.values(INDUSTRY_LABEL),
      INDEPENDENT_LABEL,
      OTHER_INDUSTRY_LABEL,
    ]);
    for (const g of SECTOR_GROUPS) {
      expect(allowed.has(g)).toBe(true);
    }
  });

  it("has exactly (#industries + 2) entries", () => {
    expect(SECTOR_GROUPS.length).toBe(INDUSTRIES.length + 2);
  });
});

// ── SENIORITY: the 5 expected bands, in order ──────────────────────────────────
describe("SENIORITY", () => {
  it("is a unique, non-empty string list", () => {
    expectUniqueStringArray(SENIORITY);
  });

  it("has the 5 expected bands in seniority order", () => {
    expect([...SENIORITY]).toEqual([
      "Executive Leadership",
      "Head of / Director",
      "VP / SM",
      "Manager",
      "Associate / Analyst",
    ]);
  });
});

// ── The remaining categorical vocabularies are unique non-empty string arrays ──
describe("categorical vocabularies are unique non-empty string arrays", () => {
  it.each([
    ["MEETING_STAGE", MEETING_STAGE],
    ["MEETING_TYPE", MEETING_TYPE],
    ["SENTIMENT", SENTIMENT],
    ["OPPORTUNITY_SPOTTED", OPPORTUNITY_SPOTTED],
    ["RELATIONSHIP_STRENGTH", RELATIONSHIP_STRENGTH],
    ["PRIORITY", PRIORITY],
    ["DECISION_ROLE", DECISION_ROLE],
    ["SERVICE_LINE", SERVICE_LINE],
    ["OPPORTUNITY_PHASES", OPPORTUNITY_PHASES],
    ["CONSULTING_FIRMS", CONSULTING_FIRMS],
    ["REVENUE_STATUS", REVENUE_STATUS],
  ])("%s", (_name, arr) => {
    expectUniqueStringArray(arr as readonly string[]);
  });

  it("OPPORTUNITY_SPOTTED is exactly Yes/No", () => {
    expect([...OPPORTUNITY_SPOTTED]).toEqual(["Yes", "No"]);
  });

  it("OTHER_FUNCTIONS is a non-empty string", () => {
    expect(typeof OTHER_FUNCTIONS).toBe("string");
    expect(OTHER_FUNCTIONS.length).toBeGreaterThan(0);
  });
});

// ── PROBABILITY: unique ascending numbers in (0,1] ─────────────────────────────
describe("PROBABILITY", () => {
  it("is a unique list of numbers in (0, 1]", () => {
    expect(PROBABILITY.length).toBeGreaterThan(0);
    expect(new Set(PROBABILITY).size).toBe(PROBABILITY.length);
    for (const p of PROBABILITY) {
      expect(typeof p).toBe("number");
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("is sorted ascending", () => {
    const sorted = [...PROBABILITY].sort((a, b) => a - b);
    expect([...PROBABILITY]).toEqual(sorted);
  });

  it("probabilityLabel renders whole-number percentages", () => {
    expect(probabilityLabel(0.25)).toBe("25%");
    expect(probabilityLabel(1.0)).toBe("100%");
    expect(probabilityLabel(0.1)).toBe("10%");
  });
});

// ── OPPORTUNITY_STEPS roll up to OPPORTUNITY_PHASES consistently ────────────────
describe("OPPORTUNITY_STEPS", () => {
  it("has unique step ids", () => {
    const ids = OPPORTUNITY_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every step's phase is a valid OPPORTUNITY_PHASE", () => {
    const phases = new Set<string>(OPPORTUNITY_PHASES);
    for (const s of OPPORTUNITY_STEPS) {
      expect(phases.has(s.phase)).toBe(true);
    }
  });

  it("every step's prob is one of the PROBABILITY values", () => {
    const probs = new Set<number>(PROBABILITY);
    for (const s of OPPORTUNITY_STEPS) {
      expect(probs.has(s.prob)).toBe(true);
    }
  });

  it("every phase is covered by at least one step (no empty phase)", () => {
    for (const phase of OPPORTUNITY_PHASES) {
      expect(stepsByPhase(phase).length).toBeGreaterThan(0);
    }
  });

  it("steps are grouped so each phase's steps are contiguous (phases never interleave)", () => {
    // The phase index must be non-decreasing across the step list for the roll-up
    // to be a clean prefix grouping.
    const phaseIndex = (p: string) => OPPORTUNITY_PHASES.indexOf(p as never);
    let prev = -1;
    for (const s of OPPORTUNITY_STEPS) {
      const idx = phaseIndex(s.phase);
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });

  it("offsetWeeks is non-decreasing along the workflow", () => {
    let prev = -1;
    for (const s of OPPORTUNITY_STEPS) {
      expect(s.offsetWeeks).toBeGreaterThanOrEqual(prev);
      prev = s.offsetWeeks;
    }
  });

  it("WON_STEP is a real step id", () => {
    expect(OPPORTUNITY_STEPS.map((s) => s.id)).toContain(WON_STEP);
  });

  it("actor is one of External/Internal/Both", () => {
    const actors = new Set(["External", "Internal", "Both"]);
    for (const s of OPPORTUNITY_STEPS) {
      expect(actors.has(s.actor)).toBe(true);
    }
  });
});

// ── Step accessors ─────────────────────────────────────────────────────────────
describe("step accessors", () => {
  it("stepDef returns the matching definition", () => {
    const first = OPPORTUNITY_STEPS[0];
    expect(stepDef(first.id).id).toBe(first.id);
  });

  it("stepIndex matches array order", () => {
    OPPORTUNITY_STEPS.forEach((s, i) => {
      expect(stepIndex(s.id)).toBe(i);
    });
  });

  it("stepLabel and stepShort return the configured strings", () => {
    const s = OPPORTUNITY_STEPS[0];
    expect(stepLabel(s.id)).toBe(s.label);
    expect(stepShort(s.id)).toBe(s.short);
  });

  it("stepsByPhase returns only steps of that phase, in workflow order", () => {
    for (const phase of OPPORTUNITY_PHASES) {
      const steps = stepsByPhase(phase);
      for (const s of steps) expect(s.phase).toBe(phase);
      // order preserved relative to the master list
      const masterOrder = OPPORTUNITY_STEPS.filter((x) => x.phase === phase).map(
        (x) => x.id,
      );
      expect(steps.map((x) => x.id)).toEqual(masterOrder);
    }
  });
});
