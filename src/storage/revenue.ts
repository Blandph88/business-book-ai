// Persistence for signed work — the Revenue & SoW tab (CLAUDE.md §4).
//
// Like opportunities, SoWs are standalone owner-created records, kept in their own
// localStorage store separate from the CSV and the other stores. Per CLAUDE.md §3
// we start with browser storage; no database yet.

import type { ServiceLine, RevenueStatus } from "../data/vocab";
import { persistLocal, scopedKey } from "./persist";

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

  // The numbers behind the auto-calcs. Optional until known; the calcs treat a
  // missing number as 0.
  team_size?: number;
  chargeable_hours?: number;
  day_rate?: number;
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
