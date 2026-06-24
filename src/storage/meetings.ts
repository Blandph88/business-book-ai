// Persistence for meetings (CLAUDE.md §4 Meetings tab).
//
// Meetings are the first NEW records the owner creates — unlike the Contacts tab,
// which only layers edits onto the pipeline rows. They live in their own
// localStorage store, completely separate from the enriched CSV, so re-running the
// pipeline never touches them (the same separation principle as ../storage/ownerEdits.ts).
//
// Per CLAUDE.md §3 we start with browser storage; no database yet.

import type {
  MeetingStage,
  MeetingType,
  Sentiment,
  OpportunitySpotted,
} from "../data/vocab";
import { persistLocal, scopedKey } from "./persist";

// One meeting (CLAUDE.md §4). Most fields are optional because a freshly-seeded or
// freshly-added meeting only has its identity and stage filled in.
//
// IMPORTANT — derived vs stored: the contact's NAME, organisation, seniority and
// function are NOT stored here. They are derived live from the linked contact (via
// `contact_url`) so they always match the CSV — a single source of truth. We only
// persist the link. See ../data/meetings.ts `deriveContactInfo`.
export type Meeting = {
  // Stable unique id. For contact-linked meetings this is deterministic:
  //   `${contact_url}#${meeting_no}`
  // so a virtual seed (built on the fly) and its saved version share one id and
  // can never duplicate. See ../data/meetings.ts.
  id: string;
  // The linked contact (the pipeline's stable `url`). Everything about WHO the
  // meeting is with is derived from this.
  contact_url: string;
  // 1 for the first meeting with a contact (the seed), 2+ for follow-ups.
  meeting_no: number;

  meeting_stage: MeetingStage;

  // Dates, stored as ISO "YYYY-MM-DD" strings from <input type="date">.
  date_agreed?: string;
  date_scheduled?: string;
  date_held?: string;

  type?: MeetingType;
  location?: string;
  attendees_ours?: string;
  attendees_client?: string;
  purpose?: string;
  notes?: string;
  org_insights?: string;
  pain_points?: string;

  // Setting this to "Yes" will auto-create a linked Opportunity in a LATER
  // increment (build-sequence step 6, §7). For now it is only recorded, and
  // `linked_opportunity_id` stays empty until that step is built.
  opportunity_spotted?: OpportunitySpotted;
  linked_opportunity_id?: string;

  actions_mine?: string;
  actions_theirs?: string;
  followup?: string;
  followup_date?: string;
  sentiment?: Sentiment;
};

// All saved meetings, keyed by meeting id. One localStorage key holds the whole map
// (small data set; one read/write is simpler than per-row keys — same choice as
// ownerEdits.ts).
export type MeetingsById = Record<string, Meeting>;

// v2: bumped when the mock minutes were cleared out and the app switched to the real
// LinkedIn data. The old v1 store held meetings seeded from the fictional minutes
// (keyed by mock-### contact urls); bumping the key gives a clean slate so those
// orphaned rows don't render. Real agreed-to-meet contacts re-seed virtually.
const STORAGE_KEY = scopedKey("bob.meetings.v2");

// Read every saved meeting. Returns an empty map if nothing is stored yet or the
// stored value is corrupt — we fail safe rather than crash the tab.
export function loadAllMeetings(): MeetingsById {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as MeetingsById;
  } catch {
    console.warn("Could not parse saved meetings; starting fresh.");
    return {};
  }
}

// Replace the whole meetings map in one write. Used by the minutes importer, which
// adds many records at once — a single write is cheaper and atomic compared with
// calling saveMeeting in a loop.
export function saveAllMeetings(all: MeetingsById): MeetingsById {
  persistLocal(STORAGE_KEY, JSON.stringify(all));
  return all;
}

// Save one meeting, merged into the existing map, and return the new map so the
// caller can update React state from the same source of truth.
export function saveMeeting(meeting: Meeting): MeetingsById {
  const all = loadAllMeetings();
  all[meeting.id] = meeting;
  persistLocal(STORAGE_KEY, JSON.stringify(all));
  return all;
}

// Remove one meeting (used to delete an added meeting), returning the new map.
export function deleteMeeting(id: string): MeetingsById {
  const all = loadAllMeetings();
  delete all[id];
  persistLocal(STORAGE_KEY, JSON.stringify(all));
  return all;
}
