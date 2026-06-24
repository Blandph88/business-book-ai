// Dashboard-only derived helpers: stale relationships, win/loss, and stage-aging.
// Pure functions with "today" injected (ISO string), like ../data/agenda.ts, so they
// stay testable and never make the impure `new Date()` call themselves.

import type { Contact } from "./contacts";
import type { MeetingRow } from "./meetings";
import { editsFor, type OwnerEdits } from "../storage/ownerEdits";
import type { Opportunity } from "../storage/opportunities";
import type { Sow } from "../storage/revenue";
import type { TabId } from "../components/TabNav";
import { opportunityStatus } from "./opportunities";
import {
  SENIORITY,
  OPPORTUNITY_PHASES,
  OPPORTUNITY_STEPS,
  stepIndex,
  stepShort,
  WON_STEP,
} from "./vocab";

// Relationship strengths that are worth maintaining (a "Cold" lead going quiet is fine).
const WARM = new Set(["Warm", "Strong", "Champion"]);

// Importance scoring weights (tunable). Seniority: Executive Leadership highest …
// Associate lowest (derived from the §5 SENIORITY order). Decision role + priority nudge.
const SENIORITY_RANK: Record<string, number> = Object.fromEntries(
  SENIORITY.map((s, i) => [s, SENIORITY.length - i]),
);
const DECISION_RANK: Record<string, number> = {
  "Decision Maker": 3,
  Influencer: 2,
  Gatekeeper: 1,
  Unknown: 0,
};

// How close an OPEN opportunity is to signature (0 = just identified, ~1 = about to sign).
function proximity(opp: Opportunity): number {
  const wonIdx = stepIndex(WON_STEP);
  return wonIdx ? Math.min(1, stepIndex(opp.current_step) / wonIdx) : 0;
}

// Whole days from an earlier ISO date to `today` (positive = in the past).
function daysAgo(fromISO: string, today: string): number {
  const a = new Date(`${fromISO}T00:00:00`).getTime();
  const b = new Date(`${today}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

// ── Stale relationships ─────────────────────────────────────────────────────
// Warm/Strong/Champion contacts you haven't logged contact with in `days`+ (or ever) —
// the relationships most at risk of going cold. `daysSince` is null when never logged.
export type StaleContact = {
  contact: Contact;
  relationship: string;
  daysSince: number | null;
};

export function staleContacts(
  contacts: Contact[],
  edits: Record<string, OwnerEdits>,
  lastMet: Record<string, string>,
  today: string,
  days = 45,
): StaleContact[] {
  const out: StaleContact[] = [];
  for (const c of contacts) {
    const e = editsFor(edits, c.url);
    const rel = e?.relationship_strength;
    if (!rel || !WARM.has(rel)) continue;
    // "Last met" is the most recent held meeting (null = never met).
    const met = lastMet[c.url];
    const daysSince = met ? daysAgo(met, today) : null;
    if (daysSince === null || daysSince >= days) {
      out.push({ contact: c, relationship: rel, daysSince });
    }
  }
  // Most overdue first; "never logged" (null) sorts to the very top.
  out.sort((a, b) => (b.daysSince ?? Infinity) - (a.daysSince ?? Infinity));
  return out;
}

// ── Win / loss ──────────────────────────────────────────────────────────────
// Win rate over DECIDED opportunities (Won + Lost); null while nothing is decided yet.
export type WinLoss = { won: number; lost: number; winRate: number | null };

export function winLossStats(opps: Opportunity[]): WinLoss {
  let won = 0;
  let lost = 0;
  for (const o of opps) {
    const s = opportunityStatus(o);
    if (s === "Won") won++;
    else if (s === "Lost") lost++;
  }
  const decided = won + lost;
  return { won, lost, winRate: decided ? won / decided : null };
}

// ── Stage aging ─────────────────────────────────────────────────────────────
// OPEN opportunities with no movement in `days`+ — using the latest milestone date
// reached as the "last activity". Opportunities with no dates at all are skipped (we
// can't tell whether they're stale). Most stale first.
export type AgingOpp = { opp: Opportunity; daysSince: number };

function latestOppDate(o: Opportunity): string | undefined {
  const dates = Object.values(o.step_dates ?? {}).filter(
    (d): d is string => Boolean(d),
  );
  return dates.length ? dates.sort().pop() : undefined;
}

export function agingOpportunities(
  opps: Opportunity[],
  today: string,
  days = 30,
): AgingOpp[] {
  const out: AgingOpp[] = [];
  for (const o of opps) {
    if (opportunityStatus(o) !== "Open") continue;
    const last = latestOppDate(o);
    if (!last) continue;
    const daysSince = daysAgo(last, today);
    if (daysSince >= days) out.push({ opp: o, daysSince });
  }
  out.sort((a, b) => b.daysSince - a.daysSince);
  return out;
}

// ── Priorities: "Close these" (hot opportunities) ────────────────────────────
// OPEN opportunities ranked by est_value × proximity-to-signature — big deals near the
// finish line lead (rather than pure weighted value, which over-rewards early big bets).
export type HotOpp = { opp: Opportunity; score: number; signBy?: string };

export function hotOpportunities(opps: Opportunity[], limit = 5): HotOpp[] {
  return opps
    .filter((o) => opportunityStatus(o) === "Open")
    .map((o) => ({
      opp: o,
      score: (o.est_value ?? 0) * proximity(o),
      signBy: o.step_dates?.[WON_STEP],
    }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ── Priorities: "Key relationships" ──────────────────────────────────────────
// Contacts ranked by seniority × decision-role, boosted when they're attached to a live
// (open) opportunity — especially a late-stage one. The manual priority flag only nudges.
export type KeyContact = { contact: Contact; score: number; reason: string };

export function keyContacts(
  contacts: Contact[],
  edits: Record<string, OwnerEdits>,
  opps: Opportunity[],
  limit = 6,
): KeyContact[] {
  // The best (closest-to-sign) open opportunity per contact url.
  const best = new Map<string, { prox: number; step: string }>();
  for (const o of opps) {
    if (opportunityStatus(o) !== "Open" || !o.contact_url) continue;
    const prox = proximity(o);
    const prev = best.get(o.contact_url);
    if (!prev || prox > prev.prox) {
      best.set(o.contact_url, { prox, step: stepShort(o.current_step) });
    }
  }

  return contacts
    .map((c) => {
      const e = editsFor(edits, c.url);
      const sen = SENIORITY_RANK[c.seniority] ?? 0;
      const dr = DECISION_RANK[e?.decision_role ?? "Unknown"] ?? 0;
      const deal = best.get(c.url);
      const dealBoost = deal ? 1 + deal.prox : 1;
      const priorityBoost =
        e?.priority === "High" ? 1.6 : e?.priority === "Low" ? 0.6 : 1;
      const score = sen * (dr + 1) * dealBoost * priorityBoost;
      const reason = [
        deal ? `${deal.step} deal` : null,
        c.seniority || null,
        e?.decision_role && e.decision_role !== "Unknown" ? e.decision_role : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return { contact: c, score, reason: reason || "—" };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ── Opportunity stage funnel (snapshot, not historical transitions) ──────────
// How many opportunities have REACHED each phase = their current step is at or past that
// phase's first step (won + lost included, since they did pass through). The retained %
// between phases shows where deals leak. Bars sum down, not across.
export type PhaseReached = { phase: string; reached: number; pct: number };

export function phaseReachedFunnel(opps: Opportunity[]): {
  items: PhaseReached[];
  total: number;
} {
  const total = opps.length;
  const items = OPPORTUNITY_PHASES.map((phase) => {
    const firstIdx = OPPORTUNITY_STEPS.findIndex((s) => s.phase === phase);
    const reached = opps.filter(
      (o) => stepIndex(o.current_step) >= firstIdx,
    ).length;
    return { phase, reached, pct: total ? reached / total : 0 };
  });
  return { items, total };
}

// ── Loose ends: cross-record gaps the app can detect and you can fix ─────────
// Structural inconsistencies that nothing else surfaces (write-ups are already nagged in
// This week, so they're excluded here). Each item deep-links to the record to fix.
export type LooseEnd = { label: string; meta: string; tab: TabId; openId: string };
export type LooseEndGroup = { key: string; title: string; items: LooseEnd[] };

export function looseEnds(
  opps: Opportunity[],
  contacts: Contact[],
  edits: Record<string, OwnerEdits>,
  sows: Sow[],
): LooseEndGroup[] {
  const byUrl = new Map(contacts.map((c) => [c.url, c]));
  const linkedOppIds = new Set(
    sows.map((s) => s.linked_opportunity_id).filter(Boolean) as string[],
  );

  // Won deals with no SoW yet — revenue isn't being captured.
  const wonNoSow: LooseEnd[] = opps
    .filter((o) => opportunityStatus(o) === "Won" && !linkedOppIds.has(o.id))
    .map((o) => ({
      label: o.opportunity_name || o.organisation || "(unnamed)",
      meta: "Won · no SoW yet",
      tab: "opportunities",
      openId: o.id,
    }));

  // Open deals with no estimated value — the pipeline figure under-counts them.
  const openNoValue: LooseEnd[] = opps
    .filter((o) => opportunityStatus(o) === "Open" && !o.est_value)
    .map((o) => ({
      label: o.opportunity_name || o.organisation || "(unnamed)",
      meta: `${stepShort(o.current_step)} · no estimated value`,
      tab: "opportunities",
      openId: o.id,
    }));

  // Live deals where we haven't flagged who decides (deduped by contact).
  const seen = new Set<string>();
  const noDecisionMaker: LooseEnd[] = [];
  for (const o of opps) {
    if (opportunityStatus(o) !== "Open" || !o.contact_url) continue;
    if (seen.has(o.contact_url)) continue;
    const dr = editsFor(edits, o.contact_url)?.decision_role;
    if (dr && dr !== "Unknown") continue;
    seen.add(o.contact_url);
    const c = byUrl.get(o.contact_url);
    noDecisionMaker.push({
      label: c ? `${c.first} ${c.last}`.trim() : o.primary_contact || "(contact)",
      meta: `${o.organisation} · decision-maker not flagged`,
      tab: "contacts",
      openId: o.contact_url,
    });
  }

  // SoWs entered standalone (no opportunity) — break the pipeline→revenue trail.
  const sowNoOpp: LooseEnd[] = sows
    .filter((s) => !s.linked_opportunity_id)
    .map((s) => ({
      label: s.engagement_name || s.organisation || "(SoW)",
      meta: "SoW · not linked to an opportunity",
      tab: "revenue",
      openId: s.id,
    }));

  return [
    { key: "wonNoSow", title: "Won, no SoW", items: wonNoSow },
    { key: "openNoValue", title: "Open, no value", items: openNoValue },
    { key: "noDecisionMaker", title: "Decision-maker not flagged", items: noDecisionMaker },
    { key: "sowNoOpp", title: "SoW not linked", items: sowNoOpp },
  ].filter((g) => g.items.length > 0);
}

// ── This-month activity (meetings held, opportunities created) vs last month ──
export type ActivityStats = {
  // Distinct PEOPLE met (deduped by contact), not raw meeting count — meeting someone
  // twice in a month is still one person met.
  peopleMet: { thisMonth: number; lastMonth: number };
  oppsCreated: { thisMonth: number; lastMonth: number };
};

export function activityStats(
  meetingRows: MeetingRow[],
  opps: Opportunity[],
  today: string,
): ActivityStats {
  const [y, m] = today.split("-").map(Number);
  const thisM = `${y}-${String(m).padStart(2, "0")}`;
  const lastM =
    m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const monthOf = (iso?: string) => (iso ? iso.slice(0, 7) : "");

  // Distinct contacts with a meeting HELD in the month.
  const met = (month: string) =>
    new Set(
      meetingRows
        .filter((r) => monthOf(r.date_held) === month)
        .map((r) => r.contact_url),
    ).size;
  const created = (month: string) =>
    opps.filter((o) => monthOf(o.step_dates?.meeting) === month).length;

  return {
    peopleMet: { thisMonth: met(thisM), lastMonth: met(lastM) },
    oppsCreated: { thisMonth: created(thisM), lastMonth: created(lastM) },
  };
}
