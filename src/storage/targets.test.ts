import { describe, it, expect, vi, beforeEach } from "vitest";

// The store freezes STORAGE_KEY = scopedKey("bob.targets.v1") at module load. These tests
// exercise the canonical unscoped key, which is DEMO mode; the safe default is now "owned",
// so opt into demo BEFORE the store module is imported (vi.hoisted runs above imports).
vi.hoisted(() => {
  (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__ = true;
});

import { loadTargets, saveTargets, type Targets } from "./targets";

const KEY = "bob.targets.v1";

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("{}", { status: 200 }),
  );
});

describe("loadTargets", () => {
  it("returns {} when nothing stored", () => {
    expect(loadTargets()).toEqual({});
  });

  it("returns {} and does not throw on malformed JSON", () => {
    localStorage.setItem(KEY, "}{not json");
    expect(() => loadTargets()).not.toThrow();
    expect(loadTargets()).toEqual({});
  });
});

describe("saveTargets round-trip", () => {
  it("saves under bob.targets.v1 and reads back", () => {
    const t: Targets = { pipeline: 1000000, meetingsPerMonth: 12 };
    saveTargets(t);
    expect(localStorage.getItem(KEY)).not.toBeNull();
    expect(loadTargets()).toEqual(t);
  });

  it("save replaces the whole object (not a merge)", () => {
    saveTargets({ pipeline: 100, meetingsPerMonth: 5 });
    saveTargets({ pipeline: 200 });
    expect(loadTargets()).toEqual({ pipeline: 200 });
  });

  it("returns the saved object", () => {
    const t: Targets = { pipeline: 42 };
    expect(saveTargets(t)).toEqual(t);
  });
});
