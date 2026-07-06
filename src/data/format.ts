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

// Compact token count: <10k shows the full number (3,196); ≥10k → "10.5k"; ≥1m → "1.23m".
// Shared by the copilot "Thought for…" meta and the warmth-analysis banner.
export function formatTokens(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}m`;
  if (v >= 10_000) return `${(v / 1000).toFixed(1)}k`;
  return v.toLocaleString("en-US");
}

// Duration as "6h 37m 08s" / "37m 08s" / "8s" — larger units padded once a bigger unit is present.
export function formatDuration(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return "—";
  const s = Math.round(totalSec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${h}h ${pad(m)}m ${pad(sec)}s`;
  if (m > 0) return `${m}m ${pad(sec)}s`;
  return `${sec}s`;
}
