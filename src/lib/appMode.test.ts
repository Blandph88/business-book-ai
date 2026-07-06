import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getAppMode, isDemo, isOwned } from "./appMode";

// Helper: point window.location.search at a given query string.
function setSearch(search: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, search },
  });
}

beforeEach(() => {
  localStorage.clear();
  delete (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__;
  setSearch("");
});

afterEach(() => {
  delete (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__;
  setSearch("");
});

describe("getAppMode — the __FREEHOLD_DEMO__ flag is authoritative", () => {
  it("flag true → demo", () => {
    (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__ = true;
    expect(getAppMode()).toBe("demo");
  });

  it("flag false → owned", () => {
    (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__ = false;
    expect(getAppMode()).toBe("owned");
  });

  it("the flag overrides a conflicting query param", () => {
    (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__ = true;
    setSearch("?mode=owned");
    expect(getAppMode()).toBe("demo");
  });
});

describe("getAppMode — query params when no flag is set", () => {
  it("?mode=owned → owned", () => {
    setSearch("?mode=owned");
    expect(getAppMode()).toBe("owned");
  });

  it("?demo=0 → owned", () => {
    setSearch("?demo=0");
    expect(getAppMode()).toBe("owned");
  });

  it("?mode=demo → demo", () => {
    setSearch("?mode=demo");
    expect(getAppMode()).toBe("demo");
  });

  it("?demo=1 → demo", () => {
    setSearch("?demo=1");
    expect(getAppMode()).toBe("demo");
  });

  it("an unrelated query param falls through to the default", () => {
    setSearch("?foo=bar");
    expect(getAppMode()).toBe("owned");
  });
});

describe("getAppMode — default", () => {
  it("no flag and no params → owned (safe default)", () => {
    expect(getAppMode()).toBe("owned");
  });
});

describe("isDemo / isOwned", () => {
  it("track getAppMode", () => {
    setSearch("?mode=owned");
    expect(isOwned()).toBe(true);
    expect(isDemo()).toBe(false);

    setSearch("?demo=1");
    expect(isDemo()).toBe(true);
    expect(isOwned()).toBe(false);
  });
});
