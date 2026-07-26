// Loads public/seed_extras.json into the Revenue (SoW) and owner-edits stores on first run, so
// the Revenue tab + the Contacts tab's owner columns + the dashboard priorities light up with the
// same mock dataset the contacts/meetings/opportunities seeds use.
//
// Applied at most once (an "applied" flag in localStorage), and MERGED non-destructively, so a
// user's own edits/deletions stick. Writes localStorage directly (one setItem per store) rather
// than calling saveSow/saveEdits per item, to avoid O(n²) re-reads on the ~700 owner-edit rows.

import { normalizeUrl } from "../storage/ownerEdits";
import { loadAllOpportunities } from "../storage/opportunities";

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
    // AUTO-LINK unlinked seed SoWs to their obvious opportunity (Batch 2, retest dashboard cluster):
    // 10 of the 30 seed engagements shipped standalone, filling Housekeeping with "SoW not linked"
    // noise on first open. Match by organisation + the engagement's service word against the
    // opportunities store (seeded just before this in the bootstrap); a unique match links, anything
    // ambiguous stays for the Housekeeping card to teach with (a couple is realistic — 13 is noise).
    let oppList: Array<{ id: string; organisation?: string; opportunity_name?: string }> = [];
    try { oppList = Object.values(loadAllOpportunities()); } catch { /* linking is best-effort */ }
    // RE-ANCHOR engagement next-action dates to TODAY (re-verify item 32): the JSON's dates were
    // authored around SOW_DATE_ANCHOR and rot as real time passes — in a month the demo would open
    // on a wall of overdue engagement steps. Shift keeps the authored cadence; the THIN pass then
    // caps the coming week at 3 engagement items (the This-week list read as a wall of seed noise).
    const SOW_DATE_ANCHOR = "2026-07-24";
    const today = new Date().toISOString().slice(0, 10);
    const shiftDays = Math.round((Date.parse(today) - Date.parse(SOW_DATE_ANCHOR)) / 86_400_000);
    const shift = (iso: string): string => new Date(Date.parse(iso) + shiftDays * 86_400_000).toISOString().slice(0, 10);
    const inWeek: Array<Record<string, unknown>> = [];
    for (const s of sows) {
      if (typeof s.next_action_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.next_action_date)) {
        s.next_action_date = shift(s.next_action_date);
        const d = Date.parse(String(s.next_action_date));
        if (d >= Date.parse(today) - 7 * 86_400_000 && d <= Date.parse(today) + 7 * 86_400_000) inWeek.push(s);
      }
    }
    inWeek.sort((a, b) => String(a.next_action_date).localeCompare(String(b.next_action_date)));
    for (const s of inWeek.slice(3)) {
      s.next_action_date = new Date(Date.parse(String(s.next_action_date)) + 14 * 86_400_000).toISOString().slice(0, 10);
    }
    for (const s of sows) {
      if (!s.linked_opportunity_id && typeof s.organisation === "string" && typeof s.engagement_name === "string") {
        const svc = String(s.engagement_name).replace(/\s*engagement\s*$/i, "").toLowerCase();
        const cand = oppList.filter((o) => (o.organisation || "").toLowerCase() === String(s.organisation).toLowerCase() && (o.opportunity_name || "").toLowerCase().includes(svc));
        if (cand.length === 1) s.linked_opportunity_id = cand[0].id;
      }
      revMap[s.id] = s;
    }
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
