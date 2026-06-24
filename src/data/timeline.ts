// Opportunity timeline engine — turns ONE anchor date (the first-meeting / Identified
// date) into a provisional, planned schedule across the opportunity's stages, plus the
// "next step" and the follow-up meeting date. Everything it produces is a SUGGESTED
// default the owner can amend; nothing here is "actual" until the owner edits it.
//
// Pure ISO-date math (like ./agenda.ts), no RNG — so the forms, the meeting→opportunity
// auto-create, and the mock seed all share one source of truth for "usual timelines".

import { OPPORTUNITY_STEPS, stepIndex, type OpportunityStep } from "./vocab";
import type { Opportunity } from "../storage/opportunities";

// Cumulative weeks from the first-meeting anchor at which each workflow step is PLANNED
// to be reached — derived from the editable defaults in OPPORTUNITY_STEPS (signature
// ≈ 24 weeks, then a delivery tail).
export const STEP_OFFSET_WEEKS = Object.fromEntries(
  OPPORTUNITY_STEPS.map((s) => [s.id, s.offsetWeeks]),
) as Record<OpportunityStep, number>;

// ── ISO date helpers ────────────────────────────────────────────────────────
function toISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function addWeeks(iso: string, weeks: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + weeks * 7);
  return toISO(d);
}

export function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return toISO(d);
}

// ── Planned step dates ──────────────────────────────────────────────────────
// Provisional planned date for EVERY step, anchored to the first-meeting date — each
// step's cumulative offset weeks. Used to pre-plan a freshly-identified opportunity.
export function planStepDates(
  anchorISO: string,
): Partial<Record<OpportunityStep, string>> {
  const out: Partial<Record<OpportunityStep, string>> = {};
  for (const s of OPPORTUNITY_STEPS) out[s.id] = addWeeks(anchorISO, s.offsetWeeks);
  return out;
}

// The opportunity's NEXT activity: the step AFTER current_step, with its planned date
// (the date stored in step_dates) and short label. Null when already at the final step.
export function nextStepInfo(
  opp: Opportunity,
): { step: OpportunityStep; label: string; short: string; date?: string } | null {
  const next = OPPORTUNITY_STEPS[stepIndex(opp.current_step) + 1];
  if (!next) return null;
  return {
    step: next.id,
    label: next.label,
    short: next.short,
    date: opp.step_dates?.[next.id],
  };
}

// Advance an opportunity to its next step (pure — returns the fields to apply). Stamps the
// reached step's date = today, suggests that step's win-probability, and RE-ANCHORS the
// remaining future steps to today (today + the standard gap from the reached step), so the
// forward plan reflects actual progress. Past steps keep their dates. Null at the final step.
export function advanceOpportunity(
  opp: Opportunity,
  todayISO: string,
): Partial<Opportunity> | null {
  const idx = stepIndex(opp.current_step);
  const next = OPPORTUNITY_STEPS[idx + 1];
  if (!next) return null; // already at the final step

  const step_dates = { ...(opp.step_dates ?? {}) };
  step_dates[next.id] = todayISO; // reached today (actual)
  // Re-plan every later step from today, keeping the standard inter-step gaps.
  for (let j = idx + 2; j < OPPORTUNITY_STEPS.length; j++) {
    const s = OPPORTUNITY_STEPS[j];
    step_dates[s.id] = addWeeks(todayISO, s.offsetWeeks - next.offsetWeeks);
  }
  return { current_step: next.id, step_dates, probability: next.prob };
}

// The follow-up meeting date: two calendar months after the first meeting.
export function nextMeetingDateISO(firstISO: string): string {
  return addMonths(firstISO, 2);
}
