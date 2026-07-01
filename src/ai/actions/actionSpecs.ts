// The action framework: per-entity field schema + extractor + writer, so the copilot can CREATE and
// UPDATE records conversationally. The AI only EXTRACTS values from free text (reusing the existing
// extractors); the user reviews a card and CONFIRMS before anything is written (the hallucination
// backstop). Writes go through the same storage functions the forms use, with deterministic ids so a
// retry never duplicates, and each returns an `undo` that restores the prior state.

import type { Contact } from "../../data/contacts";
import type { MeetingRow } from "../../data/meetings";
import type { Meeting } from "../../storage/meetings";
import type { Opportunity } from "../../storage/opportunities";
import type { Sow } from "../../storage/revenue";
import type { OwnerEdits } from "../../storage/ownerEdits";
import { saveMeeting, deleteMeeting, loadAllMeetings } from "../../storage/meetings";
import { saveOpportunity, deleteOpportunity } from "../../storage/opportunities";
import { saveSow, deleteSow } from "../../storage/revenue";
import { saveEdits, loadAllEdits, editsFor } from "../../storage/ownerEdits";
import { saveOwnedContact, deleteOwnedContact, contactKeyFromLinkedIn } from "../../storage/ownedContacts";
import { classifyContact } from "../../data/classify";
import { meetingId } from "../../data/meetings";
import {
  MEETING_STAGE, MEETING_TYPE, SENTIMENT, OPPORTUNITY_SPOTTED, RELATIONSHIP_STRENGTH, PRIORITY, DECISION_ROLE,
  SERVICE_LINE, REVENUE_STATUS, OPPORTUNITY_STEPS, OWNER_NAME,
  type MeetingStage, type MeetingType, type Sentiment, type OpportunitySpotted, type RelationshipStrength, type Priority, type DecisionRole, type ServiceLine, type OpportunityStep, type RevenueStatus,
} from "../../data/vocab";
import { aiJson } from "../ai";
import { summarizeMeetingPrompt, transcriptPrompt, fillOpportunityPrompt, fillContractPrompt, type MeetingExtract, type TranscriptExtract, type OppFill, type ContractFill } from "../prompts";

export type FieldType = "text" | "textarea" | "enum" | "date" | "number";
export type FieldSpec = { key: string; label: string; type: FieldType; options?: readonly string[]; required?: boolean; placeholder?: string };
export type ActionKind = "meeting" | "opportunity" | "contact" | "contract";

export type ActionCtx = {
  op: "create" | "update";
  text: string;
  subjectUrl?: string; // chosen contact (for meeting/contact)
  targetId?: string; // the EXISTING record being updated (opportunity/contract) — so update edits in place
  today: string;
  contacts: Contact[];
  meetingRows: MeetingRow[];
  opps: Opportunity[];
  sows: Sow[];
  // Skip the (slow, on a small model) AI field-extraction call and open the form with deterministic
  // prefills only. Set for on-device tiers on short commands, so "Working…" doesn't hang for tens of
  // seconds parsing a bare "log an opportunity for X" that has nothing to extract anyway.
  skipModel?: boolean;
};
export type ActionResult = { id: string; summary: string; undo: () => void };
export type EntitySpec = {
  kind: ActionKind;
  label: string;
  needsContact: boolean;
  // Usually a fixed field list; a function when the fields differ by op (e.g. CREATE a contact needs
  // name/org/title inputs, UPDATE a contact edits CRM fields on an existing row).
  fields: FieldSpec[] | ((op: "create" | "update") => FieldSpec[]);
  title: (ctx: ActionCtx) => string;
  extract: (ctx: ActionCtx) => Promise<Record<string, string>>;
  write: (values: Record<string, string>, ctx: ActionCtx) => ActionResult;
};

// ── helpers ────────────────────────────────────────────────────────────────────────────────────
const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e9)}`);
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
// Pick the enum option whose value appears in the text (case-insensitive).
function matchEnum<T extends readonly string[]>(text: string, options: T): T[number] | "" {
  const t = text.toLowerCase();
  for (const o of options) if (t.includes(o.toLowerCase())) return o as T[number];
  return "";
}
function norm<T extends readonly string[]>(v: string | undefined, options: T): string {
  if (!v) return "";
  return options.some((o) => o.toLowerCase() === v.toLowerCase()) ? options.find((o) => o.toLowerCase() === v.toLowerCase())! : "";
}
// Small models often echo the user's COMMAND back as a field value ("Log opportunity", "add an
// opportunity"). Reject those so the name/description stay blank for the user to fill, rather than saving
// the command as the record's name.
function notACommand(s: string | undefined): string {
  const t = (s || "").trim();
  if (!t) return "";
  if (/^(log|add|create|new|make|set ?up|record|open|draft|note)\b/i.test(t)) return "";
  if (/^(an?\s+)?(new\s+)?opportunit/i.test(t)) return "";
  if (/opportunit(y|ies)$/i.test(t) && t.split(/\s+/).length <= 3) return "";
  return t;
}
// Strip a leading "log/record a meeting with <name>" command, keeping any REAL notes typed after it (so
// "log a meeting with Adam: discussed pricing" → "discussed pricing", but a bare command → "").
function stripMeetingCommand(text: string): string {
  return text
    .replace(/^\s*(log|record|add|create|note|capture|save|had|have)\b[^:.\n]*?\bmeeting\b[^:.\n]*?\b(?:with|for)\s+[\w .'-]+/i, "")
    .replace(/^[\s:,.–—-]+/, "")
    .trim();
}
// "£200k", "200k", "1.5m", "200,000" → number (0 if none).
export function parseMoney(text: string): number {
  const m = text.match(/(?:[£$€]\s?)?(\d[\d,]*(?:\.\d+)?)\s*([kmb])?/i);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/,/g, ""));
  const unit = (m[2] || "").toLowerCase();
  if (unit === "k") n *= 1_000; else if (unit === "m") n *= 1_000_000; else if (unit === "b") n *= 1_000_000_000;
  return Math.round(n);
}
function contactName(ctx: ActionCtx, url?: string): string {
  const c = ctx.contacts.find((x) => x.url === url);
  return c ? `${c.first} ${c.last}`.trim() : "the contact";
}
function nextMeetingNo(ctx: ActionCtx, url: string): number {
  const nos = ctx.meetingRows.filter((r) => r.contact_url === url).map((r) => r.meeting_no);
  return nos.length ? Math.max(...nos) + 1 : 1;
}

// Find contacts a free-text subject refers to (name first, org as a booster). Returns best matches.
export function matchContacts(query: string, contacts: Contact[]): Contact[] {
  const STOP = new Set(["the", "from", "at", "with", "and", "mr", "ms", "dr", "a", "an"]);
  // Exact full-name match wins outright (so "Adam Brown" prefills Adam Brown, not every "…Brown").
  const ql = query.trim().toLowerCase();
  const exact = contacts.filter((c) => `${c.first} ${c.last}`.trim().toLowerCase() === ql);
  if (exact.length) return exact;
  const toks = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !STOP.has(t));
  if (!toks.length) return [];
  const scored = contacts
    .map((c) => {
      const nameToks = `${c.first} ${c.last}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const orgToks = (c.organisation || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      let score = 0;
      for (const t of toks) {
        if (nameToks.some((n) => n.startsWith(t))) score += 2;
        else if (orgToks.some((o) => o.startsWith(t))) score += 1;
      }
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  // Keep only the top score band (so "Jane" doesn't drag in org-only weak matches when a name matched).
  const top = scored[0]?.score ?? 0;
  return scored.filter((x) => x.score >= Math.max(2, top - 1)).map((x) => x.c).slice(0, 6);
}

// Words that aren't org/name tokens when resolving WHICH opportunity a command refers to.
const OPP_REF_STOP = new Set(["the", "deal", "deals", "opportunity", "opportunities", "as", "won", "lost", "mark", "set", "move", "update", "this", "that", "make", "change", "status", "now", "dead", "signed", "closed", "close", "pipeline", "stage"]);
// Resolve which existing opportunity a command points at, by org/name token overlap ("the JPMorgan deal" →
// the JPMorgan opportunity). Best matches first; [] if nothing recognisable.
export function matchOpportunity(query: string, opps: Opportunity[]): Opportunity[] {
  const toks = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !OPP_REF_STOP.has(t));
  if (!toks.length) return [];
  const scored = opps.map((o) => {
    const hay = `${o.opportunity_name || ""} ${o.organisation || ""}`.toLowerCase();
    return { o, score: toks.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0) };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const top = scored[0]?.score ?? 0;
  return scored.filter((x) => x.score >= top).map((x) => x.o);
}
// Pull the ORGANISATION named in a command, for prefill. Prefers a KNOWN org (distinctive ≥4-char token),
// else captures a proper noun after at/with/for/from ("an opportunity at Microsoft worth £200k" → "Microsoft").
function extractOrg(text: string, ctx: ActionCtx): string {
  const t = ` ${text.toLowerCase()} `;
  const known = new Set<string>();
  for (const c of ctx.contacts) if (c.organisation) known.add(c.organisation);
  for (const o of ctx.opps) if (o.organisation) known.add(o.organisation);
  let best = "";
  for (const org of known) {
    const toks = org.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
    if (toks.some((w) => t.includes(` ${w} `) || t.includes(` ${w},`) || t.includes(` ${w}.`))) { if (org.length > best.length) best = org; }
  }
  if (best) return best;
  const m = text.match(/\b(?:at|with|for|from)\s+([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,3})/);
  if (m) return m[1].replace(/\s+(worth|valued|deal|opportunity|on|about|re)\b.*$/i, "").trim();
  return "";
}

// ── MEETING ──────────────────────────────────────────────────────────────────────────────────
const meetingSpec: EntitySpec = {
  kind: "meeting",
  label: "Meeting",
  needsContact: true,
  fields: [
    { key: "meeting_stage", label: "Stage", type: "enum", options: MEETING_STAGE, required: true },
    { key: "type", label: "Type", type: "enum", options: MEETING_TYPE },
    { key: "date_held", label: "Date held", type: "date" },
    { key: "date_scheduled", label: "Date scheduled", type: "date" },
    { key: "purpose", label: "Purpose", type: "text" },
    { key: "notes", label: "Notes", type: "textarea" },
    { key: "sentiment", label: "Sentiment", type: "enum", options: SENTIMENT },
    { key: "actions_mine", label: "My actions", type: "text" },
    { key: "actions_theirs", label: "Their actions", type: "text" },
    { key: "followup", label: "Follow-up", type: "text" },
    { key: "followup_date", label: "Follow-up date", type: "date" },
    { key: "opportunity_spotted", label: "Opportunity spotted", type: "enum", options: OPPORTUNITY_SPOTTED },
  ],
  title: (ctx) => (ctx.op === "update" ? `Update meeting with ${contactName(ctx, ctx.subjectUrl)}` : `New meeting with ${contactName(ctx, ctx.subjectUrl)}`),
  extract: async (ctx) => {
    // UPDATE an existing meeting → prefill it so "mark my meeting as held" / "add notes to my meeting"
    // EDITS it in place instead of creating a duplicate. (targetId resolved in startAction.)
    if (ctx.targetId) {
      const v: Record<string, string> = {};
      const stored = loadAllMeetings()[ctx.targetId];
      const row = ctx.meetingRows.find((m) => m.id === ctx.targetId);
      if (stored) {
        v.meeting_stage = stored.meeting_stage || "Held";
        if (stored.date_held) v.date_held = stored.date_held;
        if (stored.date_scheduled) v.date_scheduled = stored.date_scheduled;
        if (stored.type) v.type = stored.type;
        if (stored.purpose) v.purpose = stored.purpose;
        if (stored.notes) v.notes = stored.notes;
        if (stored.sentiment) v.sentiment = stored.sentiment;
        if (stored.actions_mine) v.actions_mine = stored.actions_mine;
        if (stored.actions_theirs) v.actions_theirs = stored.actions_theirs;
        if (stored.followup) v.followup = stored.followup;
      } else if (row) {
        v.meeting_stage = row.meeting_stage || "Scheduled";
        if (row.date_scheduled) v.date_scheduled = row.date_scheduled;
      }
      if (/\b(held|happened|done|completed|we met|met them)\b/i.test(ctx.text)) { v.meeting_stage = "Held"; if (!v.date_held) v.date_held = ctx.today; }
      return v;
    }
    const future = /\b(i'?m meeting|i am meeting|will meet|going to meet|next (week|month|tuesday|monday|wednesday|thursday|friday)|upcoming|schedule|set up|seeing .* (on|next))\b/i.test(ctx.text);
    // Notes default to any REAL content the user typed (the bare "log a meeting with X" command is stripped,
    // not echoed into the field) — they'll usually fill this from notes/a transcript.
    const v: Record<string, string> = { meeting_stage: future ? "Scheduled" : "Held", notes: stripMeetingCommand(ctx.text) };
    if (!future) v.date_held = ctx.today;
    if (ctx.skipModel) return v; // deterministic-only (on-device, short command) — open the form fast
    try {
      if (ctx.text.length > 600) {
        const ex = await aiJson<TranscriptExtract>(transcriptPrompt(ctx.text));
        v.purpose = ex.purpose || ""; v.notes = ex.summary || stripMeetingCommand(ctx.text); v.sentiment = norm(ex.sentiment, SENTIMENT);
        v.actions_mine = notACommand(ex.actions_mine); v.actions_theirs = notACommand(ex.actions_theirs);
        v.followup = ex.followup || ""; v.opportunity_spotted = ex.opportunity_spotted === "Yes" ? "Yes" : "No";
        if (ex.followup_days > 0) v.followup_date = addDays(ctx.today, ex.followup_days);
      } else {
        const ex = await aiJson<MeetingExtract>(summarizeMeetingPrompt(ctx.text));
        v.actions_mine = notACommand(ex.actions_mine); v.actions_theirs = notACommand(ex.actions_theirs);
        v.followup = ex.followup || ""; v.sentiment = norm(ex.sentiment, SENTIMENT);
        v.opportunity_spotted = ex.opportunity_spotted === "Yes" ? "Yes" : "No";
        if (ex.followup_days > 0) v.followup_date = addDays(ctx.today, ex.followup_days);
      }
    } catch { /* leave blanks for the user to fill in the card */ }
    return v;
  },
  write: (values, ctx) => {
    const build = (id: string, url: string, no: number): Meeting => ({
      id, contact_url: url, meeting_no: no,
      meeting_stage: (norm(values.meeting_stage, MEETING_STAGE) as MeetingStage) || "Held",
      date_held: values.date_held || undefined,
      date_scheduled: values.date_scheduled || undefined,
      type: (norm(values.type, MEETING_TYPE) as MeetingType) || undefined,
      attendees_ours: OWNER_NAME, attendees_client: contactName(ctx, url),
      purpose: values.purpose || undefined, notes: values.notes || undefined,
      actions_mine: values.actions_mine || undefined, actions_theirs: values.actions_theirs || undefined,
      followup: values.followup || undefined, followup_date: values.followup_date || undefined,
      sentiment: (norm(values.sentiment, SENTIMENT) as Sentiment) || undefined,
      opportunity_spotted: (norm(values.opportunity_spotted, OPPORTUNITY_SPOTTED) as OpportunitySpotted) || undefined,
    });
    // UPDATE in place when we resolved an existing meeting — never spawn a duplicate.
    if (ctx.targetId) {
      const row = ctx.meetingRows.find((m) => m.id === ctx.targetId);
      const url = row?.contact_url ?? ctx.subjectUrl!;
      const no = row?.meeting_no ?? nextMeetingNo(ctx, url);
      const before = loadAllMeetings()[ctx.targetId];
      saveMeeting(build(ctx.targetId, url, no));
      return { id: ctx.targetId, summary: `Updated your meeting with ${contactName(ctx, url)}.`, undo: () => { before ? saveMeeting(before) : deleteMeeting(ctx.targetId!); } };
    }
    const url = ctx.subjectUrl!;
    const no = nextMeetingNo(ctx, url);
    const id = meetingId(url, no);
    saveMeeting(build(id, url, no));
    return { id, summary: `Saved your meeting with ${contactName(ctx, url)}.`, undo: () => deleteMeeting(id) };
  },
};

// ── CONTACT (owner-maintained CRM fields) ───────────────────────────────────────────────────────
// CREATE: capture a brand-new person (met someone not on LinkedIn). UPDATE: edit CRM fields on an existing row.
const CONTACT_CREATE_FIELDS: FieldSpec[] = [
  { key: "first", label: "First name", type: "text", required: true },
  { key: "last", label: "Last name", type: "text", required: true },
  { key: "organisation", label: "Organisation", type: "text", required: true },
  { key: "position", label: "Role / title", type: "text" },
  { key: "linkedin_url", label: "LinkedIn URL (links a future refresh, avoids duplicates)", type: "text" },
  { key: "relationship_strength", label: "Relationship", type: "enum", options: RELATIONSHIP_STRENGTH },
  { key: "notes", label: "Note", type: "textarea" },
];
const CONTACT_UPDATE_FIELDS: FieldSpec[] = [
  { key: "relationship_strength", label: "Relationship", type: "enum", options: RELATIONSHIP_STRENGTH },
  { key: "priority", label: "Priority", type: "enum", options: PRIORITY },
  { key: "decision_role", label: "Decision role", type: "enum", options: DECISION_ROLE },
  { key: "based_in", label: "Based in", type: "text" },
  { key: "next_action", label: "Next action", type: "text" },
  { key: "next_action_date", label: "Next action date", type: "date" },
  { key: "notes", label: "Add note", type: "textarea" },
];

// Parse "Jane Doe, CFO at Acme" / "Jane Doe at Acme" / "add a new contact Jane Smith from EY" into fields.
// Best-effort — the user reviews the propose→confirm card and fixes anything before it saves.
function parseNewContact(text: string): Record<string, string> {
  const v: Record<string, string> = {};
  let s = text
    .replace(/^\s*(?:can you |could you |please |)?(?:add|create|log|save|make|new)\s+(?:a\s+)?(?:new\s+)?contact\b\s*(?:called|named|for|:|-|–)?\s*/i, "")
    .replace(/^(?:called|named)\s+/i, "")
    .trim();
  const liM = s.match(/\bhttps?:\/\/\S*linkedin\.com\/in\/\S+/i) || s.match(/\blinkedin\.com\/in\/\S+/i);
  if (liM) { v.linkedin_url = liM[0].replace(/[.,)]+$/, ""); s = s.replace(liM[0], "").replace(/\b(?:linkedin|li)\s*[:=]?\s*$/i, "").trim(); }
  const orgM = s.match(/\b(?:at|from|with|@)\s+([A-Za-z0-9&.,'\- ]+?)\s*$/i);
  if (orgM) { v.organisation = orgM[1].trim().replace(/[.,]$/, ""); s = s.slice(0, orgM.index).trim(); }
  const titleM = s.match(/^(.+?)\s*[,\-–]\s*(.+)$/);
  let namePart = s;
  if (titleM) { namePart = titleM[1].trim(); v.position = titleM[2].trim().replace(/[.,]$/, ""); }
  const toks = namePart.split(/\s+/).filter(Boolean);
  if (toks.length >= 1) v.first = toks[0];
  if (toks.length >= 2) v.last = toks[1];
  if (!v.position && toks.length > 2) v.position = toks.slice(2).join(" ");
  return v;
}

const contactSpec: EntitySpec = {
  kind: "contact",
  label: "Contact",
  needsContact: true, // for UPDATE; CREATE overrides this in startAction (no existing contact to resolve)
  fields: (op) => (op === "create" ? CONTACT_CREATE_FIELDS : CONTACT_UPDATE_FIELDS),
  title: (ctx) => (ctx.op === "create" ? "New contact" : `Update ${contactName(ctx, ctx.subjectUrl)}`),
  extract: async (ctx) => {
    if (ctx.op === "create") {
      const v = parseNewContact(ctx.text);
      const rel = matchEnum(ctx.text, RELATIONSHIP_STRENGTH); if (rel) v.relationship_strength = rel;
      return v;
    }
    const t = ctx.text; const v: Record<string, string> = {};
    const rel = matchEnum(t, RELATIONSHIP_STRENGTH); if (rel) v.relationship_strength = rel;
    if (/\bhigh priority\b/i.test(t)) v.priority = "High"; else if (/\b(medium|med)\s+priority\b/i.test(t)) v.priority = "Medium"; else if (/\blow priority\b/i.test(t)) v.priority = "Low";
    if (/\bdecision[- ]?maker\b/i.test(t)) v.decision_role = "Decision Maker"; else if (/\binfluencer\b/i.test(t)) v.decision_role = "Influencer"; else if (/\bgatekeeper\b/i.test(t)) v.decision_role = "Gatekeeper";
    const based = t.match(/\bbased in\s+([\w ,.'-]+)/i); if (based) v.based_in = based[1].trim().replace(/[.,]$/, "");
    const remind = t.match(/\b(?:remind me to|next action[:]?|next step[:]?)\s+(.+)/i); if (remind) v.next_action = remind[1].trim();
    const note = t.match(/\bnote(?:\s+(?:to|on|for|about)\s+[\w ]+?)?[:]\s*(.+)/i); if (note) v.notes = note[1].trim();
    return v;
  },
  write: (values, ctx) => {
    // CREATE → a brand-new owned contact, classified (sector/seniority/function) just like an import.
    if (ctx.op === "create") {
      const url = contactKeyFromLinkedIn(values.linkedin_url);
      const enriched = classifyContact({ first: values.first, last: values.last, company: values.organisation, title: values.position, url });
      const contact: Contact = { ...enriched, messaged: false, responded: false, two_way: false, agreed_to_meet: false, met: false, phone: "" };
      saveOwnedContact(contact);
      const edits: OwnerEdits = {};
      if (values.relationship_strength) edits.relationship_strength = values.relationship_strength as RelationshipStrength;
      if (values.notes) edits.notes = values.notes;
      if (Object.keys(edits).length) saveEdits(url, edits);
      const name = `${values.first ?? ""} ${values.last ?? ""}`.trim() || "the contact";
      return { id: url, summary: `Added ${name}${values.organisation ? ` (${values.organisation})` : ""} to your contacts.`, undo: () => { deleteOwnedContact(url); saveEdits(url, {}); } };
    }
    const url = ctx.subjectUrl!;
    const prior = editsFor(loadAllEdits(), url) ?? {};
    const next: OwnerEdits = { ...prior };
    if (values.relationship_strength) next.relationship_strength = values.relationship_strength as RelationshipStrength;
    if (values.priority) next.priority = values.priority as Priority;
    if (values.decision_role) next.decision_role = values.decision_role as DecisionRole;
    if (values.based_in) next.based_in = values.based_in;
    if (values.next_action) next.next_action = values.next_action;
    if (values.next_action_date) next.next_action_date = values.next_action_date;
    if (values.notes) next.notes = prior.notes ? `${prior.notes}\n${values.notes}` : values.notes;
    saveEdits(url, next);
    return { id: url, summary: `Updated ${contactName(ctx, url)}.`, undo: () => saveEdits(url, prior) };
  },
};

// ── OPPORTUNITY ─────────────────────────────────────────────────────────────────────────────────
const STEP_IDS = OPPORTUNITY_STEPS.map((s) => s.id);
function stepProb(step: string): number {
  return OPPORTUNITY_STEPS.find((s) => s.id === step)?.prob ?? 0.1;
}
const opportunitySpec: EntitySpec = {
  kind: "opportunity",
  label: "Opportunity",
  needsContact: false,
  fields: [
    { key: "opportunity_name", label: "Name", type: "text", required: true },
    { key: "organisation", label: "Organisation", type: "text", required: true },
    { key: "primary_contact", label: "Primary contact", type: "text" },
    { key: "service_line", label: "Service line", type: "enum", options: SERVICE_LINE },
    { key: "current_step", label: "Stage", type: "enum", options: STEP_IDS },
    { key: "est_value", label: "Est. value", type: "number" },
    { key: "description", label: "Description", type: "textarea" },
  ],
  title: (ctx) => {
    if (ctx.op === "update") {
      const ex = ctx.targetId ? ctx.opps.find((o) => o.id === ctx.targetId) : undefined;
      return ex ? `Update: ${ex.opportunity_name || ex.organisation || "opportunity"}` : "Update opportunity";
    }
    return "New opportunity";
  },
  extract: async (ctx) => {
    const v: Record<string, string> = { current_step: "meeting", service_line: "Strategy" };
    // Deterministic prefill (EVERY tier, incl. on-device): if updating, load the real opportunity and fill
    // the form with its current values; on create, pull the organisation named in the command.
    const existing = ctx.targetId ? ctx.opps.find((o) => o.id === ctx.targetId) : undefined;
    if (existing) {
      v.opportunity_name = existing.opportunity_name || "";
      v.organisation = existing.organisation || "";
      if (existing.primary_contact) v.primary_contact = existing.primary_contact;
      if (existing.service_line) v.service_line = existing.service_line;
      v.current_step = existing.current_step || "meeting";
      if (existing.est_value != null) v.est_value = String(existing.est_value);
      if (existing.description) v.description = existing.description;
    } else {
      const org = extractOrg(ctx.text, ctx); if (org) v.organisation = org;
    }
    // "mark … as won/signed/landed" → jump the stage to closed-won.
    if (/\b(won|signed|closed[- ]?won|landed|secured|in the bag)\b/i.test(ctx.text)) v.current_step = "contracting";
    const money = parseMoney(ctx.text); if (money) v.est_value = String(money);
    if (ctx.skipModel) return v; // deterministic-only (on-device): the form opens pre-filled, fast
    try {
      const ex = await aiJson<OppFill>(fillOpportunityPrompt(ctx.text, SERVICE_LINE));
      const name = notACommand(ex.opportunity_name); if (name && !existing) v.opportunity_name = name;
      if (ex.organisation && !v.organisation) v.organisation = ex.organisation;
      if (ex.primary_contact && !v.primary_contact) v.primary_contact = ex.primary_contact;
      if (!existing) { const sl = norm(ex.service_line, SERVICE_LINE); if (sl) v.service_line = sl; }
      if (!v.est_value && ex.est_value) v.est_value = String(ex.est_value);
      const desc = notACommand(ex.description); if (desc && !v.description) v.description = desc;
    } catch { /* keep the deterministic prefill */ }
    return v;
  },
  write: (values, ctx) => {
    const step = (norm(values.current_step, STEP_IDS) as OpportunityStep) || "meeting";
    const WON_IDX = STEP_IDS.indexOf("contracting");
    // UPDATE in place when we resolved an existing deal — never spawn a duplicate.
    const existing = ctx.targetId ? ctx.opps.find((o) => o.id === ctx.targetId) : undefined;
    if (existing) {
      const before = { ...existing };
      const updated: Opportunity = {
        ...existing,
        opportunity_name: values.opportunity_name || existing.opportunity_name,
        organisation: values.organisation || existing.organisation,
        primary_contact: values.primary_contact || existing.primary_contact,
        service_line: (norm(values.service_line, SERVICE_LINE) as ServiceLine) || existing.service_line,
        current_step: step,
        est_value: values.est_value ? Number(values.est_value) : existing.est_value,
        probability: stepProb(step),
        description: values.description || existing.description,
        lost: STEP_IDS.indexOf(step) >= WON_IDX ? false : existing.lost, // moving to a won step clears "lost"
      };
      saveOpportunity(updated);
      return { id: existing.id, summary: `Updated “${updated.opportunity_name}” — now at ${step.replace(/_/g, " ")}.`, undo: () => saveOpportunity(before) };
    }
    const id = `opp:${uuid()}`;
    const opp: Opportunity = {
      id,
      opportunity_name: values.opportunity_name || `${values.organisation || "New"} opportunity`,
      organisation: values.organisation || "",
      primary_contact: values.primary_contact || "",
      service_line: (norm(values.service_line, SERVICE_LINE) as ServiceLine) || "Strategy",
      current_step: step,
      est_value: values.est_value ? Number(values.est_value) : undefined,
      probability: stepProb(step),
      description: values.description || undefined,
      contact_url: ctx.subjectUrl || undefined,
    };
    saveOpportunity(opp);
    return { id, summary: `Created the opportunity “${opp.opportunity_name}”.`, undo: () => deleteOpportunity(id) };
  },
};

// ── CONTRACT (SoW) ────────────────────────────────────────────────────────────────────────────
const contractSpec: EntitySpec = {
  kind: "contract", // internal id stays "contract"; the user-facing label is "Engagement"
  label: "Engagement",
  needsContact: false,
  fields: [
    { key: "engagement_name", label: "Engagement name", type: "text", required: true },
    { key: "organisation", label: "Organisation", type: "text", required: true },
    { key: "service_line", label: "Service line", type: "enum", options: SERVICE_LINE },
    { key: "status", label: "Status", type: "enum", options: REVENUE_STATUS },
    { key: "signed_date", label: "Signed date", type: "date" },
  ],
  title: () => "New engagement",
  extract: async (ctx) => {
    const v: Record<string, string> = { status: "Active", signed_date: ctx.today, service_line: "Strategy" };
    if (ctx.skipModel) return v; // deterministic-only (on-device, short command)
    try {
      const ex = await aiJson<ContractFill>(fillContractPrompt(ctx.text, SERVICE_LINE, REVENUE_STATUS));
      if (ex.engagement_name) v.engagement_name = ex.engagement_name;
      if (ex.organisation) v.organisation = ex.organisation;
      v.service_line = norm(ex.service_line, SERVICE_LINE) || "Strategy";
      v.status = norm(ex.status, REVENUE_STATUS) || "Active";
    } catch { v.service_line = "Strategy"; }
    return v;
  },
  write: (values) => {
    const id = `sow:${uuid()}`;
    const sow: Sow = {
      id,
      organisation: values.organisation || "",
      engagement_name: values.engagement_name || `${values.organisation || "New"} engagement`,
      service_line: (norm(values.service_line, SERVICE_LINE) as ServiceLine) || "Strategy",
      status: (norm(values.status, REVENUE_STATUS) as RevenueStatus) || "Active",
      signed_date: values.signed_date || undefined,
    };
    saveSow(sow);
    return { id, summary: `Created the engagement “${sow.engagement_name}”.`, undo: () => deleteSow(id) };
  },
};

export const SPECS: Record<ActionKind, EntitySpec> = {
  meeting: meetingSpec,
  contact: contactSpec,
  opportunity: opportunitySpec,
  contract: contractSpec,
};
