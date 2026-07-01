// Demo vs owned mode.
//   • The Freehold seal sets window.__FREEHOLD_DEMO__ = true for the free demo run and
//     false for a purchased (owned) copy — that's authoritative when present (the host always sets it).
//   • SAFE DEFAULT: when NOTHING says demo (flag missing AND no ?demo=1), we boot to OWNED (clean).
//     A paying buyer must NEVER see baked-in mock data by accident — showing a payer fake data is far
//     worse than a bare preview being empty. For a populated LOCAL preview, add ?demo=1 to the URL.
//
// Demo = the explainer modal + baked-in mock contacts. Owned = the real LinkedIn import +
// the buyer's own data (no demo seeds).

export type AppMode = "demo" | "owned";

export function getAppMode(): AppMode {
  if (typeof window === "undefined") return "owned";
  const flag = (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__;
  if (typeof flag === "boolean") return flag ? "demo" : "owned"; // the seal's flag is authoritative
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get("mode") === "demo" || p.get("demo") === "1") return "demo"; // opt in to demo for a preview
    if (p.get("mode") === "owned" || p.get("demo") === "0") return "owned";
  } catch {
    /* ignore */
  }
  return "owned"; // safe default: never show a payer mock data if the flag is somehow absent
}

export function isDemo(): boolean {
  return getAppMode() === "demo";
}
export function isOwned(): boolean {
  return getAppMode() === "owned";
}
