import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatMoney,
  formatPct,
  setCurrency,
  subscribeCurrency,
  CURRENCY_OPTIONS,
  CURRENCY_CODE,
  CURRENCY_SYMBOL,
} from "./format";

const CURRENCY_STORAGE_KEY = "bob.currency.v1";

beforeEach(() => {
  localStorage.clear();
});

// ── MODULE-LOAD CONSTANTS (default state, no stored setting) ────────────────────────────────
describe("currency defaults", () => {
  it("defaults to USD when nothing is persisted", () => {
    // The test suite starts with no stored currency, so the module-level
    // constants reflect the USD default.
    expect(CURRENCY_CODE).toBe("USD");
    expect(CURRENCY_SYMBOL).toBe("$");
  });

  it("exposes the supported currency codes", () => {
    expect(CURRENCY_OPTIONS).toEqual(["USD", "GBP", "EUR", "AUD", "CAD", "AED", "SAR"]);
  });
});

// ── formatMoney ─────────────────────────────────────────────────────────────────────────────
describe("formatMoney", () => {
  it("prefixes the default $ symbol", () => {
    expect(formatMoney(100)).toBe("$100");
  });

  it("adds thousand separators with no decimals", () => {
    expect(formatMoney(1000)).toBe("$1,000");
    expect(formatMoney(1234567)).toBe("$1,234,567");
  });

  it("rounds to whole numbers (half-up)", () => {
    expect(formatMoney(42.7)).toBe("$43");
    expect(formatMoney(42.4)).toBe("$42");
    expect(formatMoney(0.5)).toBe("$1"); // Math.round rounds .5 up
    expect(formatMoney(2.5)).toBe("$3");
  });

  it("handles zero", () => {
    expect(formatMoney(0)).toBe("$0");
  });

  it("handles negatives", () => {
    expect(formatMoney(-1234)).toBe("$-1,234");
    expect(formatMoney(-2.5)).toBe("$-2"); // Math.round(-2.5) === -2 (rounds toward +∞)
    // Math.round(-0.4) === -0, and (-0).toLocaleString() === "-0" → "$-0".
    expect(formatMoney(-0.4)).toBe("$-0");
  });

  it("handles very large numbers", () => {
    expect(formatMoney(1000000000)).toBe("$1,000,000,000");
  });

  it("treats undefined / NaN / Infinity as 0", () => {
    expect(formatMoney(undefined)).toBe("$0");
    expect(formatMoney(NaN)).toBe("$0");
    expect(formatMoney(Infinity)).toBe("$0");
    expect(formatMoney(-Infinity)).toBe("$0");
  });
});

// ── formatPct ───────────────────────────────────────────────────────────────────────────────
describe("formatPct", () => {
  it("rounds to a whole-number percentage", () => {
    expect(formatPct(42.7)).toBe("43%");
    expect(formatPct(42.4)).toBe("42%");
  });

  it("handles boundaries 0 and 100", () => {
    expect(formatPct(0)).toBe("0%");
    expect(formatPct(100)).toBe("100%");
  });

  it("rounds .5 up", () => {
    expect(formatPct(49.5)).toBe("50%");
  });
});

// ── setCurrency (persistence + in-place update, NO reload) ────────────────────────────────────
describe("setCurrency", () => {
  it("persists the chosen currency to localStorage", () => {
    setCurrency("GBP");
    expect(localStorage.getItem(CURRENCY_STORAGE_KEY)).toBe("GBP");
  });

  it("updates the live symbol in place (no reload) so formatted values re-apply", () => {
    setCurrency("EUR");
    expect(formatMoney(1000)).toBe("€1,000");
    setCurrency("GBP");
    expect(formatMoney(1000)).toBe("£1,000");
  });

  it("notifies subscribers so the app can re-render without a reload", () => {
    const cb = vi.fn();
    const unsub = subscribeCurrency(cb);
    setCurrency("AUD");
    expect(cb).toHaveBeenCalledOnce();
    unsub();
    setCurrency("USD");
    expect(cb).toHaveBeenCalledOnce(); // no further calls after unsubscribe
  });

  it("persists any code but falls back to a safe symbol on an unknown one", () => {
    setCurrency("ZZZ");
    expect(localStorage.getItem(CURRENCY_STORAGE_KEY)).toBe("ZZZ"); // validation happens on read
    expect(formatMoney(1000)).toBe("$1,000"); // unknown → USD symbol, never undefined
  });
});

// ── persisted-setting round-trip (re-imported module reflects stored currency) ──────────────
describe("persisted currency round-trip", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("loads GBP and formats with £ when GBP is stored before import", async () => {
    localStorage.setItem(CURRENCY_STORAGE_KEY, "GBP");
    vi.resetModules();
    const mod = await import("./format");
    expect(mod.CURRENCY_CODE).toBe("GBP");
    expect(mod.CURRENCY_SYMBOL).toBe("£");
    expect(mod.formatMoney(1000)).toBe("£1,000");
  });

  it("loads the multi-char AED symbol with its trailing space", async () => {
    localStorage.setItem(CURRENCY_STORAGE_KEY, "AED");
    vi.resetModules();
    const mod = await import("./format");
    expect(mod.CURRENCY_SYMBOL).toBe("AED ");
    expect(mod.formatMoney(2500)).toBe("AED 2,500");
  });

  it("falls back to USD when the stored code is not a known currency", async () => {
    localStorage.setItem(CURRENCY_STORAGE_KEY, "ZZZ");
    vi.resetModules();
    const mod = await import("./format");
    expect(mod.CURRENCY_CODE).toBe("USD");
    expect(mod.CURRENCY_SYMBOL).toBe("$");
  });
});
