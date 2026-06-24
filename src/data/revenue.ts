// Pure logic for the Revenue & SoW tab (CLAUDE.md §4), kept separate from the
// component so the two auto-calcs live in one place (§6 rule 4).

import type { Sow } from "../storage/revenue";
import type { Opportunity } from "../storage/opportunities";

// Contracted revenue, by how the SoW is priced (§4). A missing number counts as 0.
//   • Fixed price       → sum of deliverable prices
//   • Time & materials  → sum of (rate per hour × hours) across the rate card
//   • Legacy (no type)  → the original chargeable_hours / 8 × day_rate (day_rate is per
//                         8-hour day), so SoWs saved before the pricing split still compute.
export function contractedRevenue(sow: Sow): number {
  if (sow.project_type === "Fixed price") {
    return (sow.deliverables ?? []).reduce((sum, d) => sum + (d.price ?? 0), 0);
  }
  if (sow.project_type === "Time & materials") {
    return (sow.rate_card ?? []).reduce(
      (sum, r) => sum + (r.rate_per_hour ?? 0) * (r.hours ?? 0),
      0,
    );
  }
  return ((sow.chargeable_hours ?? 0) / 8) * (sow.day_rate ?? 0);
}

// Percent recognised = recognised_to_date / contracted_revenue, as a 0–100 number
// for display. Guarded against divide-by-zero (an unpriced SoW reads as 0%).
export function pctRecognised(sow: Sow): number {
  const contracted = contractedRevenue(sow);
  if (contracted === 0) return 0;
  return (sow.recognised_to_date ?? 0) / contracted * 100;
}

// Total contracted revenue across all SoWs — the dashboard headline figure (§4).
export function totalContractedRevenue(sows: Sow[]): number {
  return sows.reduce((sum, sow) => sum + contractedRevenue(sow), 0);
}

// Total revenue recognised across all SoWs (cash actually earned to date).
export function totalRecognised(sows: Sow[]): number {
  return sows.reduce((sum, sow) => sum + (sow.recognised_to_date ?? 0), 0);
}

// "Your book" — recognised revenue on work whose opportunity is credited to YOU
// (self- or co-originated). This is the number the whole app points at: the personal
// book you're building, not the firm-wide total.
const MY_CREDIT = new Set(["Self-originated", "Co-originated"]);
export function myBook(
  sows: Sow[],
  oppsById: Record<string, Opportunity>,
): number {
  return sows
    .filter((s) => {
      const opp = s.linked_opportunity_id
        ? oppsById[s.linked_opportunity_id]
        : undefined;
      return opp && MY_CREDIT.has(opp.origination_credit ?? "");
    })
    .reduce((sum, s) => sum + (s.recognised_to_date ?? 0), 0);
}

// Build a SoW pre-filled from a won opportunity, so signing a deal flows straight into
// the revenue record (org / name / service line / signed date / link), no retyping.
export function sowFromOpportunity(opp: Opportunity): Sow {
  return {
    id: "", // assigned on save
    linked_opportunity_id: opp.id,
    organisation: opp.organisation,
    engagement_name:
      opp.opportunity_name || `${opp.organisation} engagement`.trim(),
    signed_date: opp.step_dates?.contracting,
    service_line: opp.service_line,
    status: "Active",
  };
}

// The SoW linked to a given opportunity (the first one, if several). Lets the
// opportunity form show "View SoW →" / "Create SoW →".
export function sowForOpportunity(
  oppId: string,
  sows: Sow[],
): Sow | undefined {
  return sows.find((s) => s.linked_opportunity_id === oppId);
}
