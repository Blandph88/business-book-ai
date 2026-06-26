// Prompt builders for Business Book's AI features. Kept in one place so the voice is consistent and
// so we only ever send the MINIMAL context a feature needs (the privacy promise: the model sees what
// the task needs, nothing more). All on-device-friendly shapes: short drafts + summaries.

import type { PromptArgs } from "./ai";
import type { ContactRow } from "../tabs/ContactForm";
import type { MeetingRow } from "../data/meetings";

export type DraftKind = "first-touch" | "follow-up" | "reconnect";

const VOICE =
  "You help a professional-services consultant write to people in their network. Write in the first " +
  "person, plain and warm, like a real person — no corporate jargon, no emoji, no subject line, no " +
  "sign-off block. Never invent facts you weren't given. Output only the message text.";

function meetingNotes(meetings: MeetingRow[]): string {
  return meetings
    .map((m) => [m.purpose, m.notes, m.org_insights, m.pain_points].filter(Boolean).join(" — "))
    .filter(Boolean)
    .slice(0, 3)
    .join(" | ");
}

function contactContext(c: ContactRow, meetings: MeetingRow[]): string {
  const notes = meetingNotes(meetings);
  return [
    `Recipient: ${`${c.first} ${c.last}`.trim()}`,
    c.position ? `Their role: ${c.position}` : "",
    c.organisation ? `Their company: ${c.organisation}` : "",
    c.relationship_strength ? `Relationship strength: ${c.relationship_strength}` : "",
    c.last_contact_date ? `Last contact: ${c.last_contact_date}` : "",
    notes ? `From past meetings: ${notes}` : "",
    c.notes ? `My private notes: ${c.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function draftMessagePrompt(c: ContactRow, meetings: MeetingRow[], kind: DraftKind, tweak?: string): PromptArgs {
  const intent =
    kind === "first-touch"
      ? "This is a FIRST message — we haven't spoken before. Find a genuine, specific reason to reach out."
      : kind === "follow-up"
        ? "This is a FOLLOW-UP after recent contact. Reference it naturally and propose one clear next step."
        : "We've gone quiet for a while. Warmly RECONNECT without being awkward about the gap, and leave the door open to meet.";
  return {
    system: VOICE,
    prompt: `${intent}\n\nContext:\n${contactContext(c, meetings)}\n${tweak ? `\nExtra instruction: ${tweak}\n` : ""}\nWrite just the message body (2–4 sentences).`,
  };
}

export function briefContactPrompt(c: ContactRow, meetings: MeetingRow[]): PromptArgs {
  return {
    system:
      "You brief a busy consultant before they speak to someone in their network. Be concise and " +
      "practical. Use short labelled lines or bullets. Only use the facts provided; if something isn't " +
      "known, don't guess.",
    prompt:
      `Brief me on this contact before I reach out or meet them. Cover: who they are, where our ` +
      `relationship stands, anything to remember from past meetings, and one suggested next step.\n\n` +
      `Context:\n${contactContext(c, meetings)}`,
  };
}

// ── Meetings: raw notes → structured fields (#8) ───────────────────────────────────────────────
export type MeetingExtract = {
  actions_mine: string;
  actions_theirs: string;
  followup: string;
  followup_days: number;
  sentiment: string;
  opportunity_spotted: "Yes" | "No";
};
export function summarizeMeetingPrompt(notes: string, purpose?: string, orgInsights?: string, painPoints?: string): PromptArgs {
  const ctx = [purpose && `Purpose: ${purpose}`, `Notes: ${notes}`, orgInsights && `Org insights: ${orgInsights}`, painPoints && `Pain points: ${painPoints}`]
    .filter(Boolean)
    .join("\n");
  return {
    system: "You extract structure from a consultant's raw meeting notes. Stay faithful to the notes — never invent. Reply with ONLY a JSON object.",
    prompt:
      `From these meeting notes, return JSON with keys exactly:\n` +
      `{"actions_mine": string, "actions_theirs": string, "followup": string, "followup_days": number, ` +
      `"sentiment": "Very Positive"|"Positive"|"Neutral"|"Cautious"|"Negative", "opportunity_spotted": "Yes"|"No"}\n` +
      `Use "" or 0 where nothing applies. followup_days = days from today for the next touch.\n\n${ctx}`,
  };
}

// ── Contacts: auto-suggest CRM fields (#6, behind a button) ────────────────────────────────────
export type CrmSuggest = {
  relationship_strength: string;
  priority: string;
  decision_role: string;
  next_action: string;
  next_action_days: number;
};
export function suggestCrmPrompt(c: ContactRow, meetings: MeetingRow[], rel: readonly string[], pri: readonly string[], roles: readonly string[]): PromptArgs {
  return {
    system: "You set CRM fields for a contact from what's known. Be realistic — don't over-rate cold contacts. Reply with ONLY a JSON object.",
    prompt:
      `Suggest CRM values as JSON with keys exactly:\n` +
      `{"relationship_strength": one of ${JSON.stringify(rel)}, "priority": one of ${JSON.stringify(pri)}, ` +
      `"decision_role": one of ${JSON.stringify(roles)}, "next_action": string (a concrete next step), "next_action_days": number}\n\n` +
      `Context:\n${contactContext(c, meetings)}`,
  };
}

// ── Account summary (#11) ──────────────────────────────────────────────────────────────────────
export function accountSummaryPrompt(org: string, contactLines: string[], meetingLines: string[], oppLines: string[]): PromptArgs {
  return {
    system: "You brief a consultant on their position at one organisation. Be concise and practical; short labelled lines. Only use provided facts.",
    prompt:
      `Summarise my position at ${org}: how many people I know and how senior, the state of any opportunities, ` +
      `recent meeting activity, my strongest relationship, and the biggest gap. End with one suggested next move.\n\n` +
      `Contacts (${contactLines.length}):\n${contactLines.slice(0, 40).join("\n")}\n\n` +
      `Meetings:\n${meetingLines.slice(0, 20).join("\n") || "none"}\n\n` +
      `Opportunities:\n${oppLines.slice(0, 20).join("\n") || "none"}`,
  };
}

// ── Transcript → structured notes + opportunity (#9) ───────────────────────────────────────────
export type TranscriptExtract = {
  summary: string;
  purpose: string;
  sentiment: string;
  actions_mine: string;
  actions_theirs: string;
  pain_points: string;
  org_insights: string;
  followup: string;
  followup_days: number;
  opportunity_spotted: "Yes" | "No";
  opportunity_name: string;
};
export function transcriptPrompt(transcript: string): PromptArgs {
  return {
    system: "You turn a raw call/meeting transcript into structured CRM notes for a consultant. Be faithful; never invent. Reply with ONLY a JSON object.",
    prompt:
      `From this transcript, return JSON with keys exactly:\n` +
      `{"summary": string (3-5 sentences), "purpose": string (the meeting's objective in one short line), ` +
      `"sentiment": "Very Positive"|"Positive"|"Neutral"|"Cautious"|"Negative", ` +
      `"actions_mine": string (my action items), "actions_theirs": string (their action items), ` +
      `"pain_points": string (their problems/challenges), "org_insights": string (facts learned about their organisation — structure, scale, targets, context), ` +
      `"followup": string (one-line suggested next touch), "followup_days": number (days from today for the follow-up; 0 if none), ` +
      `"opportunity_spotted": "Yes"|"No", "opportunity_name": string}\n` +
      `Use "" or 0 where nothing applies.\n\n` +
      `Transcript:\n${transcript.slice(0, 12000)}`,
  };
}

// ── Dashboard "Your day" morning brief (#7) ────────────────────────────────────────────────────
export function yourDayPrompt(context: string): PromptArgs {
  return {
    system: "You are a sharp chief-of-staff giving a consultant their morning brief. Be brief, specific and prioritised. Use only the data given; never invent names or numbers.",
    prompt: `Here's my book today. Give me a short brief — the 3–5 most important things to do, each one line with a clear why. Plain text, no preamble.\n\n${context}`,
  };
}

// ── NL query / copilot bar (#10) ───────────────────────────────────────────────────────────────
export type NlResult = {
  answer: string;
  tab?: "contacts" | "meetings" | "opportunities" | "revenue" | "metrics" | "dashboard" | null;
  filters?: Record<string, string> | null;
  search?: string | null;
};
export function nlQueryPrompt(query: string, vocab: string): PromptArgs {
  return {
    system: "You translate a consultant's natural-language request about their network/pipeline into a navigation + filter instruction for their CRM app, plus a one-line answer. Reply with ONLY a JSON object.",
    prompt:
      `App tabs: contacts, meetings, opportunities, revenue, metrics, dashboard.\n` +
      `Contact filter fields and their allowed values:\n${vocab}\n\n` +
      `Return JSON with keys exactly:\n` +
      `{"answer": string (one line), "tab": one of the tabs or null, "filters": object mapping a contact filter field to one allowed value (or null), "search": string or null}\n\n` +
      `Request: ${query}`,
  };
}
