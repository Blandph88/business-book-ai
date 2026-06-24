// Demo vs owned mode.
//   • The Freehold seal sets window.__FREEHOLD_DEMO__ = true for the free demo run and
//     false for a purchased (owned) copy — that's authoritative when present.
//   • Standalone (npm run dev / a bare build) defaults to DEMO (mock data), so opening
//     the app shows the populated sample. Force owned for testing with ?mode=owned (or ?demo=0).
//
// Demo = the explainer modal + baked-in mock contacts. Owned = the real LinkedIn import +
// the buyer's own data (no demo seeds).

export type AppMode = "demo" | "owned";

export function getAppMode(): AppMode {
  if (typeof window === "undefined") return "demo";
  const flag = (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__;
  if (typeof flag === "boolean") return flag ? "demo" : "owned";
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get("mode") === "owned" || p.get("demo") === "0") return "owned";
    if (p.get("mode") === "demo" || p.get("demo") === "1") return "demo";
  } catch {
    /* ignore */
  }
  return "demo";
}

export function isDemo(): boolean {
  return getAppMode() === "demo";
}
export function isOwned(): boolean {
  return getAppMode() === "owned";
}
