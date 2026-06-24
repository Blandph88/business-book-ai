import { describe, it, expect, vi, afterEach } from "vitest";
import {
  STEP_OFFSET_WEEKS,
  addWeeks,
  addMonths,
  planStepDates,
  nextStepInfo,
  advanceOpportunity,
  nextMeetingDateISO,
} from "./timeline";
import { OPPORTUNITY_STEPS } from "./vocab";
import type { Opportunity } from "../storage/opportunities";

afterEach(() => {
  vi.useRealTimers();
});

// A minimal opportunity, overridable per test.
function opp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "o1",
    opportunity_name: "Deal",
    organisation: "Acme",
    primary_contact: "Jane Doe",
    service_line: "Strategy",
    current_step: "meeting",
    ...overrides,
  };
}

describe("STEP_OFFSET_WEEKS", () => {
  it("mirrors each step's offsetWeeks from the vocab", () => {
    for (const s of OPPORTUNITY_STEPS) {
      expect(STEP_OFFSET_WEEKS[s.id]).toBe(s.offsetWeeks);
    }
    // Anchored at 0, signature at 24, revenue at 45.
    expect(STEP_OFFSET_WEEKS.meeting).toBe(0);
    expect(STEP_OFFSET_WEEKS.contracting).toBe(24);
    expect(STEP_OFFSET_WEEKS.revenue).toBe(45);
  });
});

describe("addWeeks", () => {
  it("adds whole weeks as 7-day steps", () => {
    expect(addWeeks("2026-06-24", 0)).toBe("2026-06-24");
    expect(addWeeks("2026-06-24", 1)).toBe("2026-07-01");
    expect(addWeeks("2026-06-24", 2)).toBe("2026-07-08");
  });

  it("crosses month and year boundaries", () => {
    expect(addWeeks("2026-12-24", 2)).toBe("2027-01-07");
  });

  it("supports negative weeks (back-dating)", () => {
    expect(addWeeks("2026-07-01", -1)).toBe("2026-06-24");
  });
});

describe("addMonths", () => {
  it("adds calendar months", () => {
    expect(addMonths("2026-06-24", 2)).toBe("2026-08-24");
    expect(addMonths("2026-11-15", 2)).toBe("2027-01-15");
  });
});

describe("planStepDates", () => {
  it("returns a planned date for every workflow step, anchored to the input", () => {
    const plan = planStepDates("2026-06-24");
    // Every step gets a date.
    for (const s of OPPORTUNITY_STEPS) {
      expect(plan[s.id]).toBeDefined();
    }
    // Anchor step is the anchor itself.
    expect(plan.meeting).toBe("2026-06-24");
    // contracting = anchor + 24 weeks.
    expect(plan.contracting).toBe(addWeeks("2026-06-24", 24));
  });
});

describe("nextStepInfo", () => {
  it("returns the step AFTER current_step with its planned date", () => {
    const o = opp({
      current_step: "meeting",
      step_dates: { qualify: "2026-07-01" },
    });
    const ns = nextStepInfo(o);
    expect(ns).not.toBeNull();
    expect(ns!.step).toBe("qualify");
    expect(ns!.date).toBe("2026-07-01");
    expect(ns!.label).toBe("Qualify — go / no-go");
    expect(ns!.short).toBe("Qualify");
  });

  it("returns null at the final step", () => {
    const o = opp({ current_step: "revenue" });
    expect(nextStepInfo(o)).toBeNull();
  });

  it("has an undefined date when the next step has no planned date", () => {
    const o = opp({ current_step: "meeting", step_dates: {} });
    expect(nextStepInfo(o)!.date).toBeUndefined();
  });
});

describe("advanceOpportunity", () => {
  it("stamps the reached step at today and re-plans later steps from today", () => {
    const o = opp({
      current_step: "meeting",
      step_dates: { meeting: "2026-01-01" },
    });
    const patch = advanceOpportunity(o, "2026-06-24");
    expect(patch).not.toBeNull();
    expect(patch!.current_step).toBe("qualify");
    // The reached step's date is stamped at today (actual).
    expect(patch!.step_dates!.qualify).toBe("2026-06-24");
    // The past meeting date is preserved.
    expect(patch!.step_dates!.meeting).toBe("2026-01-01");
    // probability suggested = the next step's prob.
    expect(patch!.probability).toBe(0.1);
    // A later step (pursuit, offset 2; qualify offset 1) is re-anchored to today + (2-1) weeks.
    expect(patch!.step_dates!.pursuit).toBe(addWeeks("2026-06-24", 1));
    // contracting (offset 24) re-anchored to today + (24-1) weeks.
    expect(patch!.step_dates!.contracting).toBe(addWeeks("2026-06-24", 23));
  });

  it("returns null at the final step", () => {
    const o = opp({ current_step: "revenue" });
    expect(advanceOpportunity(o, "2026-06-24")).toBeNull();
  });

  it("does not mutate the original opportunity's step_dates", () => {
    const original = opp({
      current_step: "meeting",
      step_dates: { meeting: "2026-01-01" },
    });
    advanceOpportunity(original, "2026-06-24");
    expect(original.step_dates).toEqual({ meeting: "2026-01-01" });
    expect(original.current_step).toBe("meeting");
  });
});

describe("nextMeetingDateISO", () => {
  it("is two calendar months after the first meeting", () => {
    expect(nextMeetingDateISO("2026-06-24")).toBe("2026-08-24");
  });
});
