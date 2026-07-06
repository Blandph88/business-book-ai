// DEMO-ONLY: synthesize the signals the LLM analysis would produce (relationship warmth + latent
// opportunities) and the deterministic thread read (who owes a reply), so the sample book shows the whole
// feature "lit up" — the temperature chart, the Warmth column/filter, the owed-reply + opportunity cards —
// WITHOUT anyone running a scan (the demo has no real message threads to read). Fully deterministic (hashed
// off each contact's url), so the demo looks identical every load. NEVER used in the owned app — there the
// real pass writes these fields from the buyer's own messages.

import type { Contact, WarmthSentiment, LatentOpp, ThreadMeta } from "./contacts";

// Stable 0..1 hash of a string (FNV-1a) — deterministic pseudo-random per contact, no Date/Math.random.
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

const OPP_TEMPLATES = [
  "Exploring help with a data-migration project",
  "Mentioned they're hiring and could use advisory support",
  "Looking for a partner on a compliance review",
  "Scoping a cost-optimisation programme next quarter",
  "Asked about support with a systems integration",
  "Weighing an outsourced finance function",
  "Planning a market-entry study",
  "Wants help standing up a risk framework",
];
const DEMO_DATES = ["2026-06-28", "2026-06-19", "2026-06-09", "2026-05-27", "2026-05-14", "2026-04-30"];

export function seedDemoEnrichment(contacts: Contact[]): Contact[] {
  return contacts.map((c) => {
    // Only people you've actually corresponded with carry these signals (mirrors the real pass, which needs
    // inbound messages). Un-messaged connections stay blank — so the chart's population looks realistic.
    if (!(c.messaged || c.responded || c.two_way || c.agreed_to_meet || c.met)) return c;
    const h = hash01(c.url), h2 = hash01(c.url + "~");
    // Warmth: anchored to funnel depth, spread ±~1.4 so every level (keen→cold) is represented.
    const base = c.met ? 8.5 : c.agreed_to_meet ? 7.5 : c.two_way ? 6 : c.responded ? 5.5 : 4.3;
    const score = Math.max(1, Math.min(10, Math.round(base + (h * 2.8 - 1.4))));
    const warmthSentiment: WarmthSentiment = { score, at: "demo" };
    // Thread read: ~28% of correspondents messaged last (so YOU owe them a reply); plausible last-heard date.
    const theyLast = h2 > 0.72;
    const thread: ThreadMeta = {
      lastDate: DEMO_DATES[Math.floor(h2 * 997) % DEMO_DATES.length],
      lastFromOwner: !theyLast,
      inboundCount: 1 + Math.floor(h * 5),
      outboundCount: 1 + Math.floor(h2 * 5),
    };
    // Latent opportunity for ~18% of the more-engaged correspondents.
    const seeded: Contact = { ...c, warmthSentiment, thread };
    if ((c.responded || c.two_way || c.agreed_to_meet || c.met) && h2 > 0.82) {
      const opp: LatentOpp = { at: "demo", text: OPP_TEMPLATES[Math.floor(h * 331) % OPP_TEMPLATES.length] };
      seeded.latentOpp = opp;
    }
    return seeded;
  });
}
