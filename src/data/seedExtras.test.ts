import { describe, it, expect, vi, beforeEach } from "vitest";
import { bootstrapSeedExtras } from "./seedExtras";
import { normalizeUrl } from "../storage/ownerEdits";

// localStorage keys the module writes (literal — seedExtras.ts uses these directly).
const APPLIED_KEY = "bob.extrasSeedApplied.v2";
const REVENUE_KEY = "bob.revenue.v1";
const EDITS_KEY = "bob.contactOwnerEdits.v1";

const fixture = {
  sows: [
    { id: "sow-1", name: "Alpha SoW", value: 100 },
    { id: "sow-2", name: "Beta SoW", value: 200 },
  ],
  ownerEdits: [
    { url: "https://linkedin.com/in/Jane/", edits: { priority: "High", notes: "seed note" } },
    { url: "https://linkedin.com/in/john", edits: { relationship_strength: "Warm" } },
  ],
};

function okResponse(json: unknown) {
  return { ok: true, json: async () => json } as unknown as Response;
}
function notOkResponse(status = 404) {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

function stubFetchOnce(json: unknown) {
  const mock = vi.fn(async () => okResponse(json));
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("bootstrapSeedExtras", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches seed_extras.json and writes SoWs keyed by id", async () => {
    const fetchMock = stubFetchOnce(fixture);
    await bootstrapSeedExtras();

    expect(fetchMock).toHaveBeenCalledWith("seed_extras.json");
    const rev = JSON.parse(localStorage.getItem(REVENUE_KEY)!);
    expect(rev["sow-1"]).toEqual({ id: "sow-1", name: "Alpha SoW", value: 100 });
    expect(rev["sow-2"]).toEqual({ id: "sow-2", name: "Beta SoW", value: 200 });
  });

  it("writes owner edits keyed by normalized url", async () => {
    stubFetchOnce(fixture);
    await bootstrapSeedExtras();

    const edits = JSON.parse(localStorage.getItem(EDITS_KEY)!);
    const janeKey = normalizeUrl("https://linkedin.com/in/Jane/");
    expect(edits[janeKey]).toEqual({ priority: "High", notes: "seed note" });
    expect(edits[normalizeUrl("https://linkedin.com/in/john")]).toEqual({
      relationship_strength: "Warm",
    });
  });

  it("sets the applied-once flag", async () => {
    stubFetchOnce(fixture);
    await bootstrapSeedExtras();
    expect(localStorage.getItem(APPLIED_KEY)).toBe("1");
  });

  it("is a no-op on the second call (apply-once guard)", async () => {
    const fetchMock = stubFetchOnce(fixture);
    await bootstrapSeedExtras();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call: the guard short-circuits before fetch.
    await bootstrapSeedExtras();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("second call does not overwrite the user's later edits", async () => {
    stubFetchOnce(fixture);
    await bootstrapSeedExtras();

    // Simulate the user editing a seeded row after the seed ran.
    const edits = JSON.parse(localStorage.getItem(EDITS_KEY)!);
    const janeKey = normalizeUrl("https://linkedin.com/in/Jane/");
    edits[janeKey] = { priority: "Low", notes: "user changed this" };
    localStorage.setItem(EDITS_KEY, JSON.stringify(edits));

    // Re-running bootstrap must NOT re-apply the seed (guard already set).
    await bootstrapSeedExtras();
    const after = JSON.parse(localStorage.getItem(EDITS_KEY)!);
    expect(after[janeKey]).toEqual({ priority: "Low", notes: "user changed this" });
  });

  it("merges non-destructively into a pre-existing revenue store", async () => {
    // A user/store already has an unrelated SoW; the seed must keep it.
    localStorage.setItem(
      REVENUE_KEY,
      JSON.stringify({ "user-sow": { id: "user-sow", name: "Mine" } }),
    );
    stubFetchOnce(fixture);
    await bootstrapSeedExtras();

    const rev = JSON.parse(localStorage.getItem(REVENUE_KEY)!);
    expect(rev["user-sow"]).toEqual({ id: "user-sow", name: "Mine" });
    expect(rev["sow-1"]).toBeDefined();
  });

  it("merges owner edits field-by-field into a pre-existing edit for the same url", async () => {
    const janeKey = normalizeUrl("https://linkedin.com/in/Jane/");
    localStorage.setItem(
      EDITS_KEY,
      JSON.stringify({ [janeKey]: { based_in: "London" } }),
    );
    stubFetchOnce(fixture);
    await bootstrapSeedExtras();

    const edits = JSON.parse(localStorage.getItem(EDITS_KEY)!);
    // Pre-existing field preserved, seed fields added (seed wins on overlap, but no overlap here).
    expect(edits[janeKey]).toEqual({
      based_in: "London",
      priority: "High",
      notes: "seed note",
    });
  });

  it("does nothing and sets no flag when the fetch is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => notOkResponse()));
    await bootstrapSeedExtras();

    expect(localStorage.getItem(APPLIED_KEY)).toBeNull();
    expect(localStorage.getItem(REVENUE_KEY)).toBeNull();
    expect(localStorage.getItem(EDITS_KEY)).toBeNull();
  });

  it("fails soft when fetch throws (app still boots)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    await expect(bootstrapSeedExtras()).resolves.toBeUndefined();
    expect(localStorage.getItem(APPLIED_KEY)).toBeNull();
  });

  it("tolerates an empty payload (no sows / no ownerEdits)", async () => {
    stubFetchOnce({});
    await bootstrapSeedExtras();

    expect(JSON.parse(localStorage.getItem(REVENUE_KEY)!)).toEqual({});
    expect(JSON.parse(localStorage.getItem(EDITS_KEY)!)).toEqual({});
    expect(localStorage.getItem(APPLIED_KEY)).toBe("1");
  });
});
