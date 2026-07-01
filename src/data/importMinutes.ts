// Turns compiled minutes (./seedMinutes.ts) into the app's Meeting + Opportunity
// records and merges them into the local stores — the deterministic v1 intake
// (CLAUDE.md §7). Kept pure and separate from any component, like ./meetings.ts and
// ./opportunities.ts, so the mapping rules live in one readable, testable place.
//
// Merge contract (non-destructive, owner-confirmed):
//   - Each seed minute is applied AT MOST ONCE, tracked by an "applied ids" set in
//     localStorage. So owner edits and deletions stick: a deleted seed does NOT
//     resurrect on the next load, and an edited one is never overwritten.
//   - Newly compiled minutes (ids not yet applied) are added on the next load.
// Ids are deterministic and reuse the existing helpers (meetingId /
// opportunityIdForMeeting), so a held minute just materialises the contact's virtual
// seed and never duplicates.

import { loadContacts, type Contact } from "./contacts";
import { fetchSeedMinutes, type SeedMinute } from "./seedMinutes";
import { meetingId, deriveContactInfo } from "./meetings";
import { opportunityIdForMeeting, applyPlannedSteps } from "./opportunities";
import { OPPORTUNITY_STEPS, type OpportunityStep } from "./vocab";
import {
  loadAllMeetings,
  saveAllMeetings,
  type Meeting,
} from "../storage/meetings";
import {
  loadAllOpportunities,
  saveAllOpportunities,
  type Opportunity,
} from "../storage/opportunities";

// v2: bumped alongside the meetings/opportunities stores when the mock minutes were
// cleared. Resetting the "applied seeds" set means the (now empty) seed file starts
// from scratch and no mock-### seed is remembered as applied.
// v5: refresh demo onto the curated "this week" agenda (fewer overdue) + contract next-steps.
// v6: realistic win/loss in the seed (some opps flagged lost) so the demo win rate isn't a fake 100%.
// v7: regenerated demo at 2,319 contacts with deep per-company benches (matrices have real depth, win/loss baked in).
const APPLIED_KEY = "bob.seedApplied.v7";

// Build a Meeting from a compiled minute. The contact's name/org/seniority/function
// are NOT stored here — they're derived live from the contact (see ./meetings.ts) —
// so we only copy the meeting's own fields plus the deterministic id and link.
export function seedToMeeting(seed: SeedMinute): Meeting {
  const id = meetingId(seed.contact_url, seed.meeting_no);
  return {
    id,
    contact_url: seed.contact_url,
    meeting_no: seed.meeting_no,
    meeting_stage: seed.meeting_stage,
    date_agreed: seed.date_agreed,
    date_scheduled: seed.date_scheduled,
    date_held: seed.date_held,
    type: seed.type,
    location: seed.location,
    attendees_ours: seed.attendees_ours,
    attendees_client: seed.attendees_client,
    purpose: seed.purpose,
    notes: seed.notes,
    org_insights: seed.org_insights,
    pain_points: seed.pain_points,
    opportunity_spotted: seed.opportunity_spotted,
    // Link to the opportunity we auto-create below (deterministic id), when present.
    linked_opportunity_id: seed.opportunity
      ? opportunityIdForMeeting(id)
      : undefined,
    actions_mine: seed.actions_mine,
    actions_theirs: seed.actions_theirs,
    followup: seed.followup,
    followup_date: seed.followup_date,
    sentiment: seed.sentiment,
  };
}

// Build the linked Opportunity from a minute's opportunity block (or null). Mirrors
// buildOpportunityFromMeeting (./opportunities.ts) but uses the minute's RICHER fields
// (service_line / stage / value / probability) instead of the FAAS/Identified default,
// and applies the provisional timeline anchored to the meeting date.
export function seedToOpportunity(
  seed: SeedMinute,
  contacts: Map<string, Contact>,
): Opportunity | null {
  if (!seed.opportunity) return null;
  const o = seed.opportunity;
  const mid = meetingId(seed.contact_url, seed.meeting_no);
  const info = deriveContactInfo(contacts.get(seed.contact_url));

  // The opportunity is identified at the first meeting (held, else scheduled, else agreed).
  const anchor = seed.date_held ?? seed.date_scheduled ?? seed.date_agreed;
  const opp: Opportunity = {
    id: opportunityIdForMeeting(mid),
    opportunity_name: o.opportunity_name,
    organisation: info.organisation,
    primary_contact: info.name,
    service_line: o.service_line,
    // Place at the explicit step if given (and valid), else map the legacy coarse stage.
    current_step: stepFromSeed(o.step, o.stage),
    lost: o.lost || o.stage === "Lost" || undefined,
    // Inherit the contact's buyer function and sector group (both editable in the form).
    function: info.function || undefined,
    sector_group: info.sector_group || undefined,
    description: o.description,
    est_value: o.est_value,
    probability: o.probability,
    source_meeting_id: mid,
    contact_url: seed.contact_url,
  };
  // Plan the provisional step dates + next activity from the meeting date (§ timeline).
  if (anchor) applyPlannedSteps(opp, anchor);
  return opp;
}

// The seeded minutes were authored with the old coarse stages; map them to workflow steps
// (same mapping as the storage migration — only "SoW Signed" reaches the signature step).
const SEED_STAGE_TO_STEP: Record<string, OpportunityStep> = {
  Identified: "pursuit",
  "Live Discussion": "scoping",
  "RFP Received": "proposal_build",
  "Proposal Submitted": "proposal_delivery",
  "SoW Drafted": "procurement",
  Procurement: "procurement",
  "SoW Signed": "contracting",
  Lost: "pursuit",
};

const VALID_STEPS = new Set<string>(OPPORTUNITY_STEPS.map((s) => s.id));

// Resolve a minute's opportunity to a workflow step: an explicit (valid) `step` wins,
// else the legacy `stage` map, else the first pursuit step.
function stepFromSeed(step?: string, stage?: string): OpportunityStep {
  if (step && VALID_STEPS.has(step)) return step as OpportunityStep;
  return (stage && SEED_STAGE_TO_STEP[stage]) || "pursuit";
}

function loadApplied(): Set<string> {
  try {
    const raw = localStorage.getItem(APPLIED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveApplied(applied: Set<string>): void {
  localStorage.setItem(APPLIED_KEY, JSON.stringify([...applied]));
}

// Merge compiled minutes into the meetings + opportunities stores, non-destructively.
// Returns how many records were actually added (0/0 on a normal repeat load).
export function mergeSeedMinutes(
  seeds: SeedMinute[],
  contacts: Contact[],
): { addedMeetings: number; addedOpportunities: number } {
  const byUrl = new Map<string, Contact>();
  for (const c of contacts) byUrl.set(c.url, c);

  const applied = loadApplied();
  const meetings = loadAllMeetings();
  const opportunities = loadAllOpportunities();

  let addedMeetings = 0;
  let addedOpportunities = 0;
  let changed = false;

  for (const seed of seeds) {
    const mid = meetingId(seed.contact_url, seed.meeting_no);
    if (applied.has(mid)) continue; // already imported once — never re-apply
    applied.add(mid); // mark applied regardless, so this seed is once-only
    changed = true;

    // Don't clobber a record the owner already has under this id.
    if (!meetings[mid]) {
      meetings[mid] = seedToMeeting(seed);
      addedMeetings++;
    }
    const opp = seedToOpportunity(seed, byUrl);
    if (opp && !opportunities[opp.id]) {
      opportunities[opp.id] = opp;
      addedOpportunities++;
    }
  }

  if (changed) {
    if (addedMeetings > 0) saveAllMeetings(meetings);
    if (addedOpportunities > 0) saveAllOpportunities(opportunities);
    saveApplied(applied);
  }
  return { addedMeetings, addedOpportunities };
}

// Fetch + merge in one call, for the app bootstrap (./main.tsx). Best-effort: any
// failure (missing JSON, fetch error) leaves the app to boot normally with no seed.
export async function bootstrapSeedMinutes(): Promise<void> {
  try {
    const [seeds, contacts] = await Promise.all([
      fetchSeedMinutes(),
      loadContacts(),
    ]);
    if (seeds.length === 0) return;
    const { addedMeetings, addedOpportunities } = mergeSeedMinutes(seeds, contacts);
    if (addedMeetings || addedOpportunities) {
      console.info(
        `Seeded ${addedMeetings} meeting(s) and ${addedOpportunities} opportunity(ies) from minutes.`,
      );
    }
  } catch (err) {
    console.warn("Minutes seed skipped:", err);
  }
}
