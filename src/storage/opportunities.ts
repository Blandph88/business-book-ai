// Persistence for opportunities (CLAUDE.md §4 Opportunities tab).
//
// Opportunities are standalone owner-created records — unlike Meetings (which derive
// the "who" from a contact) and unlike Contacts (which layer edits onto pipeline
// rows). So everything an opportunity needs is stored right here. They live in their
// own localStorage store, separate from the CSV and from meetings, following the
// same separation principle as ../storage/meetings.ts and ../storage/ownerEdits.ts.
//
// Per CLAUDE.md §3 we start with browser storage; no database yet.

import type { ServiceLine, OpportunityStep } from "../data/vocab";
import { planStepDates } from "../data/timeline";
import { persistLocal, scopedKey } from "./persist";

// One opportunity (CLAUDE.md §4).
//
// IMPORTANT — derived, never stored (§6 rule 4): `weighted_value` is NOT a field
// here. It is always computed as est_value × probability in ../data/opportunities.ts
// so it can never be hand-entered or drift out of sync. Same discipline the dashboard
// metrics use.
export type Opportunity = {
  // Stable unique id. Manually-created opportunities get a random id; opportunities
  // auto-created from a meeting get a DETERMINISTIC id derived from the meeting
  // (see ../data/opportunities.ts `opportunityIdForMeeting`) so toggling
  // opportunity_spotted on the meeting can never create a duplicate (§7).
  id: string;

  opportunity_name: string;
  organisation: string;
  primary_contact: string;
  service_line: ServiceLine;
  // The furthest workflow step the opportunity has reached (the source of truth for
  // where it is). Rolls up to a phase for the funnels — see ../data/opportunities.ts
  // opportunityPhase. The selling-and-delivery activities live in ../data/vocab.ts
  // OPPORTUNITY_STEPS.
  current_step: OpportunityStep;
  // The date each step was reached/completed (or a planned date for upcoming steps),
  // ISO "YYYY-MM-DD". Sparse — only steps that have a date appear.
  step_dates?: Partial<Record<OpportunityStep, string>>;
  // Terminal negative outcome, set at any point. Orthogonal to current_step (you can
  // lose a deal at any step), so it's a flag rather than a step. Won is derived from
  // current_step (≥ WON_STEP); Lost is this flag — see opportunityStatus.
  lost?: boolean;
  // Attribution (set early, editable anytime): how the deal was originated. "Your book"
  // is later derived from recognised revenue on deals credited to you.
  origination_credit?: string;
  // The buyer's function (e.g. "Compliance", "Treasury"). Defaults to the linked
  // contact's function in the form but is editable, so the opportunity can be filed
  // under a different functional area than the named contact's. Falls back to the
  // contact's function on the dashboard when unset — see ../data/opportunities.ts
  // opportunitiesByFunction.
  function?: string;
  // The sector group being sold into (one of the fixed five, §5). Like `function`,
  // defaults from the linked contact in the form but is editable. Falls back to the
  // contact's sector group on the dashboard when unset — see opportunitiesBySectorGroup.
  sector_group?: string;
  description?: string;

  // The two numbers behind the weighted value. Both optional until known; the
  // weighted value treats a missing number as 0.
  est_value?: number;
  probability?: number;

  // Rival firms on this pursuit (a comma-separated list, edited via a multi-select).
  competitors?: string;

  // If this opportunity was auto-created from a meeting (§7), the meeting's id.
  // Empty for manually-created opportunities.
  source_meeting_id?: string;

  // A live link to the contact this opportunity maps to (their LinkedIn url). Carried
  // automatically from the source meeting for auto-created opps, or picked in the form
  // for manual ones. Lets the dashboard derive the opportunity's sector group from the
  // contact (single source of truth) — see ../data/opportunities.ts opportunityContact.
  contact_url?: string;
};

// All saved opportunities, keyed by id. One localStorage key holds the whole map
// (small data set; one read/write is simpler than per-row keys — same choice as
// the other stores).
export type OpportunitiesById = Record<string, Opportunity>;

// v2: bumped alongside the meetings store when the mock minutes were cleared. The old
// v1 store held opportunities auto-created from the fictional minutes; a clean slate
// avoids orphaned rows. See storage/meetings.ts for the full rationale.
const STORAGE_KEY = scopedKey("bob.opportunities.v2");

// ── Migration: legacy coarse `stage` + milestone dates → granular workflow ──────
// Opportunities saved before the granular workflow have a `stage` string and discrete
// date_* fields and no `current_step`. We convert them on read (idempotent; re-saving an
// opp persists the new shape). Non-destructive — it never loses data, just re-files it.
type LegacyOpp = Opportunity & {
  stage?: string;
  date_identified?: string;
  date_rfp?: string;
  date_proposal?: string;
  date_sow?: string;
  date_signed?: string;
};

// Maps preserve Open/Won exactly: only "SoW Signed" lands at the signature step (Won);
// every other open stage stays before it.
const LEGACY_STAGE_TO_STEP: Record<string, OpportunityStep> = {
  Identified: "pursuit",
  "Live Discussion": "scoping",
  "RFP Received": "proposal_build",
  "Proposal Submitted": "proposal_delivery",
  "SoW Drafted": "procurement",
  Procurement: "procurement",
  "SoW Signed": "contracting",
  Lost: "pursuit",
};

function migrateOpportunity(raw: LegacyOpp): Opportunity {
  if (raw.current_step) return raw; // already the new shape

  const legacyStage = raw.stage ?? "Identified";
  // Backfill the FULL standard schedule anchored to the first-meeting date, so every step
  // gets a planned date (past steps = when they should have been done; future = targets).
  const anchor = raw.date_identified ?? raw.step_dates?.meeting;
  const step_dates: Partial<Record<OpportunityStep, string>> = anchor
    ? { ...planStepDates(anchor), ...(raw.step_dates ?? {}) }
    : { ...(raw.step_dates ?? {}) };

  // Rebuild without the legacy fields (explicit copy avoids unused-destructure lint).
  return {
    id: raw.id,
    opportunity_name: raw.opportunity_name,
    organisation: raw.organisation,
    primary_contact: raw.primary_contact,
    service_line: raw.service_line,
    current_step: LEGACY_STAGE_TO_STEP[legacyStage] ?? "pursuit",
    step_dates,
    lost: legacyStage === "Lost" || raw.lost || undefined,
    origination_credit: raw.origination_credit,
    function: raw.function,
    sector_group: raw.sector_group,
    description: raw.description,
    est_value: raw.est_value,
    probability: raw.probability,
    competitors: raw.competitors,
    source_meeting_id: raw.source_meeting_id,
    contact_url: raw.contact_url,
  };
}

// Read every saved opportunity. Returns an empty map if nothing is stored yet or the
// stored value is corrupt — we fail safe rather than crash the tab. Legacy-shaped
// opportunities are migrated to the granular workflow on the way out.
export function loadAllOpportunities(): OpportunitiesById {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, LegacyOpp>;
    const out: OpportunitiesById = {};
    for (const [id, o] of Object.entries(parsed)) out[id] = migrateOpportunity(o);
    return out;
  } catch {
    console.warn("Could not parse saved opportunities; starting fresh.");
    return {};
  }
}

// Replace the whole opportunities map in one write. Used by the minutes importer,
// which adds many records at once — one write instead of a loop of saveOpportunity.
export function saveAllOpportunities(all: OpportunitiesById): OpportunitiesById {
  persistLocal(STORAGE_KEY, JSON.stringify(all));
  return all;
}

// Save one opportunity, merged into the existing map, and return the new map so the
// caller can update React state from the same source of truth.
export function saveOpportunity(opp: Opportunity): OpportunitiesById {
  const all = loadAllOpportunities();
  all[opp.id] = opp;
  persistLocal(STORAGE_KEY, JSON.stringify(all));
  return all;
}

// Remove an opportunity by id and return the new map.
export function deleteOpportunity(id: string): OpportunitiesById {
  const all = loadAllOpportunities();
  delete all[id];
  persistLocal(STORAGE_KEY, JSON.stringify(all));
  return all;
}
