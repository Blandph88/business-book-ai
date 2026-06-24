// Loads the compiled minutes seed (web/public/seed_meetings.json).
//
// The minutes live on disk as markdown (minutes/structured/*.md); a Python step
// (minutes/compile_minutes.py) compiles them into this one JSON, which the browser
// CAN fetch. This module just fetches + types it; the mapping into the app's Meeting
// and Opportunity records lives in ./importMinutes.ts (kept separate and pure).
//
// The shapes here mirror the structured-minute frontmatter 1:1 (see minutes/README.md).

import type { MeetingStage, MeetingType, Sentiment, OpportunitySpotted } from "./vocab";
import type { ServiceLine } from "./vocab";

// The opportunity block a minute carries when one was spotted (null otherwise). `stage`
// is the legacy coarse stage string the minutes were authored with (e.g. "Live
// Discussion", "SoW Signed"); importMinutes maps it to a workflow step.
export type SeedOpportunity = {
  opportunity_name: string;
  service_line: ServiceLine;
  // Legacy coarse stage (mapped to a step if `step` is absent). Optional now.
  stage?: string;
  // A workflow step id to place the opportunity at directly (preferred over `stage`).
  step?: string;
  // Terminal lost flag (otherwise derived from stage === "Lost").
  lost?: boolean;
  description?: string;
  est_value?: number;
  probability?: number;
  next_step?: string;
};

// One compiled minute. Field names match the structured-minute frontmatter and the
// app's Meeting type; `opportunity` is null when none was spotted.
export type SeedMinute = {
  contact_url: string;
  meeting_no: number;
  meeting_stage: MeetingStage;
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
  opportunity_spotted?: OpportunitySpotted;
  actions_mine?: string;
  actions_theirs?: string;
  followup?: string;
  followup_date?: string;
  sentiment?: Sentiment;
  opportunity: SeedOpportunity | null;
  _source_file?: string;
};

// Fetch the compiled minutes. Returns [] if the file is missing (minutes never
// compiled) or unparseable — the app must still boot without it, so we fail soft.
export async function fetchSeedMinutes(): Promise<SeedMinute[]> {
  try {
    const res = await fetch("seed_meetings.json");
    if (!res.ok) return [];
    const data = (await res.json()) as SeedMinute[];
    return Array.isArray(data) ? data : [];
  } catch {
    console.warn("Could not load seed_meetings.json; skipping minutes seed.");
    return [];
  }
}
