// Pure logic for the Meetings tab: turning the contacts CSV + saved meetings into
// the list of rows the tab renders. Kept separate from the component (like
// ../data/metrics.ts) so the seeding rules live in one readable, testable place.
//
// The model (decided in the plan):
//   - Every contact with agreed_to_meet = true should have a meeting. We do NOT
//     write those to storage up front — instead we synthesise a "virtual seed" row
//     on the fly whenever no saved meeting exists for that contact's meeting #1.
//   - A meeting's id is deterministic for contact-linked meetings:
//       `${contact_url}#${meeting_no}`
//     so the virtual seed and its saved version share one id. The moment the owner
//     edits a seed, the tab saves it under that same id and the seed "materialises"
//     — no duplicate, no separate bookkeeping of what's been seeded.
//   - Re-running the pipeline just changes which contacts are agreed_to_meet; new
//     ones get a fresh virtual seed automatically, and any already-saved meetings
//     are untouched.

import type { Contact } from "./contacts";
import type { Meeting, MeetingsById } from "../storage/meetings";

// The set of contact URLs that have a meeting marked "Held" — i.e. people actually met.
// Used by the dashboard funnel/breakdowns to compute the "Met" stage: a contact counts
// as met if the pipeline's `met` heuristic flagged them OR they have a Held meeting here.
// Only saved meetings can be "Held" (a virtual seed is always "Agreed - not scheduled").
export function heldContactUrls(meetings: MeetingsById): Set<string> {
  return new Set(
    Object.values(meetings)
      .filter((m) => m.meeting_stage === "Held")
      .map((m) => m.contact_url),
  );
}

// The four contact facts shown read-only on each meeting row (CLAUDE.md §4). These
// are DERIVED from the linked contact, never stored on the meeting, so they always
// reflect the current CSV.
export type ContactInfo = {
  name: string;
  organisation: string;
  seniority: string;
  function: string;
  sector_group: string;
  // The pipeline-extracted phone (for the WhatsApp icon column). "" when none/unknown.
  phone: string;
};

// A meeting plus everything the table needs to render it.
export type MeetingRow = Meeting & {
  contactInfo: ContactInfo;
  // true = a virtual seed not yet saved (so we can show it greyed / "not started").
  isSeed: boolean;
};

// The deterministic id for a contact-linked meeting (see file header).
export function meetingId(contactUrl: string, meetingNo: number): string {
  return `${contactUrl}#${meetingNo}`;
}

// Pull the read-only contact facts off a contact. Falls back gracefully if a saved
// meeting points at a contact no longer in the CSV (e.g. the pipeline was re-run).
export function deriveContactInfo(contact: Contact | undefined): ContactInfo {
  if (!contact) {
    return {
      name: "(unknown contact)",
      organisation: "—",
      seniority: "—",
      function: "—",
      sector_group: "—",
      phone: "",
    };
  }
  return {
    name: `${contact.first} ${contact.last}`.trim(),
    organisation: contact.organisation,
    seniority: contact.seniority,
    function: contact.function,
    sector_group: contact.sector_group,
    phone: contact.phone ?? "",
  };
}

// Build the full list of meeting rows: every saved meeting, plus a virtual seed for
// each agreed-to-meet contact that has no saved meeting #1. Sorted by contact name
// then meeting_no so a contact's meetings sit together in order.
export function buildMeetingRows(
  contacts: Contact[],
  saved: Record<string, Meeting>,
): MeetingRow[] {
  // Index contacts by their stable url so we can derive info and find seeds fast.
  const byUrl = new Map<string, Contact>();
  for (const c of contacts) byUrl.set(c.url, c);

  const rows: MeetingRow[] = [];

  // 1) Every saved meeting becomes a row (these are real, persisted records).
  for (const meeting of Object.values(saved)) {
    rows.push({
      ...meeting,
      contactInfo: deriveContactInfo(byUrl.get(meeting.contact_url)),
      isSeed: false,
    });
  }

  // 2) A virtual seed for each agreed-to-meet contact lacking a saved meeting #1.
  for (const c of contacts) {
    if (!c.agreed_to_meet) continue;
    const seedId = meetingId(c.url, 1);
    if (saved[seedId]) continue; // already materialised — its saved row is above

    rows.push({
      id: seedId,
      contact_url: c.url,
      meeting_no: 1,
      meeting_stage: "Agreed - not scheduled",
      contactInfo: deriveContactInfo(c),
      isSeed: true,
    });
  }

  // Group a contact's meetings together (by name), in meeting_no order.
  rows.sort((a, b) => {
    const byName = a.contactInfo.name.localeCompare(b.contactInfo.name);
    if (byName !== 0) return byName;
    return a.meeting_no - b.meeting_no;
  });

  return rows;
}

// ── Meeting completeness (the held-meeting write-up obligation) ──────────────
// Once a meeting has a held date, every write-up field must be filled. These are the
// required fields and their labels (opportunity link is excluded — it's conditional).
const REQUIRED_MEETING_FIELDS: { key: keyof Meeting; label: string }[] = [
  { key: "type", label: "Type" },
  { key: "location", label: "Location" },
  { key: "attendees_ours", label: "Attendees (ours)" },
  { key: "attendees_client", label: "Attendees (client)" },
  { key: "purpose", label: "Purpose" },
  { key: "notes", label: "Notes" },
  { key: "org_insights", label: "Org insights" },
  { key: "pain_points", label: "Pain points" },
  { key: "opportunity_spotted", label: "Opportunity spotted" },
  { key: "actions_mine", label: "Actions (mine)" },
  { key: "actions_theirs", label: "Actions (theirs)" },
  { key: "followup", label: "Follow-up" },
  { key: "followup_date", label: "Follow-up date" },
  { key: "sentiment", label: "Sentiment" },
];

// The labels of the required fields a meeting is still missing (empty/blank).
export function meetingMissingFields(m: Partial<Meeting>): string[] {
  return REQUIRED_MEETING_FIELDS.filter(
    (f) => !String(m[f.key] ?? "").trim(),
  ).map((f) => f.label);
}

// Whether a HELD meeting's write-up is complete (only meaningful once it has a held date).
export function meetingIsComplete(m: Partial<Meeting>): boolean {
  return meetingMissingFields(m).length === 0;
}

// The most recent held date per contact url — the contact's "last met". Used by the
// Contact form and the Dashboard "Reconnect" list (replaces the old manual last-contact).
export function lastMetByUrl(rows: MeetingRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of rows) {
    if (!m.date_held) continue;
    if (!out[m.contact_url] || m.date_held > out[m.contact_url]) {
      out[m.contact_url] = m.date_held;
    }
  }
  return out;
}

// The next meeting number for a contact = (highest existing for that contact) + 1.
// Used when adding a follow-up meeting so meeting_no stays sequential and the
// derived id stays unique.
export function nextMeetingNo(
  contactUrl: string,
  rows: MeetingRow[],
): number {
  let max = 0;
  for (const r of rows) {
    if (r.contact_url === contactUrl && r.meeting_no > max) max = r.meeting_no;
  }
  return max + 1;
}
