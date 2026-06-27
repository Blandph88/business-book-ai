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
import { saveMeeting, deleteMeeting } from "../../storage/meetings";
import { saveOpportunity, deleteOpportunity } from "../../storage/opportunities";
import { saveSow, deleteSow } from "../../storage/revenue";
import { saveEdits, loadAllEdits, editsFor } from "../../storage/ownerEdits";
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
  today: string;
  contacts: Contact[];
  meetingRows: MeetingRow[];
  opps: Opportunity[];
  sows: Sow[];
};
export type ActionResult = { id: string; summary: string; undo: () => void };
export type EntitySpec = {
  kind: ActionKind;
  label: string;
  needsContact: boolean;
  fields: FieldSpec[];
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
  title: (ctx) => `New meeting with ${contactName(ctx, ctx.subjectUrl)}`,
  extract: async (ctx) => {
    const future = /\b(i'?m meeting|i am meeting|will meet|going to meet|next (week|month|tuesday|monday|wednesday|thursday|friday)|upcoming|schedule|set up|seeing .* (on|next))\b/i.test(ctx.text);
    const v: Record<string, string> = { meeting_stage: future ? "Scheduled" : "Held", notes: ctx.text };
    if (!future) v.date_held = ctx.today;
    try {
      if (ctx.text.length > 600) {
        const ex = await aiJson<TranscriptExtract>(transcriptPrompt(ctx.text));
        v.purpose = ex.purpose || ""; v.notes = ex.summary || ctx.text; v.sentiment = norm(ex.sentiment, SENTIMENT);
        v.actions_mine = ex.actions_mine || ""; v.actions_theirs = ex.actions_theirs || "";
        v.followup = ex.followup || ""; v.opportunity_spotted = ex.opportunity_spotted === "Yes" ? "Yes" : "No";
        if (ex.followup_days > 0) v.followup_date = addDays(ctx.today, ex.followup_days);
      } else {
        const ex = await aiJson<MeetingExtract>(summarizeMeetingPrompt(ctx.text));
        v.actions_mine = ex.actions_mine || ""; v.actions_theirs = ex.actions_theirs || "";
        v.followup = ex.followup || ""; v.sentiment = norm(ex.sentiment, SENTIMENT);
        v.opportunity_spotted = ex.opportunity_spotted === "Yes" ? "Yes" : "No";
        if (ex.followup_days > 0) v.followup_date = addDays(ctx.today, ex.followup_days);
      }
    } catch { /* leave blanks for the user to fill in the card */ }
    return v;
  },
  write: (values, ctx) => {
    const url = ctx.subjectUrl!;
    const no = nextMeetingNo(ctx, url);
    const id = meetingId(url, no);
    const meeting: Meeting = {
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
    };
    saveMeeting(meeting);
    return { id, summary: `Saved your meeting with ${contactName(ctx, url)}.`, undo: () => deleteMeeting(id) };
  },
};

// ── CONTACT (owner-maintained CRM fields) ───────────────────────────────────────────────────────
const contactSpec: EntitySpec = {
  kind: "contact",
  label: "Contact",
  needsContact: true,
  fields: [
    { key: "relationship_strength", label: "Relationship", type: "enum", options: RELATIONSHIP_STRENGTH },
    { key: "priority", label: "Priority", type: "enum", options: PRIORITY },
    { key: "decision_role", label: "Decision role", type: "enum", options: DECISION_ROLE },
    { key: "based_in", label: "Based in", type: "text" },
    { key: "next_action", label: "Next action", type: "text" },
    { key: "next_action_date", label: "Next action date", type: "date" },
    { key: "notes", label: "Add note", type: "textarea" },
  ],
  title: (ctx) => `Update ${contactName(ctx, ctx.subjectUrl)}`,
  extract: async (ctx) => {
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
  title: () => "New opportunity",
  extract: async (ctx) => {
    const v: Record<string, string> = { current_step: "meeting" };
    const money = parseMoney(ctx.text); if (money) v.est_value = String(money);
    try {
      const ex = await aiJson<OppFill>(fillOpportunityPrompt(ctx.text, SERVICE_LINE));
      if (ex.opportunity_name) v.opportunity_name = ex.opportunity_name;
      if (ex.organisation) v.organisation = ex.organisation;
      if (ex.primary_contact) v.primary_contact = ex.primary_contact;
      v.service_line = norm(ex.service_line, SERVICE_LINE) || "Strategy";
      if (!v.est_value && ex.est_value) v.est_value = String(ex.est_value);
      if (ex.description) v.description = ex.description;
    } catch { v.service_line = "Strategy"; }
    return v;
  },
  write: (values, ctx) => {
    const id = `opp:${uuid()}`;
    const step = (norm(values.current_step, STEP_IDS) as OpportunityStep) || "meeting";
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
  kind: "contract",
  label: "Contract",
  needsContact: false,
  fields: [
    { key: "engagement_name", label: "Engagement name", type: "text", required: true },
    { key: "organisation", label: "Organisation", type: "text", required: true },
    { key: "service_line", label: "Service line", type: "enum", options: SERVICE_LINE },
    { key: "status", label: "Status", type: "enum", options: REVENUE_STATUS },
    { key: "signed_date", label: "Signed date", type: "date" },
  ],
  title: () => "New contract / SoW",
  extract: async (ctx) => {
    const v: Record<string, string> = { status: "Active", signed_date: ctx.today };
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
    return { id, summary: `Created the contract “${sow.engagement_name}”.`, undo: () => deleteSow(id) };
  },
};

export const SPECS: Record<ActionKind, EntitySpec> = {
  meeting: meetingSpec,
  contact: contactSpec,
  opportunity: opportunitySpec,
  contract: contractSpec,
};
