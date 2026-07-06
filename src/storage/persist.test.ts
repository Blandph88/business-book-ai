import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// persist.ts computes its KEYS list (and holds the module-level endpointDead guard) at
// import time, so we reload it fresh in each test. These tests exercise the canonical
// unscoped "bob.*" keys, which correspond to DEMO mode — the safe default is now "owned",
// so we opt into demo explicitly before the module (and its KEYS) are evaluated.
let persist: typeof import("./persist");

beforeEach(async () => {
  localStorage.clear();
  (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__ = true;
  // Fresh module per test → KEYS recomputed for demo mode AND the endpointDead guard reset.
  vi.resetModules();
  persist = await import("./persist");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__;
});

describe("scopedKey", () => {
  it("returns the base key unchanged in demo mode", () => {
    expect(persist.scopedKey("bob.meetings.v2")).toBe("bob.meetings.v2");
    expect(persist.scopedKey("anything")).toBe("anything");
  });

  it("namespaces bob.* keys under bob.owned.* in owned mode", () => {
    (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__ = false;
    expect(persist.scopedKey("bob.meetings.v2")).toBe("bob.owned.meetings.v2");
  });

  it("prefixes non-bob keys with owned. in owned mode", () => {
    (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__ = false;
    expect(persist.scopedKey("foo")).toBe("owned.foo");
  });
});

describe("persistLocal", () => {
  it("writes the value to localStorage under the given key", () => {
    persist.persistLocal("bob.meetings.v2", JSON.stringify({ a: 1 }));
    expect(localStorage.getItem("bob.meetings.v2")).toBe(JSON.stringify({ a: 1 }));
  });

  it("schedules a debounced disk sync that POSTs a snapshot", () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    persist.persistLocal("bob.meetings.v2", JSON.stringify({ a: 1 }));
    // Debounced: nothing fires immediately.
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/owner-data");
    expect((opts as RequestInit).method).toBe("POST");
    // The snapshot body includes the persisted store.
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body["bob.meetings.v2"]).toEqual({ a: 1 });
  });

  it("does not throw when the disk endpoint rejects (fire-and-forget)", () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no endpoint"));
    expect(() => {
      persist.persistLocal("bob.revenue.v1", "{}");
      vi.advanceTimersByTime(300);
    }).not.toThrow();
  });
});

describe("syncToDisk", () => {
  it("debounces a burst of edits into a single POST", () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    persist.syncToDisk();
    persist.syncToDisk();
    persist.syncToDisk();
    vi.advanceTimersByTime(300);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("omits corrupt stores from the snapshot rather than writing garbage", () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    localStorage.setItem("bob.meetings.v2", "{not json");
    localStorage.setItem("bob.revenue.v1", JSON.stringify({ ok: true }));
    persist.syncToDisk();
    vi.advanceTimersByTime(300);

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body["bob.meetings.v2"]).toBeUndefined();
    expect(body["bob.revenue.v1"]).toEqual({ ok: true });
  });
});

describe("hydrateFromDisk", () => {
  it("restores a missing store from the disk file", async () => {
    const fileData = { "bob.meetings.v2": { m1: { id: "m1" } } };
    // GET returns the file; the re-seed POST resolves harmlessly via the same mock.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fileData), { status: 200 }),
    );

    await persist.hydrateFromDisk();
    expect(JSON.parse(localStorage.getItem("bob.meetings.v2")!)).toEqual({
      m1: { id: "m1" },
    });
  });

  it("does not overwrite a store the browser already has (live copy wins)", async () => {
    localStorage.setItem("bob.meetings.v2", JSON.stringify({ local: true }));
    const fileData = { "bob.meetings.v2": { fromDisk: true } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fileData), { status: 200 }),
    );

    await persist.hydrateFromDisk();
    expect(JSON.parse(localStorage.getItem("bob.meetings.v2")!)).toEqual({
      local: true,
    });
  });

  it("does nothing (keeps localStorage) when the endpoint is absent / not ok", async () => {
    localStorage.setItem("bob.revenue.v1", JSON.stringify({ keep: 1 }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 404 }),
    );
    await expect(persist.hydrateFromDisk()).resolves.toBeUndefined();
    expect(JSON.parse(localStorage.getItem("bob.revenue.v1")!)).toEqual({
      keep: 1,
    });
  });

  it("swallows a network error and leaves localStorage untouched", async () => {
    localStorage.setItem("bob.revenue.v1", JSON.stringify({ keep: 1 }));
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(persist.hydrateFromDisk()).resolves.toBeUndefined();
    expect(localStorage.getItem("bob.revenue.v1")).toBe(
      JSON.stringify({ keep: 1 }),
    );
  });
});
