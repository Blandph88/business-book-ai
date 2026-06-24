// Persistence for signed work — the Revenue & SoW tab (CLAUDE.md §4).
//
// Like opportunities, SoWs are standalone owner-created records, kept in their own
// localStorage store separate from the CSV and the other stores. Per CLAUDE.md §3
// we start with browser storage; no database yet.

import type { ServiceLine, RevenueStatus, ProjectType } from "../data/vocab";
import { persistLocal, scopedKey } from "./persist";

// One line of a Fixed-price SoW: a named deliverable in a category, at a price. The sum of
// deliverable prices is the contracted revenue.
export type Deliverable = {
  id: string;
  name: string;
  category: string;
  price?: number;
};

// One line of a Time & materials rate card: a grade billed at a rate per hour for a number
// of hours. The sum of (rate × hours) across grades is the contracted revenue.
export type RateLine = {
  grade: string;
  rate_per_hour?: number;
  hours?: number;
};

// One signed Statement of Work (CLAUDE.md §4).
//
// IMPORTANT — derived, never stored (§6 rule 4): `contracted_revenue` and
// `pct_recognised` are NOT fields here. They are computed in ../data/revenue.ts
// (contracted = chargeable_hours / 8 × day_rate; pct = recognised / contracted) so
// they can never be hand-entered or drift.
export type Sow = {
  // Stable unique id (we also surface it to the owner as sow_id).
  id: string;

  // Optional link to the opportunity this work came from (§4). Empty if entered
  // standalone. Points at an Opportunity.id.
  linked_opportunity_id?: string;

  organisation: string;
  engagement_name: string;

  // Dates, ISO "YYYY-MM-DD".
  signed_date?: string;
  start_date?: string;
  end_date?: string;

  service_line: ServiceLine;

  // How the work is priced (drives the contracted-revenue calc). Undefined = a legacy SoW
  // priced on the old day_rate × hours fields below.
  project_type?: ProjectType;
  // Fixed price: the deliverables (Σ price = contracted revenue).
  deliverables?: Deliverable[];
  // Time & materials: the rate card per grade (Σ rate × hours = contracted revenue).
  rate_card?: RateLine[];

  // Legacy numbers behind the old day-rate calc — kept so SoWs saved before the
  // Fixed-price / T&M split still compute (see ../data/revenue.ts contractedRevenue).
  team_size?: number;
  chargeable_hours?: number;
  day_rate?: number;

  // Recognised revenue to date (a single number; % recognised is derived from it).
  recognised_to_date?: number;

  status: RevenueStatus;
};

export type SowsById = Record<string, Sow>;

const STORAGE_KEY = scopedKey("bob.revenue.v1");

// Read every saved SoW. Empty map if nothing stored or the value is corrupt.
export function loadAllSows(): SowsById {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as SowsById;
  } catch {
    console.warn("Could not parse saved SoWs; starting fresh.");
    return {};
  }
}

// Save one SoW, merged into the map, returning the new map.
export function saveSow(sow: Sow): SowsById {
  const all = loadAllSows();
  all[sow.id] = sow;
  persistLocal(STORAGE_KEY, JSON.stringify(all));
  return all;
}

// Remove a SoW by id and return the new map.
export function deleteSow(id: string): SowsById {
  const all = loadAllSows();
  delete all[id];
  persistLocal(STORAGE_KEY, JSON.stringify(all));
  return all;
}
