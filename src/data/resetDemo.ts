// Clean re-seed guard for DEMO mode.
//
// Demo data is fully derived from the baked-in public/ files (contacts CSV + seed_meetings.json
// + seed_extras.json) and is meant to be ephemeral. But the per-store "applied" guards only stop
// a seed from RE-applying — they never CLEAR rows an earlier seed wrote. So when the generated
// dataset changes (new contact urls after a gen-demo run), the old meetings/opps/SoWs/owner-edits
// stay in localStorage pointing at urls that no longer exist → the orphan ("no longer match a
// contact") notice fires and the agenda fills with stale overdue items.
//
// Fix: stamp the demo data with a version. On boot in demo mode, if the stamp doesn't match the
// current version, WIPE the demo stores (and the apply-guards) so the fresh seed lands on a clean
// slate. This ONLY ever touches the bare "bob.*" demo keys — never the "bob.owned.*" namespace a
// purchased copy uses (and it's only called when getAppMode() === "demo").

import { getAppMode } from "../lib/appMode";

// Bump this whenever the generated demo dataset changes (after `npm run gen-demo`), to force every
// demo browser onto the new data with no stale leftovers.
export const DEMO_DATA_VERSION = "2026-06-25";

const STAMP_KEY = "bob.demoDataVersion";

// The demo-scoped stores + apply-guards that a re-seed must reset.
const DEMO_KEYS = [
  "bob.meetings.v2",
  "bob.opportunities.v2",
  "bob.revenue.v1",
  "bob.contactOwnerEdits.v1",
  "bob.seedApplied.v5",
  "bob.extrasSeedApplied.v4",
];

// Run BEFORE the seed bootstraps. No-op unless demo mode and the stamp is stale.
export function resetDemoIfStale(): void {
  if (getAppMode() !== "demo") return;
  try {
    if (localStorage.getItem(STAMP_KEY) === DEMO_DATA_VERSION) return;
    for (const k of DEMO_KEYS) localStorage.removeItem(k);
    localStorage.setItem(STAMP_KEY, DEMO_DATA_VERSION);
  } catch {
    /* best-effort — the app still boots if storage is unavailable */
  }
}
