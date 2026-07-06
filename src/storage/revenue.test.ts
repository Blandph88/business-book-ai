import { describe, it, expect, vi, beforeEach } from "vitest";

// The store freezes STORAGE_KEY = scopedKey("bob.revenue.v1") at module load. These tests
// exercise the canonical unscoped key, which is DEMO mode; the safe default is now "owned",
// so opt into demo BEFORE the store module is imported (vi.hoisted runs above imports).
vi.hoisted(() => {
  (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__ = true;
});

import { loadAllSows, saveSow, deleteSow, type Sow } from "./revenue";

const KEY = "bob.revenue.v1";

function sow(id: string, over: Partial<Sow> = {}): Sow {
  return {
    id,
    organisation: "Acme",
    engagement_name: `Engagement ${id}`,
    service_line: "Strategy",
    status: "Active",
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("{}", { status: 200 }),
  );
});

describe("loadAllSows", () => {
  it("returns {} when nothing stored", () => {
    expect(loadAllSows()).toEqual({});
  });

  it("returns {} and does not throw on malformed JSON", () => {
    localStorage.setItem(KEY, "{oops");
    expect(() => loadAllSows()).not.toThrow();
    expect(loadAllSows()).toEqual({});
  });

  it("uses the bob.revenue.v1 key", () => {
    saveSow(sow("s1"));
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });
});

describe("saveSow round-trip", () => {
  it("saves and reads back the same SoW", () => {
    const s = sow("s1", { day_rate: 5000, chargeable_hours: 160, recognised_to_date: 1000 });
    saveSow(s);
    expect(loadAllSows()["s1"]).toEqual(s);
  });

  it("upserts without clobbering siblings", () => {
    saveSow(sow("s1"));
    const all = saveSow(sow("s2"));
    expect(Object.keys(all).sort()).toEqual(["s1", "s2"]);
  });

  it("overwrites the same id on re-save", () => {
    saveSow(sow("s1", { status: "Active" }));
    const all = saveSow(sow("s1", { status: "Completed" }));
    expect(all["s1"].status).toBe("Completed");
    expect(Object.keys(all)).toHaveLength(1);
  });
});

describe("deleteSow", () => {
  it("removes one and keeps the rest", () => {
    saveSow(sow("s1"));
    saveSow(sow("s2"));
    const all = deleteSow("s1");
    expect(all["s1"]).toBeUndefined();
    expect(all["s2"]).toBeDefined();
    expect(loadAllSows()["s1"]).toBeUndefined();
  });
});
