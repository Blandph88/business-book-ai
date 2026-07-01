// Pure logic for the Opportunities tab (CLAUDE.md §4/§7), kept separate from the
// component like ../data/meetings.ts and ../data/metrics.ts so the calculations and
// the meeting→opportunity rules live in one readable, testable place.

import type { Opportunity } from "../storage/opportunities";
import type { Meeting, MeetingsById } from "../storage/meetings";
import type { Contact } from "./contacts";
import type { ContactInfo } from "./meetings";
import type { Breakdown } from "./metrics";
import {
  OPPORTUNITY_PHASES,
  SECTOR_GROUPS,
  SERVICE_LINE,
  OTHER_FUNCTIONS,
  stepDef,
  stepIndex,
  WON_STEP,
} from "./vocab";
import type { ServiceLine, OpportunityPhase } from "./vocab";
import { planStepDates } from "./timeline";

// The §6 rule-4 auto-calc, in ONE place: weighted value = est_value × probability.
// A missing number counts as 0 so a half-filled opportunity still returns a number
// rather than NaN. This is never stored — always derived from the current row.
export function weightedValue(opp: Opportunity): number {
  return (opp.est_value ?? 0) * (opp.probability ?? 0);
}

// The opportunity name WITHOUT a redundant leading "Org — " (some are stored as "JPMorgan — Strategy
// engagement", which doubles the company when shown next to an Organisation column/field). Display-only.
export function oppDisplayName(opp: { opportunity_name?: string; organisation?: string }): string {
  const name = (opp.opportunity_name || "").trim() || "(unnamed)";
  const org = (opp.organisation || "").trim();
  if (org) {
    const m = name.match(new RegExp(`^${org.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[—-]\\s*(.+)$`, "i"));
    if (m && m[1].trim()) return m[1].trim();
  }
  return name;
}

// ── Buyer function → your service line (a smart default, not a rule) ─────────
// When an opportunity's buyer function is set (from the linked contact or by hand),
// the form pre-fills your service line from this table. It's only a starting point —
// the service line stays fully editable. Functions are the classifier's categories
// (data/classify.ts); anything not listed → no suggestion (keeps whatever's there).
// EDIT THIS TABLE to match how you actually sell.
const FUNCTION_TO_SERVICE_LINE: Record<string, ServiceLine> = {
  "Risk & Audit": "Risk & Compliance",
  "Legal & Compliance": "Risk & Compliance",
  "Finance & Accounting": "Finance & Deals",
  "Strategy & Corporate Development": "Strategy",
  "Technology & Engineering": "Technology",
  "Product & Design": "Technology",
  "Data & Analytics": "Data & Analytics",
  "Operations & Supply Chain": "Operations",
  "Human Resources": "People & Change",
  "Sales & Marketing": "Other",
  "Customer & Support": "Operations",
  "Research & Development": "Strategy",
  "General Management": "Strategy",
  [OTHER_FUNCTIONS]: "Other",
};

// The suggested service line for a buyer function, or undefined if there's no mapping
// (caller keeps the current value). Pure lookup — never overrides a value silently;
// the form decides when to apply it.
export function serviceLineForFunction(fn: string | undefined): ServiceLine | undefined {
  return fn ? FUNCTION_TO_SERVICE_LINE[fn] : undefined;
}

// ── Dashboard aggregates (CLAUDE.md §4) ──────────────────────────────────────

// The phase an opportunity rolls up to for the funnels: its current step's phase, or
// "Lost" when the deal is lost (a terminal outcome that overrides the workflow position).
export const LOST_PHASE = "Lost" as const;
export function opportunityPhase(opp: Opportunity): OpportunityPhase | "Lost" {
  if (opp.lost) return LOST_PHASE;
  // Defensive: an unknown step can't crash the funnels — fall back to the first phase.
  const def = stepDef(opp.current_step);
  return def ? def.phase : OPPORTUNITY_PHASES[0];
}

// Opportunity pipeline by PHASE, as a Breakdown so the Dashboard/Metrics can render it
// with the same card + §6 sum-check used for the contact breakdowns. We iterate the FIXED
// phase list (+ a terminal "Lost" bucket), so empty phases show a 0 bar and the bars
// always sum to the total.
export function pipelineByPhase(opps: Opportunity[]): Breakdown {
  const labels: string[] = [...OPPORTUNITY_PHASES, LOST_PHASE];
  const items = labels.map((label) => ({
    label,
    count: opps.filter((o) => opportunityPhase(o) === label).length,
  }));
  const total = opps.length;
  const summed = items.reduce((acc, item) => acc + item.count, 0);
  return { items, total, sumsToTotal: summed === total };
}

// The opportunities sitting in a given funnel phase. Used by the dashboard/metrics so a
// click on a phase bar drills into exactly the opportunities it counts — the same
// grouping `pipelineByPhase` uses, so count and list always agree.
export function opportunitiesForPhase(
  opps: Opportunity[],
  phase: string,
): Opportunity[] {
  return opps.filter((o) => opportunityPhase(o) === phase);
}

// ── Opportunity → contact → sector group ─────────────────────────────────────

// The label for opportunities we can't map to a contact's sector group. Pinned last
// and de-emphasised in charts (same treatment as "Other Functions", §6 rule 3).
export const UNASSIGNED_GROUP = "Unassigned";

// Resolve the contact an opportunity maps to: its explicit `contact_url` if set, else
// (for auto-created opps) follow source_meeting_id → meeting.contact_url. Returns the
// Contact, or null if there's no link or the contact isn't in the current CSV.
export function opportunityContact(
  opp: Opportunity,
  contactsByUrl: Map<string, Contact>,
  meetings: MeetingsById,
): Contact | null {
  let url = opp.contact_url;
  if (!url && opp.source_meeting_id) {
    url = meetings[opp.source_meeting_id]?.contact_url;
  }
  return url ? contactsByUrl.get(url) ?? null : null;
}

// One sector-group bucket of opportunities: how many, their total weighted value, and
// the opportunities themselves (so a click drills into exactly them).
export type OppGroupItem = {
  label: string;
  count: number;
  weighted: number;
  opps: Opportunity[];
};
export type OppGroupBreakdown = {
  items: OppGroupItem[]; // five sector groups (in §5 order) + "Unassigned" last
  total: number;
  weightedTotal: number;
  sumsToTotal: boolean;
};

// Group opportunities by the sector group of the contact they map to, matching the
// contact charts' five buckets. Opportunities with no resolvable contact (or whose
// contact has dropped out of the CSV) fall into "Unassigned", kept last. Each bucket
// carries both a count and a summed weighted value (§6 rule 4 — always derived).
export function opportunitiesBySectorGroup(
  opps: Opportunity[],
  contacts: Contact[],
  meetings: MeetingsById,
): OppGroupBreakdown {
  const byUrl = new Map(contacts.map((c) => [c.url, c]));
  const labels = [...SECTOR_GROUPS, UNASSIGNED_GROUP];
  const buckets = new Map<string, Opportunity[]>(labels.map((l) => [l, []]));

  for (const o of opps) {
    // The opportunity's own sector group wins (editable, must be one of the five);
    // otherwise fall back to the linked contact's, else "Unassigned".
    const contact = opportunityContact(o, byUrl, meetings);
    const group =
      o.sector_group && (SECTOR_GROUPS as readonly string[]).includes(o.sector_group)
        ? o.sector_group
        : contact &&
            (SECTOR_GROUPS as readonly string[]).includes(contact.sector_group)
          ? contact.sector_group
          : UNASSIGNED_GROUP;
    buckets.get(group)!.push(o);
  }

  const items = labels.map((label) => {
    const list = buckets.get(label)!;
    return {
      label,
      count: list.length,
      weighted: list.reduce((s, o) => s + weightedValue(o), 0),
      opps: list,
    };
  });
  const total = opps.length;
  const summed = items.reduce((acc, it) => acc + it.count, 0);
  return {
    items,
    total,
    weightedTotal: opps.reduce((s, o) => s + weightedValue(o), 0),
    sumsToTotal: summed === total,
  };
}

// Group opportunities by the FUNCTION of the contact they map to — the same join as
// `opportunitiesBySectorGroup`, but on `contact.function`. Functions are not a fixed
// list, so we discover them from the data, order real functions by count desc, and pin
// the "Other Functions" catch-all then "Unassigned" (no linked contact) LAST and muted
// (§6 rule 3). Each bucket carries count, summed weighted value, and its opps.
export function opportunitiesByFunction(
  opps: Opportunity[],
  contacts: Contact[],
  meetings: MeetingsById,
): OppGroupBreakdown {
  const byUrl = new Map(contacts.map((c) => [c.url, c]));
  const buckets = new Map<string, Opportunity[]>();
  for (const o of opps) {
    const contact = opportunityContact(o, byUrl, meetings);
    // The opportunity's own function wins (it's editable); otherwise fall back to the
    // linked contact's function, or "Unassigned" if there's neither.
    const label = o.function
      ? o.function
      : contact
        ? contact.function || OTHER_FUNCTIONS // empty function → the catch-all
        : UNASSIGNED_GROUP;
    (buckets.get(label) ?? buckets.set(label, []).get(label)!).push(o);
  }

  // Real functions first (busiest leading), then Other Functions, then Unassigned.
  const labels = [...buckets.keys()].sort((a, b) => {
    const rank = (l: string) => (l === UNASSIGNED_GROUP ? 2 : l === OTHER_FUNCTIONS ? 1 : 0);
    return (
      rank(a) - rank(b) ||
      (buckets.get(b)?.length ?? 0) - (buckets.get(a)?.length ?? 0) ||
      a.localeCompare(b)
    );
  });

  return buildOppGroups(labels, buckets, opps);
}

// Group opportunities by their own `service_line` (an opportunity-native field, so no
// contact join and always available). Iterates the FIXED SERVICE_LINE vocab so empty
// lines show a 0 bar and the bars sum to the total (§6 rule 2).
export function opportunitiesByServiceLine(opps: Opportunity[]): OppGroupBreakdown {
  const buckets = new Map<string, Opportunity[]>(
    SERVICE_LINE.map((l) => [l, [] as Opportunity[]]),
  );
  for (const o of opps) buckets.get(o.service_line)?.push(o);
  return buildOppGroups([...SERVICE_LINE], buckets, opps);
}

// Shared assembly for the grouped-opportunity breakdowns: turn an ordered label list +
// its buckets into OppGroupItems (count, summed weighted value, opps) with the §6 totals.
function buildOppGroups(
  labels: string[],
  buckets: Map<string, Opportunity[]>,
  allOpps: Opportunity[],
): OppGroupBreakdown {
  const items = labels.map((label) => {
    const list = buckets.get(label) ?? [];
    return {
      label,
      count: list.length,
      weighted: list.reduce((s, o) => s + weightedValue(o), 0),
      opps: list,
    };
  });
  const summed = items.reduce((acc, it) => acc + it.count, 0);
  return {
    items,
    total: allOpps.length,
    weightedTotal: allOpps.reduce((s, o) => s + weightedValue(o), 0),
    sumsToTotal: summed === allOpps.length,
  };
}

// The opportunity's outcome, DERIVED from its workflow position + the `lost` flag — no
// separate stored "status" to keep in sync:
//   lost flag set                       → Lost
//   reached the WON_STEP (signature) or beyond → Won
//   anything earlier                    → Open  (still in play)
export const OPPORTUNITY_OUTCOMES = ["Open", "Won", "Lost"] as const;
export type OpportunityOutcome = (typeof OPPORTUNITY_OUTCOMES)[number];
export function opportunityStatus(opp: Opportunity): OpportunityOutcome {
  if (opp.lost) return "Lost";
  if (stepIndex(opp.current_step) >= stepIndex(WON_STEP)) return "Won";
  return "Open";
}

// Weighted value of the OPEN pipeline — the live commercial figure. Won (SoW Signed)
// and Lost are excluded so this reflects what's genuinely still in play.
export function openWeightedPipeline(opps: Opportunity[]): number {
  return opps
    .filter((o) => opportunityStatus(o) === "Open")
    .reduce((sum, o) => sum + weightedValue(o), 0);
}

// The deterministic id for an opportunity auto-created from a meeting.
//
// Keying it off the meeting id means setting opportunity_spotted = "Yes" twice (or
// toggling Yes→No→Yes) always resolves to the SAME opportunity — create-if-absent,
// never duplicate (§7). Mirrors the deterministic meeting id in ../data/meetings.ts.
export function opportunityIdForMeeting(meetingId: string): string {
  return `opp:meeting:${meetingId}`;
}

// Compose an opportunity's commercial context from a meeting: the notes, plus the pain
// points and org insights captured in the write-up. So spotting an opportunity carries
// the *intelligence* from the room, not just raw notes. Exported so the opportunity form
// can re-pull it from the source meeting on demand.
export function meetingContext(meeting: {
  notes?: string;
  pain_points?: string;
  org_insights?: string;
}): string {
  return [
    meeting.notes?.trim() || null,
    meeting.pain_points?.trim()
      ? `Pain points: ${meeting.pain_points.trim()}`
      : null,
    meeting.org_insights?.trim()
      ? `Org insights: ${meeting.org_insights.trim()}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Build a fresh opportunity pre-filled from a meeting and its linked contact (§7):
//   organisation ← contact's org      description ← meeting notes
//   primary_contact ← contact's name  current_step = meeting (first step)
//   service_line = FAAS (default)     source_meeting_id = the meeting's id
//
// The caller (MeetingsTab) only calls this when opportunity_spotted flips to "Yes"
// and the meeting isn't already linked, so it never clobbers an existing opportunity.
export function buildOpportunityFromMeeting(
  meeting: Meeting,
  contact: ContactInfo,
): Opportunity {
  // The opportunity is identified at the meeting; anchor its planned timeline there.
  const anchor = meeting.date_held ?? meeting.date_scheduled ?? meeting.date_agreed;
  const opp: Opportunity = {
    id: opportunityIdForMeeting(meeting.id),
    opportunity_name: `${contact.organisation} — ${contact.name}`.trim(),
    organisation: contact.organisation,
    primary_contact: contact.name,
    service_line: "Strategy",
    // A meeting-spotted opportunity starts at the first workflow step.
    current_step: "meeting",
    // Inherit the contact's buyer function and sector group (both editable in the form).
    function: contact.function || undefined,
    sector_group: contact.sector_group || undefined,
    description: meetingContext(meeting) || undefined,
    source_meeting_id: meeting.id,
    // Live link to the contact (so the opp inherits their sector group on the charts).
    contact_url: meeting.contact_url,
  };
  // Auto-plan the provisional step dates + next activity from the meeting date.
  if (anchor) applyPlannedSteps(opp, anchor);
  return opp;
}

// Stamp an opportunity with a provisional schedule anchored to `anchorISO` (the
// first-meeting date): the meeting date, planned dates for every step, and the next
// activity (its TEXT only set if the caller hasn't provided one). Existing step dates are
// preserved. Mutates and returns `opp`.
export function applyPlannedSteps(
  opp: Opportunity,
  anchorISO: string,
): Opportunity {
  if (!opp.current_step) opp.current_step = "meeting";
  // The full standard schedule, anchored to the meeting date; existing dates win.
  opp.step_dates = { ...planStepDates(anchorISO), ...(opp.step_dates ?? {}) };
  if (!opp.step_dates.meeting) opp.step_dates.meeting = anchorISO;
  return opp;
}
