import { describe, it, expect, vi, beforeEach } from "vitest";

// The store freezes STORAGE_KEY = scopedKey("bob.opportunities.v2") at module load. These
// tests exercise the canonical unscoped key, which is DEMO mode; the safe default is now
// "owned", so opt into demo BEFORE the store is imported (vi.hoisted runs above imports).
vi.hoisted(() => {
  (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__ = true;
});

import {
  loadAllOpportunities,
  saveAllOpportunities,
  saveOpportunity,
  deleteOpportunity,
  type Opportunity,
} from "./opportunities";

const KEY = "bob.opportunities.v2";

function opp(id: string, over: Partial<Opportunity> = {}): Opportunity {
  return {
    id,
    opportunity_name: `Opp ${id}`,
    organisation: "Acme",
    primary_contact: "Jane Doe",
    service_line: "Strategy",
    current_step: "pursuit",
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("{}", { status: 200 }),
  );
});

describe("loadAllOpportunities", () => {
  it("returns {} when nothing stored", () => {
    expect(loadAllOpportunities()).toEqual({});
  });

  it("returns {} and does not throw on malformed JSON", () => {
    localStorage.setItem(KEY, "not json{");
    expect(() => loadAllOpportunities()).not.toThrow();
    expect(loadAllOpportunities()).toEqual({});
  });

  it("uses the bob.opportunities.v2 key", () => {
    saveOpportunity(opp("o1"));
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });
});

describe("round-trip for already-migrated (new-shape) opportunities", () => {
  it("saves and reads back unchanged when current_step is present", () => {
    const o = opp("o1", {
      est_value: 100000,
      probability: 0.5,
      step_dates: { pursuit: "2026-01-01" },
    });
    saveOpportunity(o);
    expect(loadAllOpportunities()["o1"]).toEqual(o);
  });

  it("upserts without clobbering siblings", () => {
    saveOpportunity(opp("o1"));
    const all = saveOpportunity(opp("o2"));
    expect(Object.keys(all).sort()).toEqual(["o1", "o2"]);
  });
});

describe("saveAllOpportunities", () => {
  it("replaces the whole map", () => {
    saveOpportunity(opp("old"));
    saveAllOpportunities({ o1: opp("o1") });
    expect(Object.keys(loadAllOpportunities())).toEqual(["o1"]);
  });
});

describe("deleteOpportunity", () => {
  it("removes one and keeps the rest", () => {
    saveOpportunity(opp("o1"));
    saveOpportunity(opp("o2"));
    const all = deleteOpportunity("o1");
    expect(all["o1"]).toBeUndefined();
    expect(all["o2"]).toBeDefined();
  });
});

describe("legacy migration on read", () => {
  it("maps a legacy coarse stage to the granular current_step", () => {
    // Write a legacy-shaped opp directly (no current_step; has `stage`).
    const legacy = {
      o1: {
        id: "o1",
        opportunity_name: "Legacy",
        organisation: "Acme",
        primary_contact: "Jane",
        service_line: "Strategy",
        stage: "SoW Signed",
        date_identified: "2026-01-01",
      },
    };
    localStorage.setItem(KEY, JSON.stringify(legacy));

    const out = loadAllOpportunities()["o1"];
    expect(out.current_step).toBe("contracting"); // "SoW Signed" → contracting (Won)
    // The legacy `stage` field is dropped on the migrated shape.
    expect((out as Record<string, unknown>).stage).toBeUndefined();
    // The schedule is backfilled from the anchor date.
    expect(out.step_dates?.pursuit).toBeDefined();
  });

  it("maps the legacy Lost stage to the lost flag", () => {
    const legacy = {
      o1: {
        id: "o1",
        opportunity_name: "Lost deal",
        organisation: "Acme",
        primary_contact: "Jane",
        service_line: "Strategy",
        stage: "Lost",
      },
    };
    localStorage.setItem(KEY, JSON.stringify(legacy));
    const out = loadAllOpportunities()["o1"];
    expect(out.lost).toBe(true);
    expect(out.current_step).toBe("pursuit");
  });

  it("defaults an unknown/absent legacy stage to pursuit", () => {
    const legacy = {
      o1: {
        id: "o1",
        opportunity_name: "Bare",
        organisation: "Acme",
        primary_contact: "Jane",
        service_line: "Strategy",
      },
    };
    localStorage.setItem(KEY, JSON.stringify(legacy));
    expect(loadAllOpportunities()["o1"].current_step).toBe("pursuit");
  });

  it("is idempotent: re-saving a migrated opp preserves current_step", () => {
    const legacy = {
      o1: {
        id: "o1",
        opportunity_name: "Legacy",
        organisation: "Acme",
        primary_contact: "Jane",
        service_line: "Strategy",
        stage: "RFP Received",
      },
    };
    localStorage.setItem(KEY, JSON.stringify(legacy));
    const migrated = loadAllOpportunities()["o1"];
    saveOpportunity(migrated);
    expect(loadAllOpportunities()["o1"].current_step).toBe(migrated.current_step);
    expect(migrated.current_step).toBe("proposal_build");
  });
});
