// Loads public/seed_extras.json into the Revenue (SoW) and owner-edits stores on first run, so
// the Revenue tab + the Contacts tab's owner columns + the dashboard priorities light up with the
// same mock dataset the contacts/meetings/opportunities seeds use.
//
// Applied at most once (an "applied" flag in localStorage), and MERGED non-destructively, so a
// user's own edits/deletions stick. Writes localStorage directly (one setItem per store) rather
// than calling saveSow/saveEdits per item, to avoid O(n²) re-reads on the ~700 owner-edit rows.

import { normalizeUrl } from "../storage/ownerEdits";

const APPLIED_KEY = "bob.extrasSeedApplied.v4";
const REVENUE_KEY = "bob.revenue.v1";
const EDITS_KEY = "bob.contactOwnerEdits.v1";

type SeedExtras = {
  sows?: Array<Record<string, unknown> & { id: string }>;
  ownerEdits?: Array<{ url: string; edits: Record<string, unknown> }>;
};

export async function bootstrapSeedExtras(): Promise<void> {
  try {
    if (localStorage.getItem(APPLIED_KEY)) return;
    const res = await fetch("seed_extras.json");
    if (!res.ok) return;
    const { sows = [], ownerEdits = [] } = (await res.json()) as SeedExtras;

    // SoWs → bob.revenue.v1. This is DEMO seed data (applied once per version bump), so the seed
    // wins — a version bump refreshes stale demo rows. The real product ships no seed_extras.
    const revRaw = localStorage.getItem(REVENUE_KEY);
    const revMap: Record<string, unknown> = revRaw ? JSON.parse(revRaw) : {};
    for (const s of sows) revMap[s.id] = s;
    localStorage.setItem(REVENUE_KEY, JSON.stringify(revMap));

    // Owner edits → bob.contactOwnerEdits.v1 (seed wins for the demo refresh).
    const edRaw = localStorage.getItem(EDITS_KEY);
    const edMap: Record<string, Record<string, unknown>> = edRaw ? JSON.parse(edRaw) : {};
    for (const oe of ownerEdits) {
      const k = normalizeUrl(oe.url);
      edMap[k] = { ...(edMap[k] ?? {}), ...oe.edits };
    }
    localStorage.setItem(EDITS_KEY, JSON.stringify(edMap));

    localStorage.setItem(APPLIED_KEY, "1");
  } catch {
    /* best-effort — the app still boots without the extras seed */
  }
}
