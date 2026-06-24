// Shared display formatting helpers. Kept in data/ (not a component) so every tab
// and the dashboard format money the same way.

// Display currency — a user setting (persisted in localStorage). Defaults to USD.
const CURRENCIES: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", AUD: "A$", CAD: "C$", AED: "AED ", SAR: "SAR " };
const CURRENCY_STORAGE_KEY = "bob.currency.v1";
export const CURRENCY_OPTIONS = Object.keys(CURRENCIES);

function loadCurrencyCode(): string {
  try {
    const c = localStorage.getItem(CURRENCY_STORAGE_KEY);
    return c && CURRENCIES[c] ? c : "USD";
  } catch {
    return "USD";
  }
}

export const CURRENCY_CODE = loadCurrencyCode();
export const CURRENCY_SYMBOL = CURRENCIES[CURRENCY_CODE];

// Change the display currency. Persists + reloads so every formatted value updates (money is
// formatted in many deep components; a soft reload is the simplest correct way to re-apply).
export function setCurrency(code: string): void {
  try { localStorage.setItem(CURRENCY_STORAGE_KEY, code); } catch { /* ignore */ }
  if (typeof location !== "undefined") location.reload();
}

// Format a number as money, with thousand separators and no decimal places.
export function formatMoney(value: number | undefined): string {
  const n = Number.isFinite(value) ? (value as number) : 0;
  return `${CURRENCY_SYMBOL}${Math.round(n).toLocaleString("en-US")}`;
}

// Format a 0–100 number as a whole-number percentage, e.g. 42.7 → "43%".
export function formatPct(value: number): string {
  return `${Math.round(value)}%`;
}
