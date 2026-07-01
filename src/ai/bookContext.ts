// Assembles the GROUNDING the copilot hands the model for a question: always the book summary
// (aggregates), PLUS a retrieved slice of the ACTUAL records relevant to the question — so it can
// answer record-level questions ("do these companies have active opportunities?"), not just stats.
// Scaled to a character budget (from contextBudget.ts) so a small on-device model gets a focused
// slice and a big model gets everything. Only the user's own local data is used; nothing leaves.

import type { Contact } from "../data/contacts";
import type { MeetingRow } from "../data/meetings";
import type { Opportunity } from "../storage/opportunities";
import type { Sow } from "../storage/revenue";
import { opportunityPhase, opportunityStatus, weightedValue, oppDisplayName } from "../data/opportunities";
import { contractedRevenue } from "../data/revenue";
import { formatMoney } from "../data/format";
import { buildBookSummary } from "./bookSummary";

export type BookData = { contacts: Contact[]; meetingRows: MeetingRow[]; opps: Opportunity[]; sows: Sow[] };

const STOP = new Set(["the", "and", "for", "with", "from", "have", "has", "are", "any", "active", "open", "deal", "deals", "opportunity", "opportunities", "contact", "contacts", "meeting", "meetings", "contract", "contracts", "company", "companies", "about", "that", "they", "them", "their", "what", "which", "who", "does", "did", "his", "her"]);
const tokenize = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// ── Compact one-line serializers (so thousands of records fit a large budget) ──────────────────
function lineContact(c: Contact): string {
  const stage = c.met ? "met" : c.agreed_to_meet ? "agreed to meet" : c.responded ? "replied" : c.messaged ? "messaged" : "not contacted";
  return `${`${c.first} ${c.last}`.trim()} · ${c.position || "—"} · ${c.organisation || "—"}${c.seniority ? ` · ${c.seniority}` : ""} · ${stage}`;
}
function lineOpp(o: Opportunity): string {
  return `${o.organisation || "—"} — ${oppDisplayName(o)} · ${opportunityPhase(o)}/${o.current_step} · ${opportunityStatus(o)} · est ${formatMoney(o.est_value)} (weighted ${formatMoney(weightedValue(o))})${o.primary_contact ? ` · ${o.primary_contact}` : ""}`;
}
function lineMeeting(r: MeetingRow): string {
  const when = r.date_held || r.date_scheduled || r.date_agreed || "—";
  return `${when} · ${r.contactInfo?.name || "—"} · ${r.meeting_stage || "—"}${r.sentiment ? ` · ${r.sentiment}` : ""}${r.purpose ? ` · ${r.purpose.slice(0, 60)}` : ""}`;
}
function lineSow(s: Sow): string {
  return `${s.organisation || "—"} — ${s.engagement_name || "(unnamed)"} · ${s.status} · ${s.service_line} · contracted ${formatMoney(contractedRevenue(s))} · recognised ${formatMoney(s.recognised_to_date)}`;
}

// The set of organisation names known to the book (contacts + opportunities).
function knownOrgs(d: BookData): string[] {
  const set = new Set<string>();
  for (const c of d.contacts) { const o = c.organisation?.trim(); if (o) set.add(o); }
  for (const o of d.opps) { if (o.organisation?.trim()) set.add(o.organisation.trim()); }
  return [...set];
}

// Orgs the question refers to: a significant org token (len≥4, non-stopword) is prefix-matched by a
// question token. Catches "jpmorgan" → "JPMorgan Chase".
function focusOrgs(question: string, orgs: string[]): Set<string> {
  const qTokens = tokenize(question).filter((t) => t.length >= 4 && !STOP.has(t));
  if (!qTokens.length) return new Set();
  const hit = new Set<string>();
  for (const org of orgs) {
    const sig = tokenize(org).filter((t) => t.length >= 4 && !STOP.has(t));
    if (sig.some((st) => qTokens.some((qt) => st.startsWith(qt) || qt.startsWith(st)))) hit.add(org);
  }
  return hit;
}

export function assembleContext(question: string, d: BookData, charBudget: number, today: string): string {
  const parts: string[] = [];
  let used = 0;

  // Add a labelled block, truncating its lines to whatever budget remains (with a "…N more" marker).
  const add = (header: string, lines: string[]) => {
    if (!lines.length || used >= charBudget) return;
    const room = charBudget - used - header.length - 2;
    if (room < 40) return;
    const acc: string[] = [];
    let len = 0;
    for (const ln of lines) {
      if (len + ln.length + 1 > room) break;
      acc.push(ln);
      len += ln.length + 1;
    }
    if (!acc.length) return;
    const tail = acc.length < lines.length ? `\n…(${lines.length - acc.length} more)` : "";
    const block = `\n\n${header}:\n${acc.join("\n")}${tail}`;
    parts.push(block);
    used += block.length;
  };

  const qTokens = tokenize(question);
  const has = (...keys: string[]) => keys.some((k) => qTokens.some((t) => t.startsWith(k)));
  const orgs = focusOrgs(question, knownOrgs(d));

  // 1) If the question names companies, include EVERYTHING about them (most specific → first).
  if (orgs.size) {
    const inOrg = (s?: string) => !!s && orgs.has(s.trim());
    add("Contacts at the companies you mentioned", d.contacts.filter((c) => inOrg(c.organisation)).map(lineContact));
    add("Opportunities at those companies", d.opps.filter((o) => inOrg(o.organisation)).map(lineOpp));
    add("Recent meetings at those companies", d.meetingRows.filter((r) => inOrg(r.contactInfo?.organisation)).map(lineMeeting));
    add("Contracts at those companies", d.sows.filter((s) => inOrg(s.organisation)).map(lineSow));
  }

  // 2) Entity-type slices when the question is about a kind of record (covers anaphora like "do THEY
  //    have opportunities" — the opportunities list lets the model answer per-company).
  if (has("opportunit", "deal", "pipeline", "won", "lost", "proposal", "prospect")) {
    const open = d.opps.filter((o) => opportunityStatus(o) === "Open");
    add("Open opportunities", open.map(lineOpp));
    if (charBudget > 6000) add("Other opportunities (won/lost)", d.opps.filter((o) => opportunityStatus(o) !== "Open").map(lineOpp));
  }
  if (has("meet", "met", "call", "spoke", "saw")) add("Recent meetings", d.meetingRows.slice().sort((a, b) => (b.date_held || b.date_scheduled || "").localeCompare(a.date_held || a.date_scheduled || "")).slice(0, 20).map(lineMeeting));
  if (has("contract", "sow", "engagement", "revenue", "recognis", "signed", "delivery")) add("Contracts / SoWs", d.sows.map(lineSow));
  if (has("contact", "people", "person", "relationship", "champion", "warm", "decision", "senior", "who")) add("Contacts (sample)", d.contacts.slice(0, 40).map(lineContact));

  // 3) Big budget (local/BYOK): fold in the rest so the model effectively has the whole book.
  if (charBudget > 40000) {
    if (!orgs.size && !has("opportunit", "deal", "pipeline")) add("All opportunities", d.opps.map(lineOpp));
    add("All contracts / SoWs", d.sows.map(lineSow));
    add("All contacts", d.contacts.map(lineContact));
  }

  // The aggregate summary is included ONLY for broad/stats/overview questions (or when nothing else was
  // retrieved, so a vague question still has grounding). This is what stops it stat-dumping into every
  // unrelated answer — the model gets the records that matter, not a recital of the whole book.
  const broad = has("summary", "overview", "pipeline", "network", "funnel", "momentum", "progress", "stat", "performance", "doing", "going") || /\b(know about me|how am i|how'?s it going|what do you know|how am i doing|overall)\b/i.test(question) || parts.length === 0;
  if (broad) parts.unshift(buildBookSummary(d.contacts, d.meetingRows, d.opps, d.sows, today));

  return parts.join("");
}
