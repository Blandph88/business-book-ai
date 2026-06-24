// "This Week" agenda — the actionable items for the Dashboard home.
//
// The CRM already CAPTURES dates the owner cares about; nothing yet SURFACES them.
// This module gathers every dated commitment into one list so the home page can
// answer "what do I need to do?":
//   • held meetings missing a write-up (a completeness obligation)     → Meetings
//   • meeting follow-ups due      (meeting.followup_date)              → Meetings
//   • upcoming scheduled meetings (meeting.date_scheduled, Scheduled)  → Meetings
//   • opportunity next steps      (derived: step after current_step)   → Opportunities
// Actions live on meetings/opportunities — contacts no longer carry their own to-do.
//
// Window (the owner's choice): anything OVERDUE plus the next 7 days. Overdue items
// are kept (and flagged) so nothing quietly falls off the bottom of the list. Each item
// carries `openId` (the contact url / meeting id / opportunity id) so the Dashboard can
// deep-link straight to that record's slide-in form.
//
// Pure functions, with "today" passed in as an ISO string, so the logic is testable
// and the component owns the one impure `new Date()` call (see todayISO).

import { type MeetingRow, meetingMissingFields } from "./meetings";
import type { Opportunity } from "../storage/opportunities";
import { nextStepInfo } from "./timeline";
import type { TabId } from "../components/TabNav";

// How far ahead the agenda looks, in days.
export const AGENDA_WINDOW_DAYS = 7;

// One thing to do, with enough context to show it and to deep-link to the right record.
export type AgendaItem = {
  date: string; // ISO "YYYY-MM-DD"
  daysUntil: number; // 0 = today, negative = overdue
  overdue: boolean;
  kind:
    | "Meeting write-up"
    | "Meeting follow-up"
    | "Scheduled meeting"
    | "Opportunity next step";
  who: string; // contact / opportunity name
  what: string; // the action / note text
  statusLabel: string; // a short (≤2 word) "what's due" label for the agenda column
  org?: string; // the organisation, for context in the table
  value?: number; // the opportunity's estimated value (opportunity items only)
  tab: TabId; // where to go when clicked
  openId: string; // the record's id (contact url / meeting id / opportunity id)
};

// Today's date as an ISO "YYYY-MM-DD" string in the browser's local time.
export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Whole days from `fromISO` to `toISO` (positive = toISO is later). Parsed at local
// midnight so daylight-saving shifts can't push a count off by one. Exported so the
// slide-in forms can flag overdue dates with the same arithmetic the agenda uses.
export function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T00:00:00`).getTime();
  const b = new Date(`${toISO}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

// Is this date within the agenda window (overdue OR within the next N days)?
function inWindow(daysUntil: number): boolean {
  return daysUntil <= AGENDA_WINDOW_DAYS;
}

// Build the agenda from the loaded data. `today` is injected for testability. Contact-
// level to-dos are no longer a source — actions live on meetings and opportunities (the
// contact form no longer carries a next-action).
export function buildAgenda(
  meetingRows: MeetingRow[],
  opps: Opportunity[],
  today: string,
): AgendaItem[] {
  const items: AgendaItem[] = [];

  // 1) Held meetings whose write-up is incomplete → a "Write-up due" obligation, dated at
  //    the held date so it surfaces immediately (and stays until every field is filled).
  for (const m of meetingRows) {
    if (!m.date_held) continue;
    if (meetingMissingFields(m).length === 0) continue;
    const daysUntil = daysBetween(today, m.date_held);
    if (!inWindow(daysUntil)) continue;
    items.push({
      date: m.date_held,
      daysUntil,
      overdue: daysUntil < 0,
      kind: "Meeting write-up",
      who: m.contactInfo.name,
      what: "Complete the meeting write-up",
      statusLabel: "Write-up due",
      org: m.contactInfo.organisation,
      tab: "meetings",
      openId: m.id,
    });
  }

  // 2) Meeting follow-ups and 3) upcoming scheduled meetings → Meetings.
  for (const m of meetingRows) {
    // A follow-up only counts as a MEETING action when the meeting didn't spawn an
    // opportunity. If it did, the commercial follow-up is the opportunity's next step
    // (surfaced below) — so we don't double-count it here as a "Meeting follow-up".
    if (m.followup_date && !m.linked_opportunity_id) {
      const daysUntil = daysBetween(today, m.followup_date);
      if (inWindow(daysUntil)) {
        items.push({
          date: m.followup_date,
          daysUntil,
          overdue: daysUntil < 0,
          kind: "Meeting follow-up",
          who: m.contactInfo.name,
          what: m.followup?.trim() || "Follow up after meeting",
          statusLabel: "Follow-up due",
          org: m.contactInfo.organisation,
          tab: "meetings",
          openId: m.id,
        });
      }
    }
    if (m.meeting_stage === "Scheduled" && m.date_scheduled) {
      const daysUntil = daysBetween(today, m.date_scheduled);
      if (inWindow(daysUntil)) {
        items.push({
          date: m.date_scheduled,
          daysUntil,
          overdue: daysUntil < 0,
          kind: "Scheduled meeting",
          who: m.contactInfo.name,
          what: m.type ? `${m.type} meeting` : "Meeting",
          statusLabel: "Meeting due",
          org: m.contactInfo.organisation,
          tab: "meetings",
          openId: m.id,
        });
      }
    }
  }

  // 4) Opportunity next steps → Opportunities. The next step + its due date are derived
  // from the workflow (the step immediately after the current one). Lost deals and deals
  // already at the final step have no next step.
  for (const o of opps) {
    if (o.lost) continue;
    const ns = nextStepInfo(o);
    if (!ns?.date) continue;
    const daysUntil = daysBetween(today, ns.date);
    if (!inWindow(daysUntil)) continue;
    items.push({
      date: ns.date,
      daysUntil,
      overdue: daysUntil < 0,
      kind: "Opportunity next step",
      who: o.opportunity_name || o.organisation || "(unnamed)",
      what: ns.label,
      statusLabel: `${ns.short} due`,
      org: o.organisation,
      value: o.est_value,
      tab: "opportunities",
      openId: o.id,
    });
  }

  // Earliest first, so overdue items lead and the day's work reads top-to-bottom.
  items.sort((a, b) => a.date.localeCompare(b.date));
  return items;
}
