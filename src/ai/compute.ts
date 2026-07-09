// The deterministic TOOL layer for the copilot. Code owns the DATA (filter / rank / count / date-math /
// look up); the LLM only routes + narrates. Each tool is a pure function over BookData that returns a
// ComputeResult (a clickable table) — the model can't fabricate dates, invent people, or pad rows, and
// it's instant (no model call → matters a lot on WebLLM). `computeForQuery` is the KEYWORD router (the
// fast prior used on every tier); a capable model will later route to these same tools by emitting
// {tool, args}. See memory: freehold-copilot-toolset-design.
//
// Tools: findContacts · findMeetings · findOpportunities · findContracts · rankContacts ·
//        rankOpportunities · pipelineStats · funnelBreakdown · contactBrief · accountSummary · resolveContact
import type { BookData } from "./bookContext";
import type { Contact, WarmthSentiment } from "../data/contacts";
import type { Opportunity } from "../storage/opportunities";
import type { TabId, TabIntent } from "../components/TabNav";
import { buildAgenda } from "../data/agenda";
import { isCommonOrgToken } from "../data/orgTokens";
import { oppDisplayName } from "../data/opportunities";
import { matchSector, matchFunction } from "../data/criteria";

export type ComputeRecord = { tab: "meetings" | "contacts" | "opportunities" | "revenue"; id: string };
export type ComputeRow = { cells: string[]; record?: ComputeRecord };
// `more`: when a list is capped, a "view all N in <tab>" jump to the full filtered view (no silent truncation).
export type ComputeResult = { intro: string; columns: string[]; rows: ComputeRow[]; more?: { count: number; tab: TabId; intent: TabIntent }; enrich?: { kind: "company"; name: string } };

// ── shared helpers ──────────────────────────────────────────────────────────────────────────────
function addDays(iso: string, n: number): string { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function windowDays(t: string): { days: number; label: string } {
  let m = t.match(/\b(\d+)\s*days?\b/); if (m) return { days: +m[1], label: `${m[1]} days` };
  m = t.match(/\b(\d+)\s*weeks?\b/); if (m) return { days: +m[1] * 7, label: `${m[1]} weeks` };
  if (/\b(two weeks|fortnight|2 weeks)\b/.test(t)) return { days: 14, label: "two weeks" };
  if (/\bmonth\b/.test(t)) return { days: 30, label: "month" };
  if (/\bweek\b/.test(t)) return { days: 7, label: "week" };
  if (/\bquarter\b/.test(t)) return { days: 90, label: "quarter" };
  return { days: 14, label: "two weeks" };
}
const fullName = (c: Contact) => `${c.first} ${c.last}`.trim();
function stageLabel(c: Contact): string {
  if (c.met) return "Met"; if (c.agreed_to_meet) return "Agreed to meet"; if (c.two_way) return "Two-way contact";
  if (c.responded) return "Replied"; if (c.messaged) return "Messaged"; return "Not contacted";
}
function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z")) / 86_400_000);
}
// Most recent HELD meeting per contact (date + sentiment) — feeds recency/sentiment into warmth + cold.
function lastMeetingMap(d: BookData): Map<string, { date: string; sentiment: string }> {
  const m = new Map<string, { date: string; sentiment: string }>();
  for (const r of d.meetingRows) {
    if (r.meeting_stage !== "Held" || !r.date_held) continue;
    const prev = m.get(r.contact_url);
    if (!prev || r.date_held > prev.date) m.set(r.contact_url, { date: r.date_held, sentiment: r.sentiment || "" });
  }
  return m;
}
const upcomingMeetingSet = (d: BookData, today: string) => new Set(d.meetingRows.filter((m) => m.meeting_stage === "Scheduled" && (m.date_scheduled || "") >= today).map((m) => m.contact_url));
// WARMTH = funnel depth + recency of last meeting + its sentiment + how warm the contact's OWN MESSAGES were.
// The message-sentiment term is the truest signal (funnel stage only says they *agreed*, not how keen) and is
// weighted to actually reorder a tied cohort: score 0–10 maps to −2.5…+2.5, centred on neutral (5) = 0. It's
// precomputed (ai/sentiment.ts) and absent until the pass has run, so warmth degrades gracefully to the old
// funnel+meeting definition. Owner-set, not a hard rule — kept transparent in the answer's intro.
function warmth(c: Contact, lm: Map<string, { date: string; sentiment: string }>, today: string): number {
  let s = c.met ? 4 : c.agreed_to_meet ? 3 : c.two_way ? 2 : c.responded ? 1 : c.messaged ? 0.5 : 0;
  const last = lm.get(c.url);
  if (last) {
    const days = daysBetween(last.date, today);
    if (days <= 30) s += 1.5; else if (days <= 90) s += 0.5;
    if (/very positive/i.test(last.sentiment)) s += 1.5; else if (/positive/i.test(last.sentiment)) s += 0.75; else if (/cautious|negative/i.test(last.sentiment)) s -= 0.5;
  }
  const ms = c.warmthSentiment?.score;
  if (typeof ms === "number" && Number.isFinite(ms)) s += ((Math.max(0, Math.min(10, ms)) - 5) / 5) * 2.5;
  // Responsiveness (deterministic, from the thread): a real back-and-forth where they reply is a small warmth
  // signal; a one-sided thread (you sent lots, they barely replied) is a small negative. Graceful (no thread → 0).
  const t = c.thread;
  if (t && (t.inboundCount || t.outboundCount)) {
    if (t.inboundCount >= 2 && t.inboundCount >= t.outboundCount) s += 0.5;      // reciprocates / engaged
    else if (t.outboundCount >= 3 && t.inboundCount <= 1) s -= 0.5;              // you're doing all the reaching
  }
  return s;
}
// The five warmth levels (warmest → coldest) — used for the display label AND the Contacts filter dropdown,
// so they can't drift. Bucketed from the 0–10 score (not the model's free-text label) so it's always one of
// these exact five and the filter matches the cell.
export const WARMTH_LEVELS = ["Keen", "Warm", "Neutral", "Cool", "Cold"] as const;
export function warmthLabel(w?: WarmthSentiment): string {
  if (!w || typeof w.score !== "number") return "";
  const s = w.score;
  return s >= 8 ? "Keen" : s >= 6 ? "Warm" : s >= 4 ? "Neutral" : s >= 2 ? "Cool" : "Cold";
}
// A compact cell for tables: "Keen · 9/10", or "—" when this contact hasn't been scored yet.
export function warmthCell(c: Contact): string {
  const w = c.warmthSentiment;
  return w && typeof w.score === "number" ? `${warmthLabel(w)} · ${Math.round(w.score)}/10` : "—";
}
// The DRY relationship-signal block that feeds the generative features (drafts, briefs, account summary,
// Your Day). Assembles ONLY the signals present on this contact — warmth, who-owes-a-reply, a latent
// opportunity, their last message — so it degrades gracefully to "" when no scan has run + no thread data.
export function contactSignalsText(c: Contact): string {
  const parts: string[] = [];
  const w = c.warmthSentiment;
  if (w && typeof w.score === "number") parts.push(`Relationship warmth (from their message tone): ${warmthLabel(w)} — ${Math.round(w.score)}/10`);
  const t = c.thread;
  if (t) {
    if (!t.lastFromOwner && t.inboundCount > 0) parts.push(`You OWE them a reply — they messaged last${t.lastDate ? ` on ${t.lastDate}` : ""}`);
    else if (t.lastFromOwner) parts.push(`You messaged last${t.lastDate ? ` on ${t.lastDate}` : ""}; waiting on them`);
  }
  if (c.latentOpp?.text) parts.push(`Possible opportunity spotted in their messages: ${c.latentOpp.text}`);
  const lastIn = c.inbound?.length ? c.inbound[c.inbound.length - 1].text.trim() : "";
  if (lastIn) parts.push(`The last thing they wrote to you: "${lastIn.slice(0, 240)}"`);
  return parts.length ? parts.join(".\n") + "." : "";
}
// £-prefixed (a UK consulting book) and CONSISTENT everywhere — the deterministic tables set the currency
// so the model never introduces a stray "$" (the polish run had it saying "$800k" next to the tools' "800k").
function money(n?: number): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}m`;
  if (n >= 1000) return `£${Math.round(n / 1000)}k`;
  return `£${n}`;
}
// Opportunity status/weighting — inlined (keeps this module node-importable for the QA harness).
const STEP_ORDER = ["meeting", "qualify", "pursuit", "scoping", "clearance", "proposal_build", "proposal_delivery", "procurement", "contracting", "setup", "delivery", "revenue"];
const WON_AT = STEP_ORDER.indexOf("contracting");
function oppStatus(o: Opportunity): "Open" | "Won" | "Lost" { if (o.lost) return "Lost"; return STEP_ORDER.indexOf(o.current_step) >= WON_AT ? "Won" : "Open"; }
function oppWeighted(o: Opportunity): number { return (o.est_value ?? 0) * (o.probability ?? 0); }
const stepLabel = (id: string) => id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
// Loose company match: an org "contains" the query as a word-ish substring (case-insensitive).
function orgMatches(org: string | undefined, q: string): boolean {
  if (!org) return false;
  const o = org.toLowerCase(), s = q.trim().toLowerCase();
  if (!s) return false;
  // The query is (part of) the org name — the user named it (e.g. "JPMorgan" → "JPMorgan Chase").
  if (o.includes(s)) return true;
  // The org name appears INSIDE a longer query. Only trust this for a DISTINCTIVE org — a multi-word name,
  // or a single token ≥5 chars that isn't a common word — and only as a whole word. Else "Next"/"Open"
  // match ordinary phrases ("my NEXT priority", "OPEN deals") and a whole clause is mistaken for a company.
  const oToks = o.split(/[^a-z0-9]+/).filter(Boolean);
  const distinctive = oToks.length > 1 || (!!oToks[0] && oToks[0].length >= 5 && !isCommonOrgToken(oToks[0]));
  if (distinctive) {
    const esc = o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`).test(s)) return true;
  }
  // Spacing/punctuation-tolerant ("JP Morgan" ↔ "JPMorgan Chase"), but only when the query is a deliberate,
  // compact org reference — NOT a long phrase that merely happens to contain the squished letters.
  const sq = s.replace(/[^a-z0-9]/g, ""), oq = o.replace(/[^a-z0-9]/g, "");
  return sq.length >= 4 && sq.length <= oq.length + 4 && oq.includes(sq);
}

// ── TOOLS ───────────────────────────────────────────────────────────────────────────────────────

// 1. findContacts — filter the network. `filter`: company, stage (funnel), decisionRole, notContactedNote.
export type ContactFilter = { company?: string; stage?: "messaged" | "responded" | "two_way" | "agreed_to_meet" | "met" | "agreed_not_met" | "not_responded"; decisionRole?: boolean };
export function findContacts(d: BookData, filter: ContactFilter): ComputeResult {
  let list = d.contacts;
  let what = "contacts";
  if (filter.company) { list = list.filter((c) => orgMatches(c.organisation, filter.company!)); what = `contacts at ${filter.company}`; }
  if (filter.stage === "agreed_not_met") { list = list.filter((c) => c.agreed_to_meet && !c.met); what = "people you've agreed to meet but not met"; }
  else if (filter.stage === "not_responded") { list = list.filter((c) => c.messaged && !c.responded); what = "people who haven't responded"; }
  else if (filter.stage === "met") { list = list.filter((c) => c.met); what = "people you've met"; }
  else if (filter.stage) { list = list.filter((c) => (c as unknown as Record<string, boolean>)[filter.stage!]); what = `${filter.stage} contacts`; }
  if (filter.decisionRole) { list = list.filter((c) => /decision/i.test(c.position || "") || /chief|ceo|cfo|coo|cto|head of|director|vp|vice president|partner/i.test(c.position || "")); what = "senior / decision-maker " + what; }
  const total = list.length;
  if (!total) return { intro: `Hmm, nothing matched — no ${what} in your book right now.`, columns: [], rows: [] };
  const shown = list.slice(0, 40);
  const res: ComputeResult = {
    intro: `${total} ${what}${total > shown.length ? ` (showing ${shown.length})` : ""}:`,
    columns: ["Name", "Role", "Company", "Stage"],
    rows: shown.map((c) => ({ cells: [fullName(c), c.position || "—", c.organisation || "—", stageLabel(c)], record: { tab: "contacts", id: c.url } })),
  };
  if (total > shown.length) res.more = { count: total, ...contactsNav(filter) };
  return res;
}
// Where a contacts list lives in full (for the "view all" jump) — mirrors the funnel filter used above.
function contactsNav(filter: ContactFilter): { tab: TabId; intent: TabIntent } {
  if (filter.stage === "agreed_not_met") return { tab: "contacts", intent: { filters: [{ key: "agreed", value: "Yes" }, { key: "met", value: "No" }] } };
  if (filter.stage === "not_responded") return { tab: "contacts", intent: { filter: { key: "responded", value: "No" } } };
  if (filter.stage === "met") return { tab: "contacts", intent: { filter: { key: "met", value: "Yes" } } };
  if (filter.company) return { tab: "contacts", intent: { search: filter.company } };
  return { tab: "contacts", intent: {} };
}

// 2. findMeetings — by date window + status.
export function findMeetings(d: BookData, today: string, t: string): ComputeResult {
  const { days, label } = windowDays(t);
  const cutoff = addDays(today, -days);
  const upcoming = /\bupcoming|scheduled|coming up|next\b/.test(t);
  const rows = d.meetingRows
    .filter((m) => upcoming ? (m.meeting_stage === "Scheduled" && (m.date_scheduled || "") >= today) : (m.meeting_stage === "Held" && m.date_held && m.date_held >= cutoff && m.date_held <= today))
    .sort((a, b) => upcoming ? (a.date_scheduled || "").localeCompare(b.date_scheduled || "") : (b.date_held || "").localeCompare(a.date_held || ""));
  if (!rows.length) {
    if (upcoming) return { intro: "You've got no upcoming meetings scheduled.", columns: [], rows: [] };
    const last = d.meetingRows.filter((m) => m.meeting_stage === "Held" && m.date_held).sort((a, b) => (b.date_held || "").localeCompare(a.date_held || ""))[0];
    return { intro: `You've got no meetings held in the last ${label}.${last ? ` Your most recent was on ${last.date_held} with ${last.contactInfo.name}.` : ""}`, columns: [], rows: [] };
  }
  return {
    intro: upcoming ? `Your upcoming meetings (${rows.length}):` : `Meetings you held in the last ${label} (${rows.length}):`,
    columns: ["Date", "Contact", "Company", upcoming ? "Stage" : "Sentiment"],
    rows: rows.map((m) => ({ cells: [(upcoming ? m.date_scheduled : m.date_held) || "—", m.contactInfo.name, m.contactInfo.organisation || "—", upcoming ? m.meeting_stage : (m.sentiment || "—")], record: { tab: "meetings", id: m.id } })),
  };
}

// 3. findOpportunities — by status / value / company.
export type OppFilter = { status?: "Open" | "Won" | "Lost"; company?: string; minValue?: number };
export function findOpportunities(d: BookData, filter: OppFilter): ComputeResult {
  let list = d.opps.slice();
  let what = "opportunities";
  if (filter.status) { list = list.filter((o) => oppStatus(o) === filter.status); what = `${filter.status.toLowerCase()} opportunities`; }
  if (filter.company) { list = list.filter((o) => orgMatches(o.organisation, filter.company!)); what += ` at ${filter.company}`; }
  if (filter.minValue) { list = list.filter((o) => (o.est_value ?? 0) >= filter.minValue!); what += ` over ${money(filter.minValue)}`; }
  list = list.sort((a, b) => oppWeighted(b) - oppWeighted(a));
  const n = list.length;
  if (!n) return { intro: `No ${what}.`, columns: [], rows: [] };
  const shown = list.slice(0, 30);
  const totalVal = list.reduce((s, o) => s + (o.est_value ?? 0), 0);
  const res: ComputeResult = {
    intro: `${n} ${what}${n > shown.length ? ` (showing ${shown.length})` : ""} — total est. value ${money(totalVal)}:`,
    columns: ["Opportunity", "Company", "Stage", "Est. value"],
    rows: shown.map((o) => ({ cells: [oppDisplayName(o), o.organisation || "—", stepLabel(o.current_step), money(o.est_value)], record: { tab: "opportunities", id: o.id } })),
  };
  if (n > shown.length) res.more = { count: n, tab: "opportunities", intent: {} };
  return res;
}

// 4. findContracts — SoWs (engagements) by status / company, optionally RANKED by value (deterministic —
// the model must never pick "highest value" itself; it got 91k > 510k wrong on a small model).
const sowValue = (s: { recognised_to_date?: number }) => s.recognised_to_date ?? 0;
export function findContracts(d: BookData, filter: { status?: string; company?: string; byValue?: boolean }): ComputeResult {
  let list = d.sows.slice();
  if (filter.status) list = list.filter((s) => (s.status || "").toLowerCase() === filter.status!.toLowerCase());
  if (filter.company) list = list.filter((s) => orgMatches(s.organisation, filter.company!));
  if (filter.byValue) list = list.sort((a, b) => sowValue(b) - sowValue(a));
  const n = list.length;
  if (!n) return { intro: "No engagements match that.", columns: [], rows: [] };
  const shown = list.slice(0, 30);
  const res: ComputeResult = {
    intro: filter.byValue
      ? `Your engagements by value (highest first)${n > shown.length ? ` — top ${shown.length} of ${n}` : ` (${n})`}:`
      : `${n} engagement${n === 1 ? "" : "s"}${n > shown.length ? ` (showing ${shown.length})` : ""}:`,
    columns: ["Engagement", "Company", "Status", "Recognised"],
    rows: shown.map((s) => ({ cells: [s.engagement_name || "(unnamed)", s.organisation || "—", s.status || "—", money(s.recognised_to_date)], record: { tab: "revenue", id: s.id } })),
  };
  if (n > shown.length) res.more = { count: n, tab: "revenue", intent: {} };
  return res;
}

// 5. rankContacts — warmth | cold.
export function rankContacts(d: BookData, by: "warmth" | "cold", today: string): ComputeResult {
  const lm = lastMeetingMap(d);
  if (by === "cold") {
    // "Gone cold" = was warm, now quiet. Two ways in: (A) replied / two-way but never progressed to a
    // meeting; (B) you met them but the last meeting was 45+ days ago with no upcoming one booked.
    const upcoming = upcomingMeetingSet(d, today);
    const seen = new Set<string>();
    const cold = d.contacts.filter((c) => {
      if (seen.has(c.url)) return false;
      const stalledEarly = (c.responded || c.two_way) && !c.met && !c.agreed_to_meet;
      const last = lm.get(c.url);
      const quietAfterMeeting = c.met && last && daysBetween(last.date, today) > 45 && !upcoming.has(c.url);
      if (stalledEarly || quietAfterMeeting) { seen.add(c.url); return true; }
      return false;
    }).sort((a, b) => warmth(b, lm, today) - warmth(a, lm, today)).slice(0, 10);
    if (!cold.length) return { intro: "Good news — no one's gone cold right now: everyone who engaged is either progressing or recently in touch.", columns: [], rows: [] };
    return { intro: `Worth re-engaging — they were warm but have gone quiet (replied with no meeting, or met 45+ days ago with nothing booked) (${cold.length}):`, columns: ["Name", "Role", "Company"], rows: cold.map((c) => ({ cells: [fullName(c), c.position || "—", c.organisation || "—"], record: { tab: "contacts", id: c.url } })) };
  }
  const ranked = d.contacts.map((c) => ({ c, s: warmth(c, lm, today) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 8);
  if (!ranked.length) return { intro: "I can't see anyone with engagement logged yet — once you've messaged or met people, they'll rank here.", columns: [], rows: [] };
  const anyScored = ranked.some(({ c }) => c.warmthSentiment);
  // Once the sentiment pass has run, show the model's WARMTH read so you can see WHY each lead ranks here —
  // not just the funnel stage. Before any scoring, keep the original stage-only table.
  if (anyScored) {
    return { intro: "Your warmest leads right now — ranked by engagement and the tone of their messages:", columns: ["Name", "Company", "Role", "Warmth"], rows: ranked.map(({ c }) => ({ cells: [fullName(c), c.organisation || "—", c.position || "—", warmthCell(c)], record: { tab: "contacts", id: c.url } })) };
  }
  return { intro: "Your warmest leads right now — ranked by engagement, plus how recent and positive your last meeting was:", columns: ["Name", "Company", "Role", "Engagement"], rows: ranked.map(({ c }) => ({ cells: [fullName(c), c.organisation || "—", c.position || "—", stageLabel(c)], record: { tab: "contacts", id: c.url } })) };
}

// 6. rankOpportunities — value | probability | risk(stale early-stage).
export function rankOpportunities(d: BookData, by: "value" | "probability" | "risk"): ComputeResult {
  const open = d.opps.filter((o) => oppStatus(o) === "Open");
  if (!open.length) return { intro: "You've no open opportunities right now. Want to see your won deals, or which contacts you've met but haven't turned into a deal yet?", columns: [], rows: [] };
  let list = open, intro = "", lastCol = "Est. value";
  if (by === "probability") { list = open.slice().sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0)).slice(0, 10); intro = "Your open opportunities most likely to close (highest probability first):"; lastCol = "Probability"; }
  else if (by === "risk") {
    // Risk = big + early-stage, PLUS momentum: the linked contact has gone quiet (you messaged last, no reply).
    // Graceful — with no thread data it's just the early-stage view as before.
    const byUrl = new Map(d.contacts.map((c) => [c.url, c]));
    const quiet = (o: Opportunity) => { const c = o.contact_url ? byUrl.get(o.contact_url) : undefined; return !!(c?.thread && c.thread.lastFromOwner && c.thread.inboundCount > 0); };
    list = open
      .filter((o) => STEP_ORDER.indexOf(o.current_step) <= STEP_ORDER.indexOf("scoping") || quiet(o))
      .sort((a, b) => (Number(quiet(b)) - Number(quiet(a))) || (b.est_value ?? 0) - (a.est_value ?? 0))
      .slice(0, 10);
    intro = "At risk of stalling — big early-stage deals, and any where the contact's gone quiet on you:";
  }
  else { list = open.slice().sort((a, b) => (b.est_value ?? 0) - (a.est_value ?? 0)).slice(0, 10); intro = "Your biggest open opportunities by value:"; }
  // Only reachable for `by:"risk"` (value/probability slice the full open set). An empty risk list is GOOD
  // news, not a dead end — offer a next look rather than a bare "nothing matches".
  if (!list.length) return { intro: "Good news — nothing's obviously stalling (no big early-stage deals sitting quiet on you). Want your biggest deals by value, or the ones closest to closing?", columns: [], rows: [] };
  return {
    intro,
    columns: ["Opportunity", "Company", "Stage", lastCol],
    rows: list.map((o) => ({ cells: [oppDisplayName(o), o.organisation || "—", stepLabel(o.current_step), by === "probability" ? `${Math.round((o.probability ?? 0) * 100)}%` : money(o.est_value)], record: { tab: "opportunities", id: o.id } })),
  };
}

// 7. pipelineStats — the headline numbers (deterministic).
export function pipelineStats(d: BookData): ComputeResult {
  const open = d.opps.filter((o) => oppStatus(o) === "Open");
  const won = d.opps.filter((o) => oppStatus(o) === "Won");
  const lost = d.opps.filter((o) => oppStatus(o) === "Lost");
  const openVal = open.reduce((s, o) => s + (o.est_value ?? 0), 0);
  const weighted = open.reduce((s, o) => s + oppWeighted(o), 0);
  const winRate = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null;
  return {
    intro: "Your pipeline at a glance:",
    columns: ["Metric", "Value"],
    rows: [
      { cells: ["Open opportunities", String(open.length)] },
      { cells: ["Open value (unweighted)", money(openVal)] },
      { cells: ["Weighted pipeline", money(weighted)] },
      { cells: ["Won", String(won.length)] },
      { cells: ["Lost", String(lost.length)] },
      { cells: ["Win rate", winRate == null ? "—" : `${winRate}%`] },
      { cells: ["Contacts in network", String(d.contacts.length)] },
    ],
  };
}

// 7b. pipelineAggregate — averages / weighted / totals / the raw-vs-weighted gap, COMPUTED (never the model:
// a 70B lost the whole dataset here and answered from "the single opportunity in your book"). All figures are
// derived from the same open-opportunity set as pipelineStats, so the numbers can't drift between answers.
export type PipelineMetric = "total" | "weighted" | "average" | "gap";
// The `metric` param (tool path) is authoritative; when absent (regex path) it's parsed from the text. Oblique
// phrasings map here: "banking / at the odds / realistically" → weighted, "typically / per deal" → average,
// "wishful thinking / raw vs weighted" → gap, else total.
export function pipelineAggregate(d: BookData, t: string, metric?: PipelineMetric): ComputeResult | null {
  const open = d.opps.filter((o) => oppStatus(o) === "Open");
  if (!open.length) return { intro: "You've no open opportunities to total up right now.", columns: [], rows: [] };
  const total = open.reduce((s, o) => s + (o.est_value ?? 0), 0);
  const weighted = open.reduce((s, o) => s + oppWeighted(o), 0);
  const avg = total / open.length, avgW = weighted / open.length, n = open.length;
  const oppW = n === 1 ? "opportunity" : "opportunities"; // never "1 opportunities"
  const dealW = n === 1 ? "deal" : "deals";
  const m: PipelineMetric = metric ?? (
    /\bgap\b|\bdifference\b|\bversus\b|\bvs\b|raw (?:and|vs|versus|to) weighted|weighted (?:and|vs|versus|to) raw/.test(t) ? "gap"
    : /\b(average|avg|mean|median|typical\w*|per (?:deal|opportunity)|each|apiece)\b/.test(t) ? "average"
    : /\bweight|\bat the odds\b|\brealistic\w*|\brisk[- ]?adjusted\b|\bexpected value\b|\blikely to (?:close|land)\b|\bactually banking\b/.test(t) ? "weighted"
    : "total"
  );
  if (m === "gap")
    return { intro: `Across your ${n} open ${oppW}: raw total ${money(total)}, probability-weighted ${money(weighted)} — a gap of ${money(total - weighted)}. That gap is value you're counting at full price that isn't probability-adjusted yet.`, columns: [], rows: [] };
  if (m === "average")
    return /\bweight/.test(t)
      ? { intro: `Your average probability-weighted open deal is ${money(avgW)} — weighted pipeline ${money(weighted)} across ${n} open ${oppW}.`, columns: [], rows: [] }
      : { intro: `Your average open opportunity is ${money(avg)} (${money(total)} across ${n} open ${dealW}). Probability-weighted, the average is ${money(avgW)}.`, columns: [], rows: [] };
  if (m === "weighted")
    return { intro: `Your probability-weighted open pipeline is ${money(weighted)} across ${n} open ${oppW} (raw/unweighted: ${money(total)}).`, columns: [], rows: [] };
  return { intro: `Your open pipeline totals ${money(total)} across ${n} ${oppW} (probability-weighted: ${money(weighted)}).`, columns: [], rows: [] };
}

// 5b. contractsAggregate — recognised-revenue MATHS over engagements (total / count / average per
// engagement / the largest). Computed, never the model: a 70B answered "$323k" for a max that wasn't in
// the data, and the keyword layer used to just re-list all 30 engagements when asked for the average.
export type RevenueMetric = "total" | "average" | "largest";
// `metric` (tool path) is authoritative; else parsed from text. "made money / earned / brought in" → total,
// "per engagement / typically" → average, "fattest / biggest engagement" → the single largest (focused).
export function contractsAggregate(d: BookData, t: string, metric?: RevenueMetric): ComputeResult {
  const sows = d.sows;
  if (!sows.length) return { intro: "You've no engagements logged yet, so there's no recognised revenue to total up.", columns: [], rows: [] };
  const total = sows.reduce((s, x) => s + (x.recognised_to_date ?? 0), 0);
  const n = sows.length;
  const avg = Math.round(total / n);
  const top = sows.slice().sort((a, b) => (b.recognised_to_date ?? 0) - (a.recognised_to_date ?? 0))[0];
  const topWhere = `${top.engagement_name || "an engagement"}${top.organisation ? ` at ${top.organisation}` : ""} (${money(top.recognised_to_date)})`;
  const engW = n === 1 ? "engagement" : "engagements";
  const m: RevenueMetric = metric ?? (
    /\b(largest|biggest|fattest|chunkiest|highest[- ]?value|most valuable|top|single biggest)\b/.test(t) ? "largest"
    : /\b(average|avg|mean|per engagement|typical\w*|each|apiece)\b/.test(t) ? "average"
    : "total"
  );
  if (m === "largest")
    return { intro: `Your fattest engagement is ${topWhere} — the largest of ${n} ${engW} totalling ${money(total)} recognised.`, columns: [], rows: [] };
  const intro = m === "average"
    ? `Across your ${n} ${engW} you've recognised ${money(total)} in total — an average of ${money(avg)} per engagement. The largest is ${topWhere}.`
    : `You've recognised ${money(total)} in revenue across ${n} ${engW} (that's ${money(avg)} each on average). Your largest is ${topWhere}.`;
  return { intro, columns: [], rows: [] };
}

// 6c. contactsMetAtLeast — count-THRESHOLD over held meetings ("met more than once", "three or more times").
// Counts HELD meetings per contact. The keyword layer used to read "met more than once" as the plain "met"
// filter and return everyone you'd met even once — the classic off-by-threshold error.
export function contactsMetAtLeast(d: BookData, min: number): ComputeResult {
  const count = new Map<string, number>();
  for (const m of d.meetingRows) if (m.meeting_stage === "Held" && m.contact_url) count.set(m.contact_url, (count.get(m.contact_url) || 0) + 1);
  const list = d.contacts.filter((c) => (count.get(c.url) || 0) >= min).sort((a, b) => (count.get(b.url) || 0) - (count.get(a.url) || 0));
  const label = min === 2 ? "more than once" : `at least ${min} times`;
  if (!list.length) return { intro: `No one you've met ${label} — so far every contact you've met, you've met just the once.`, columns: [], rows: [] };
  const shown = list.slice(0, 40);
  const res: ComputeResult = {
    intro: `People you've met ${label} (${list.length}):`,
    columns: ["Name", "Role", "Company", "Times met"],
    rows: shown.map((c) => ({ cells: [fullName(c), c.position || "—", c.organisation || "—", String(count.get(c.url) || 0)], record: { tab: "contacts", id: c.url } })),
  };
  if (list.length > shown.length) res.more = { count: list.length, tab: "contacts", intent: { filter: { key: "met", value: "Yes" } } };
  return res;
}

// 6d. openOppsWithoutMeeting — ANTI-JOIN: open opportunities with NO meeting ever held against them (by
// primary contact or anyone at the org). A real "what's slipping" question the keyword layer used to
// mangle — it grabbed "…at all" as a company name and returned a bogus empty table.
export function openOppsWithoutMeeting(d: BookData): ComputeResult {
  const open = d.opps.filter((o) => oppStatus(o) === "Open");
  if (!open.length) return { intro: "You've no open opportunities right now, so nothing's sitting without a meeting.", columns: [], rows: [] };
  const held = d.meetingRows.filter((m) => m.meeting_stage === "Held");
  const hasMeeting = (o: Opportunity) => held.some((m) => (o.contact_url && m.contact_url === o.contact_url) || (!!o.organisation && orgMatches(m.contactInfo.organisation, o.organisation)));
  const naked = open.filter((o) => !hasMeeting(o)).sort((a, b) => (b.est_value ?? 0) - (a.est_value ?? 0));
  if (!naked.length) return { intro: "Good news — every open opportunity has at least one meeting logged against it.", columns: [], rows: [] };
  const shown = naked.slice(0, 30);
  const res: ComputeResult = {
    intro: `Open opportunities with no meeting logged against them yet — worth booking one before they stall (${naked.length}):`,
    columns: ["Opportunity", "Company", "Stage", "Est. value"],
    rows: shown.map((o) => ({ cells: [oppDisplayName(o), o.organisation || "—", stepLabel(o.current_step), money(o.est_value)], record: { tab: "opportunities", id: o.id } })),
  };
  if (naked.length > shown.length) res.more = { count: naked.length, tab: "opportunities", intent: {} };
  return res;
}

// 6d-ii. meetingsWithoutOpp — the REVERSE anti-join: contacts you've HELD a meeting with but logged NO
// opportunity for (by contact or org). "Which meetings haven't turned into a deal yet" — the follow-up gap
// the pipeline forgets. Deduped to the latest held meeting per contact. Mirrors openOppsWithoutMeeting.
export function meetingsWithoutOpp(d: BookData): ComputeResult {
  const held = d.meetingRows.filter((m) => m.meeting_stage === "Held" && m.date_held);
  if (!held.length) return { intro: "You've no held meetings logged yet.", columns: [], rows: [] };
  const hasOpp = (m: (typeof held)[number]) =>
    d.opps.some((o) => (m.contact_url && o.contact_url === m.contact_url) || (!!m.contactInfo.organisation && orgMatches(o.organisation, m.contactInfo.organisation)));
  const byContact = new Map<string, (typeof held)[number]>();
  for (const m of held) {
    if (hasOpp(m)) continue;
    const key = m.contact_url || m.contactInfo.name;
    const cur = byContact.get(key);
    if (!cur || (m.date_held || "") > (cur.date_held || "")) byContact.set(key, m);
  }
  const naked = [...byContact.values()].sort((a, b) => (b.date_held || "").localeCompare(a.date_held || ""));
  if (!naked.length) return { intro: "Every contact you've met has an opportunity logged against them — nothing's slipping through.", columns: [], rows: [] };
  const shown = naked.slice(0, 30);
  const res: ComputeResult = {
    intro: `Contacts you've met but logged NO opportunity for yet — worth deciding if there's a deal there (${naked.length}):`,
    columns: ["Last met", "Contact", "Company", "Sentiment"],
    rows: shown.map((m) => ({ cells: [m.date_held || "—", m.contactInfo.name, m.contactInfo.organisation || "—", m.sentiment || "—"], record: { tab: "meetings", id: m.id } })),
  };
  if (naked.length > shown.length) res.more = { count: naked.length, tab: "meetings", intent: {} };
  return res;
}

// 6e. companiesWithOppAndContacts — JOIN+count: organisations where you have BOTH an open opportunity AND
// ≥ min contacts. A genuine intersection (the model muddled it free-hand; the keyword layer couldn't
// express it and mis-extracted "…at least two contacts" as a company). These are your expansion footholds.
export function companiesWithOppAndContacts(d: BookData, min = 2): ComputeResult {
  const norm = (s?: string) => (s || "").trim().toLowerCase();
  const byOrg = new Map<string, { org: string; contacts: number }>();
  for (const c of d.contacts) { const k = norm(c.organisation); if (!k) continue; const e = byOrg.get(k) || { org: (c.organisation || "").trim(), contacts: 0 }; e.contacts++; byOrg.set(k, e); }
  const openOpps = new Map<string, number>();
  for (const o of d.opps) if (oppStatus(o) === "Open") { const k = norm(o.organisation); if (k) openOpps.set(k, (openOpps.get(k) || 0) + 1); }
  const rows = [...openOpps.entries()]
    .map(([k, opps]) => ({ e: byOrg.get(k), opps }))
    .filter((x) => x.e && x.e.contacts >= min)
    .sort((a, b) => b.e!.contacts - a.e!.contacts)
    .slice(0, 30);
  if (!rows.length) return { intro: `No companies where you have both an open opportunity and at least ${min} contacts right now.`, columns: [], rows: [] };
  return {
    intro: `Companies where you have both an open opportunity and ${min}+ contacts — your strongest expansion footholds (${rows.length}):`,
    columns: ["Company", "Contacts", "Open opps"],
    rows: rows.map((x) => ({ cells: [x.e!.org, String(x.e!.contacts), String(x.opps)] })),
  };
}

// Weekly focus / priorities — the deterministic answer to "what should I focus on this week?". Reuses the
// same agenda the dashboard shows (overdue + due-soon write-ups, follow-ups, scheduled meetings, opportunity
// + contract next-steps). Instant, accurate, and crucially NEVER hits the model — an advisory question like
// this would otherwise inject the whole summary and stall a small on-device model on a long prefill.
// From the enrichment/thread signals (graceful — 0 when nothing's scored): replies owed + latent opps.
function attentionLine(d: BookData): string {
  const owed = d.contacts.filter((c) => c.thread && !c.thread.lastFromOwner && c.thread.inboundCount > 0).length;
  const latent = d.contacts.filter((c) => c.latentOpp?.text).length;
  const bits: string[] = [];
  if (owed) bits.push(`${owed} repl${owed === 1 ? "y" : "ies"} you owe`);
  if (latent) bits.push(`${latent} opportunit${latent === 1 ? "y" : "ies"} spotted in your messages`);
  return bits.length ? `Also worth a look: ${bits.join(" · ")} — ask me about either.` : "";
}
// Message-derived agenda signal for a FRESH import: on day one there are almost no logged meetings or dated
// next-actions, so the pure due-date agenda is nearly empty and the copilot looks blind to a 26k book. Backfill
// with what a partner would actually chase first — replies the user owes (the other side messaged last) and
// their warmest un-met leads. Returns [] once the book has real dated activity (weeklyFocus only calls it then).
function freshSignals(d: BookData, today: string): ComputeRow[] {
  const lm = lastMeetingMap(d);
  const w = (c: typeof d.contacts[number]) => warmth(c, lm, today);
  const owed = d.contacts
    .filter((c) => c.thread && !c.thread.lastFromOwner)
    .sort((a, b) => w(b) - w(a))
    .slice(0, 5);
  const owedUrls = new Set(owed.map((c) => c.url));
  const warm = d.contacts
    .filter((c) => !owedUrls.has(c.url) && !c.met && w(c) > 0)
    .sort((a, b) => w(b) - w(a))
    .slice(0, 5);
  const rows: ComputeRow[] = [];
  for (const c of owed) rows.push({ cells: ["reply owed", `Reply to ${fullName(c)}${c.thread?.lastDate ? ` — they messaged ${c.thread.lastDate}` : ""}`, c.organisation || "—"], record: { tab: "contacts", id: c.url } });
  for (const c of warm) rows.push({ cells: ["warm lead", `Advance ${fullName(c)}`, c.organisation || "—"], record: { tab: "contacts", id: c.url } });
  return rows.slice(0, 8);
}
export function weeklyFocus(d: BookData, today: string): ComputeResult {
  const attn = attentionLine(d);
  const items = buildAgenda(d.meetingRows, d.opps, today, d.sows)
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.daysUntil - b.daysUntil);
  const when = (it: typeof items[number]) => it.overdue ? `${Math.abs(it.daysUntil)}d overdue` : it.daysUntil === 0 ? "today" : `in ${it.daysUntil}d`;
  const top = items.slice(0, 12);
  const agendaRows: ComputeRow[] = top.map((it) => ({ cells: [when(it), it.statusLabel, `${it.who}${it.org ? ` · ${it.org}` : ""}`], record: { tab: it.tab as ComputeRecord["tab"], id: it.openId } }));
  // A thin agenda (fresh import) gets backfilled with message-derived signal so the first impression isn't a
  // near-empty list on a full book. A mature book with plenty of dated actions skips this.
  const signals = items.length < 6 ? freshSignals(d, today) : [];
  if (!items.length && !signals.length) {
    const base = "Nothing's overdue and nothing's due in the next week — you're on top of it.";
    return { intro: attn ? `${base}\n${attn}` : `${base} Want me to surface who's gone cold, or your at-risk deals?`, columns: [], rows: [] };
  }
  if (!items.length) {
    return { intro: `No dated actions are due yet, so here's where I'd start on your book:${attn ? `\n${attn}` : ""}`, columns: ["When", "Focus", "Who"], rows: signals };
  }
  return {
    intro: `What to focus on this week — ${items.length} thing${items.length === 1 ? "" : "s"} due or overdue${items.length > top.length ? ` (top ${top.length})` : ""}:${attn ? `\n${attn}` : ""}`,
    columns: ["When", "Focus", "Who"],
    rows: [...agendaRows, ...signals],
  };
}

// Personal snapshot — the answer to "what do you know about me / my book?". A richer, still-deterministic
// read than the bare pipeline: WHO you are in the network (size, dominant sector + seniority), your warmest
// relationship, the commercial picture, and your last activity. Clickable where it names a real record.
export function personalSnapshot(d: BookData, today: string): ComputeResult {
  const lm = lastMeetingMap(d);
  const open = d.opps.filter((o) => oppStatus(o) === "Open");
  const won = d.opps.filter((o) => oppStatus(o) === "Won");
  const lost = d.opps.filter((o) => oppStatus(o) === "Lost");
  const openVal = open.reduce((s, o) => s + (o.est_value ?? 0), 0);
  const weighted = open.reduce((s, o) => s + oppWeighted(o), 0);
  const winRate = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null;
  // Dominant slice of the network by a dimension (e.g. "Financial Services (38%)").
  const topOf = (dim: string): string => {
    const m = new Map<string, number>();
    for (const c of d.contacts) { const k = ((c as unknown as Record<string, string>)[dim] || "").trim(); if (k) m.set(k, (m.get(k) || 0) + 1); }
    const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    return top && d.contacts.length ? `${top[0]} (${Math.round((top[1] / d.contacts.length) * 100)}%)` : "—";
  };
  const warmest = d.contacts.map((c) => ({ c, s: warmth(c, lm, today) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0]?.c;
  const lastMeeting = d.meetingRows.filter((m) => m.meeting_stage === "Held" && m.date_held).sort((a, b) => (b.date_held || "").localeCompare(a.date_held || ""))[0];
  const rows: ComputeRow[] = [
    { cells: ["Contacts in network", d.contacts.length.toLocaleString()] },
    { cells: ["Strongest sector", topOf("sector_group")] },
    { cells: ["Most common seniority", topOf("seniority")] },
  ];
  if (warmest) rows.push({ cells: ["Warmest relationship", `${fullName(warmest)}${warmest.organisation ? ` · ${warmest.organisation}` : ""}`], record: { tab: "contacts", id: warmest.url } });
  rows.push({ cells: ["Open pipeline", `${money(openVal)} (${money(weighted)} weighted)`] });
  rows.push({ cells: ["Open / Won / Lost", `${open.length} / ${won.length} / ${lost.length}`] });
  rows.push({ cells: ["Win rate", winRate == null ? "—" : `${winRate}%`] });
  if (lastMeeting) rows.push({ cells: ["Last meeting", `${lastMeeting.date_held} · ${lastMeeting.contactInfo.name}`], record: { tab: "meetings", id: lastMeeting.id } });
  return { intro: "Here's what I know about your book:", columns: ["What", "Detail"], rows };
}

// 8b. sectorContacts — the people you know in a SECTOR or FUNCTION, ranked by seniority. Deterministic on
// purpose: "the most important people I know in banking" used to go free-form and the model INVENTED a
// contact (an energy exec relabelled "CEO, National Bank of Canada"). Now code lists the real people and the
// interpret combo adds the "what to discuss" — the model narrates, it doesn't fabricate the roster.
const SENIORITY_ORDER: Record<string, number> = { "Executive Leadership": 5, "Head of / Director": 4, "VP / SM": 3, "Manager": 2, "Associate / Analyst": 1 };
export function sectorContacts(d: BookData, field: "sector_group" | "function", value: string): ComputeResult {
  const list = d.contacts
    .filter((c) => ((c as unknown as Record<string, string>)[field] || "") === value)
    .sort((a, b) => (SENIORITY_ORDER[(b as unknown as Record<string, string>).seniority] || 0) - (SENIORITY_ORDER[(a as unknown as Record<string, string>).seniority] || 0));
  const label = field === "sector_group" ? value : `${value} roles`;
  if (!list.length) return { intro: `Hmm, no contacts in ${label} in your book right now.`, columns: [], rows: [] };
  const shown = list.slice(0, 40);
  const res: ComputeResult = {
    intro: `Your most senior contacts in ${label} (${list.length}${list.length > shown.length ? `, showing ${shown.length}` : ""}):`,
    columns: ["Name", "Role", "Company", "Seniority"],
    rows: shown.map((c) => ({ cells: [fullName(c), c.position || "—", c.organisation || "—", (c as unknown as Record<string, string>).seniority || "—"], record: { tab: "contacts", id: c.url } })),
  };
  if (list.length > shown.length) res.more = { count: list.length, tab: "contacts", intent: {} };
  return res;
}

// 8c. opportunitiesBySector — open opps filtered by the SECTOR of their company. Opps carry no sector field,
// so we map org→sector from the contacts. Fixes "which deals are in financial services?" dumping ALL 20 and
// the model then misclassifying companies / inventing values.
export function opportunitiesBySector(d: BookData, value: string): ComputeResult {
  const orgSector = new Map<string, string>();
  for (const c of d.contacts) { const o = (c.organisation || "").toLowerCase(); const s = (c as unknown as Record<string, string>).sector_group; if (o && s && !orgSector.has(o)) orgSector.set(o, s); }
  const open = d.opps
    .filter((o) => oppStatus(o) === "Open" && orgSector.get((o.organisation || "").toLowerCase()) === value)
    .sort((a, b) => (b.est_value ?? 0) - (a.est_value ?? 0));
  if (!open.length) return { intro: `You've no open opportunities in ${value} right now.`, columns: [], rows: [] };
  const total = open.reduce((s, o) => s + (o.est_value ?? 0), 0);
  return {
    intro: `Your open opportunities in ${value} (${open.length}) — ${money(total)} total:`,
    columns: ["Opportunity", "Company", "Stage", "Est. value"],
    rows: open.slice(0, 30).map((o) => ({ cells: [oppDisplayName(o), o.organisation || "—", stepLabel(o.current_step), money(o.est_value)], record: { tab: "opportunities", id: o.id } })),
  };
}

// 8. funnelBreakdown — counts of the network by a dimension (sector/function/seniority).
export function funnelBreakdown(d: BookData, dim: "sector_group" | "function" | "seniority"): ComputeResult {
  const counts = new Map<string, number>();
  for (const c of d.contacts) { const k = ((c as unknown as Record<string, string>)[dim] || "—").trim() || "—"; counts.set(k, (counts.get(k) || 0) + 1); }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  const dimLabel = dim === "sector_group" ? "sector" : dim;
  const total = d.contacts.length;
  return {
    intro: `Your network broken down by ${dimLabel} (${total} contacts):`,
    columns: [dimLabel.replace(/\b\w/, (c) => c.toUpperCase()), "Contacts", "Share"],
    rows: rows.map(([k, n]) => ({ cells: [k, String(n), `${Math.round((n / total) * 100)}%`] })),
  };
}

// 9 + 11. resolveContact + contactBrief — one person's full picture.
// Fold diacritics + case so "José Fernández" resolves to a stored "Jose Fernandez" (consultants type both,
// and whether the model echoes or strips the accent otherwise decides the match — a cross-tier coin-flip).
export const foldAccents = (s: string): string => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function resolveContact(d: BookData, ref: string, today: string): Contact | null {
  const r = foldAccents(String(ref ?? "").trim()); // defensive: a non-string ref (bad tool arg) must not throw
  if (!r) return null;
  const lm = lastMeetingMap(d);
  if (/\b(warmest|hottest|most engaged)\b/.test(r)) return d.contacts.map((c) => ({ c, s: warmth(c, lm, today) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0]?.c ?? null;
  const exact = d.contacts.find((c) => foldAccents(fullName(c)) === r);
  if (exact) return exact;
  const partial = d.contacts.filter((c) => foldAccents(fullName(c)).includes(r) || r.includes(foldAccents(fullName(c))));
  return partial.length === 1 ? partial[0] : (partial.sort((a, b) => warmth(b, lm, today) - warmth(a, lm, today))[0] ?? null);
}
export function contactBrief(d: BookData, ref: string, today: string): ComputeResult {
  // Bare SHARED first name → DISAMBIGUATE rather than silently briefing the warmest match. Picking one
  // unverified builds every later turn (a drafted email!) on the wrong person — confidentiality-grade. Only
  // fires for a single-token name that isn't already a full name in the book, and only when ≥2 people share it.
  const bare = foldAccents(String(ref ?? "").trim());
  if (bare && !/\s/.test(bare) && !d.contacts.some((c) => foldAccents(fullName(c)) === bare)) {
    const sameFirst = d.contacts.filter((c) => foldAccents(c.first) === bare);
    if (sameFirst.length > 1) return {
      intro: `You know ${sameFirst.length} people called ${sameFirst[0].first} — which one did you mean?`,
      columns: ["Name", "Role", "Company"],
      rows: sameFirst.map((c) => ({ cells: [fullName(c), c.position || "—", c.organisation || "—"], record: { tab: "contacts", id: c.url } })),
    };
  }
  const c = resolveContact(d, ref, today);
  if (!c) return { intro: `Hmm, I've had a good rummage and there's no "${ref}" in your book yet — want me to add them, or did you maybe mean someone else?`, columns: [], rows: [] };
  const meetings = d.meetingRows.filter((m) => m.contact_url === c.url && m.meeting_stage === "Held").sort((a, b) => (b.date_held || "").localeCompare(a.date_held || ""));
  const opps = d.opps.filter((o) => o.contact_url === c.url || orgMatches(o.organisation, c.organisation));
  // Deterministic thread read: who owes the next reply, from the last message's direction.
  const owed = c.thread && !c.thread.lastFromOwner
    ? `You owe them a reply — they messaged last${c.thread.lastDate ? ` on ${c.thread.lastDate}` : ""}.`
    : c.thread?.lastFromOwner ? `Ball's in their court — you messaged last${c.thread.lastDate ? ` on ${c.thread.lastDate}` : ""}.` : "";
  const lines = [
    `${fullName(c)} — ${c.position || "—"} at ${c.organisation || "—"}.`,
    `Stage: ${stageLabel(c)}.${meetings.length ? ` ${meetings.length} meeting${meetings.length === 1 ? "" : "s"}, last on ${meetings[0].date_held} (${meetings[0].sentiment || "—"}).` : " No meetings logged yet."}`,
    c.warmthSentiment ? `Warmth: ${warmthCell(c)} (from the tone of their messages).` : "",
    owed,
    c.latentOpp?.text ? `Possible opportunity spotted in your messages: ${c.latentOpp.text}.` : "",
    opps.length ? `${opps.length} related opportunit${opps.length === 1 ? "y" : "ies"} at ${c.organisation}.` : "",
  ].filter(Boolean);
  return {
    intro: lines.join("\n"),
    columns: meetings.length ? ["Date", "Purpose", "Sentiment"] : [],
    rows: meetings.slice(0, 6).map((m) => ({ cells: [m.date_held || "—", m.purpose || "—", m.sentiment || "—"], record: { tab: "meetings", id: m.id } })),
  };
}

// owedReplies — deterministic (no LLM): contacts who messaged LAST and haven't heard back (the last message
// in the thread was theirs). Your "you left them hanging" queue — warmest first, so you chase the best ones.
export function owedReplies(d: BookData, today: string): ComputeResult {
  const lm = lastMeetingMap(d);
  const owed = d.contacts
    .filter((c) => c.thread && !c.thread.lastFromOwner && c.thread.inboundCount > 0)
    .sort((a, b) => warmth(b, lm, today) - warmth(a, lm, today) || (b.thread!.lastDate || "").localeCompare(a.thread!.lastDate || ""));
  if (!owed.length) return { intro: "You're all square — no one's waiting on a reply from you right now.", columns: [], rows: [] };
  const shown = owed.slice(0, 25);
  return {
    intro: `You owe a reply — they messaged last and you haven't come back${owed.length > shown.length ? ` (showing ${shown.length} of ${owed.length})` : ` (${owed.length})`}, warmest first:`,
    columns: ["Name", "Company", "Last heard", "Warmth"],
    rows: shown.map((c) => ({ cells: [fullName(c), c.organisation || "—", c.thread!.lastDate || "—", warmthCell(c)], record: { tab: "contacts", id: c.url } })),
  };
}

// latentOpportunities — surfaces the needs the opt-in Opportunity Scan spotted in message threads (stored on
// contacts as `latentOpp.text`). Empty until that scan has run (points the user to Insights).
export function latentOpportunities(d: BookData): ComputeResult {
  const withOpp = d.contacts.filter((c) => c.latentOpp?.text);
  const scanned = d.contacts.some((c) => c.latentOpp);
  if (!withOpp.length) {
    return {
      intro: scanned
        ? "No latent opportunities flagged — the Opportunity scan didn't find unmet needs in the threads it read."
        : "No opportunity scan has run yet — run it from Insights to surface needs hidden in your messages.",
      columns: [], rows: [],
    };
  }
  const shown = withOpp.slice(0, 25);
  return {
    intro: `Possible opportunities spotted in your messages${withOpp.length > shown.length ? ` (showing ${shown.length} of ${withOpp.length})` : ` (${withOpp.length})`}:`,
    columns: ["Name", "Company", "Opportunity"],
    rows: shown.map((c) => ({ cells: [fullName(c), c.organisation || "—", c.latentOpp!.text], record: { tab: "contacts", id: c.url } })),
  };
}

// 10. accountSummary — a company's whole footprint.
export function accountSummary(d: BookData, company: string): ComputeResult {
  const people = d.contacts.filter((c) => orgMatches(c.organisation, company));
  if (!people.length) return { intro: `Drew a blank on "${company}" — no one from there is in your book yet. Want me to keep an eye out as you add contacts?`, columns: [], rows: [] };
  const org = people[0].organisation;
  const meetings = d.meetingRows.filter((m) => orgMatches(m.contactInfo.organisation, company) && m.meeting_stage === "Held").length;
  const opps = d.opps.filter((o) => orgMatches(o.organisation, company));
  const openVal = opps.filter((o) => oppStatus(o) === "Open").reduce((s, o) => s + (o.est_value ?? 0), 0);
  // Aggregate relationship signals across the firm's people (graceful — omitted when nothing's scored).
  const scored = people.filter((c) => typeof c.warmthSentiment?.score === "number");
  const avgWarmth = scored.length ? Math.round((scored.reduce((s, c) => s + c.warmthSentiment!.score, 0) / scored.length) * 10) / 10 : null;
  const owedHere = people.filter((c) => c.thread && !c.thread.lastFromOwner && c.thread.inboundCount > 0).length;
  const latentHere = people.filter((c) => c.latentOpp?.text).length;
  const sigBits = [
    avgWarmth != null ? `avg warmth ${avgWarmth}/10 (${warmthLabel({ score: avgWarmth })})` : "",
    owedHere ? `${owedHere} awaiting your reply` : "",
    latentHere ? `${latentHere} with a spotted opportunity` : "",
  ].filter(Boolean);
  const res: ComputeResult = {
    intro: `${org}: ${people.length} contact${people.length === 1 ? "" : "s"}, ${meetings} meeting${meetings === 1 ? "" : "s"} held, ${opps.length} opportunit${opps.length === 1 ? "y" : "ies"}${openVal ? ` (${money(openVal)} open)` : ""}.${sigBits.length ? `\nRelationship read: ${sigBits.join(" · ")}.` : ""}`,
    columns: ["Name", "Role", "Stage"],
    rows: people.slice(0, 20).map((c) => ({ cells: [fullName(c), c.position || "—", stageLabel(c)], record: { tab: "contacts", id: c.url } })),
    // Hint to the caller: blend in what this organisation actually DOES (a brokered web/entity lookup),
    // so "tell me about JPMorgan" gives the network picture AND a factual description, not just the table.
    enrich: org ? { kind: "company", name: org } : undefined,
  };
  if (people.length > 20) res.more = { count: people.length, tab: "contacts", intent: { search: org } };
  return res;
}

// ── KEYWORD ROUTER (the fast prior on every tier) ────────────────────────────────────────────────
// Capture the org after at/from/in/with, but STOP at a filler connector (about/who/that/and…) and cap the
// length — so "discuss with them about their role" doesn't swallow the whole clause as a "company".
// Terminator also stops at a dash/colon so "top contacts at JPMorgan — give me three" captures "JPMorgan"
// (the em-dash used to fail the match entirely → the whole book dumped). Noise scopes ("in total") filtered below.
const COMPANY_AT = /\b(?:everyone|anyone|every one|people|contacts?|connections?|folks|who(?:m)?\s+do i know|who do i have)\b[^?]*?\b(?:at|from|in|with)\s+([A-Za-z0-9][A-Za-z0-9 .&'-]{0,38}?)(?:[?,.:;—–-]|$|\s+(?:about|who|that|which|and|but|so|to|for|regarding|in order|give|show|list|tell)\b)/i;
// Words that follow "…in/at ___" but are NOT a company ("how many contacts do I have in total").
const AT_NOISE = /^(?:total|general|particular|the book|my book|my network|mind|fact|now|today|short|full|detail|question|play)$/i;
const ABOUT = /\b(?:brief me on|tell me about|who is|what do (?:you|i) know about|what do i have on|summarise|summarize|profile of|details on)\s+([\p{L}\p{M}0-9 .&'-]+?)(?:\?|$)/iu;

// Verbs that signal "give me a list / a count" — kept broad on purpose. This is the LOW-CAPABILITY path
// (Nano skips the LLM tool-router), so the more phrasings we catch deterministically, the fewer questions
// fall through to free-form generation on a tiny model (where it tends to fabricate). Counts route to the
// same list tools — the tool intros already state the total ("200 contacts (showing 40):").
const LIST_VERB = /\b(list|show|pull up|see|view|give me|display|what(?:'?s| are| is)?|how many|number of|count|find|get me|i (?:have|know))\b/;

// Extract a company filter from "…at/with/for/from X" — but ONLY keep it when X is actually an org in the
// book. This is the guard that stops filler becoming a bogus company: "open deals … at all?" would grab
// "all", "…and at least two contacts at?" would grab "least two contacts at", and the tool would then
// confidently return an empty table for a company that doesn't exist. If nothing real matches, return
// undefined (no company filter) so the query is answered unscoped or declined — never mis-answered.
function extractCompany(t: string, d: BookData): string | undefined {
  const m = t.match(/\b(?:at|with|for|from)\s+([A-Za-z0-9][A-Za-z0-9 .&'-]{0,38}?)(?:[?,.:;—–-]|$|\s+(?:about|who|that|which|and|but|so|to|for|regarding|give|show|list|tell)\b)/i);
  if (!m) return undefined;
  const cand = m[1].trim();
  if (!cand || AT_NOISE.test(cand)) return undefined;
  const real = d.contacts.some((c) => orgMatches(c.organisation, cand)) || d.opps.some((o) => orgMatches(o.organisation, cand)) || d.sows.some((s) => orgMatches(s.organisation, cand));
  return real ? cand : undefined;
}

// Parse a meeting-count THRESHOLD from a "met …" question. Returns the minimum meetings (≥1) or null when
// it isn't a threshold query. "more than once"/"twice" → 2; "three or more times"/"at least 3" → 3;
// "more than twice" → 3. Negated forms ("haven't met") are excluded — those are a different question.
function meetThreshold(t: string): number | null {
  if (!/\bmet\b/.test(t) || /\bhaven'?t\b|\bhasn'?t\b|\bnever\b|\bnot\b/.test(t)) return null;
  const W: Record<string, number> = { once: 1, twice: 2, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const num = (s: string) => W[s.toLowerCase()] ?? Number(s);
  let m;
  if ((m = t.match(/\bmore than\s+(once|twice|two|three|four|five|\d+)\b/))) return num(m[1]) + 1;
  if ((m = t.match(/\bat least\s+(once|twice|two|three|four|five|\d+)\b/))) return num(m[1]);
  if ((m = t.match(/\b(two|three|four|five|\d+)\s*(?:or more|\+)\s*times?\b/))) return num(m[1]);
  if (/\btwice\b|\bmultiple times\b|\bseveral times\b|\brepeatedly\b/.test(t)) return 2;
  return null;
}

// Is this the "companies where I have BOTH an open opp AND ≥N contacts" JOIN? Returns the min contacts, or
// null. Kept as a helper so it can run BEFORE the reasoning-gate (the "where I have …" phrasing trips the
// join-condition heuristic in isReasoningRequest, but this join is deterministically computable, so the tool
// should win over deferring to the model — which free-hands the intersection and gets it wrong).
function oppContactsJoin(t: string): number | null {
  if (!(/\bcompan/.test(t) && /\b(?:opportunit|deals?|open (?:opp|deal))/.test(t) && /\b(?:contacts?|people|knows?|folks)\b/.test(t) && /\b(both|and|at least|two|2|multiple|several|more than one|\d+\+?)\b/.test(t))) return null;
  const W: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };
  const nm = t.match(/\b(?:at least|more than)?\s*(\d+|two|three|four|five)\b\s*(?:\+|or more)?\s*(?:contact|people|folks)/);
  let min = nm ? (W[nm[1]] ?? Number(nm[1])) : 2;
  if (/\bmore than one\b/.test(t)) min = 2;
  if (nm && /more than/.test(t)) min += 1;
  return Math.max(2, min || 2);
}

// A complex REASONING / multi-part instruction the keyword router must DECLINE (→ return null → the model
// handles it). Without this, a paragraph-long "you are a BD advisor, analyse… and prepare…" instruction gets
// hijacked into a single table the moment it contains a trigger word like "meeting". Targets generation/
// reasoning verbs + multi-ask shape + paragraph length — NOT simple lookups ("brief me on X" still routes).
export function isReasoningRequest(text: string): boolean {
  const s = text.trim();
  if (/\b(analy[sz]e|assess(?:ment)?|evaluate|develop (?:a|an|me)|come up with|brainstorm|contrarian|critique|compare|strategi[sz]e|recommend(?:ation)?|parse every|step[- ]by[- ]step|you are (?:a|an|my)|act as|pretend|imagine you|play devil|devil'?s advocate)\b/i.test(s)) return true;
  if (/\b(prepare|prep|help me|get me ready)\b[^?]*\b(for|a strategy|a plan|a business|a pitch|a proposal|an? approach|me for)\b/i.test(s)) return true;
  if (/\b(write|build|create|put together|draft|give me|make me)\s+(?:me\s+)?(?:a|an)\s+(?:strategy|plan|report|essay|brief(?:ing)?|analysis|memo|account (?:plan|map)|approach|playbook|proposal)\b/i.test(s)) return true;
  if (/\bdo a few things\b|\b(several|multiple|a few) (?:things|tasks)\b/i.test(s)) return true;
  // A per-item structured breakdown the deterministic tools can't produce ("…the key contact for each").
  if (/\bfor each\b|\bfor every\b|\bfor each one\b/i.test(s)) return true;
  if (/\bplan my (?:\w+ )?(?:day|week|month|quarter|outreach)\b/i.test(s)) return true; // "plan my BD week"
  // "pick/choose the best … and write/justify" — a selection + generation the tools can't do alone.
  if (/\b(pick|choose|select|find me)\b[^?]*\b(?:and (?:write|draft|then|tell me why|explain)|why you (?:chose|picked|selected))\b/i.test(s)) return true;
  // A join/filter condition ("…at companies where I also have an engagement") — beyond a keyword lookup.
  if (/\bwhere i (?:also )?(?:have|know|met|already|do|run)\b/i.test(s)) return true;
  // "how to / how do I …" reasoning (NOT "how's my pipeline" / "how many" / "how am I doing").
  if (/\bhow (?:to|do i|should i|can i|could i|would i|might i|d'?you think i)\b/i.test(s)) return true;
  // Conversational CHALLENGE / BACK-REFERENCE / GOAL-CHECK — the user is pushing on something the assistant
  // said, referring back across the thread, or checking a fact against a stated goal. These MUST reason over
  // the conversation, never run a fresh keyword table — otherwise a stray word ("cold", "at risk", "Chevron")
  // hijacks a genuine follow-up. (A bare follow-up with no challenge marker — "which of those is at risk?" —
  // still routes deterministically; it's the challenge/reference framing that forces the model.)
  if (/\byou (?:said|told me|listed|mentioned|claimed|reckoned|suggested|picked|chose|flagged)\b/i.test(s)) return true;
  if (/\b(?:earlier|before|a moment ago|just now|previously)\b[^?]*\b(?:you|said|told|listed|mentioned)\b/i.test(s)) return true;
  if (/\bgoing back to\b|\bthe (?:first|very first|last|second|third|other) thing you\b|\bwhat you (?:just )?(?:said|told me|mentioned)\b/i.test(s)) return true;
  if (/\bwhich is it\b|\bare you sure\b|\bthat (?:doesn'?t|does not) (?:match|add up|make sense|line up)\b|\bcontradic/i.test(s)) return true;
  if (/\bdoesn'?t that\b|\bwouldn'?t that\b|\bdoesn'?t (?:that|this|it) (?:make|mean)\b/i.test(s)) return true;
  if (/\bwhat (?:specifically )?makes\b|\bwhy bother\b|\bwhy not\b|\bhow come\b/i.test(s)) return true;
  if (/\bdoes (?:that|this|it) (?:count|change|help|mean|matter|move)\b|\bmoves? me (?:toward|towards|closer)\b|\bcount toward\b|\bgiven (?:the|my) goal\b|\btoward (?:that|my|the) goal\b/i.test(s)) return true;
  if (/^\s*(?:hang on|hold on|wait|hmm|come on|actually,)\b/i.test(s)) return true;
  // Comparison of a PAIR/TRIPLE given earlier ("of the two, who should I prioritise and why?") — reasons over
  // the prior turn. Numeric ("the two/three") only, so a bare ranking follow-up ("which of those is most at
  // risk?") still routes deterministically.
  if (/\b(?:of|between) (?:the )?(?:two|three|four)\b/i.test(s)) return true;
  // A scoped count that depends on the prior list ("of those FS contacts, how many have I met?").
  if (/\bof those\b[^?]*\bhow many\b/i.test(s) || /\bhow many of (?:those|these|them)\b/i.test(s)) return true;
  // A count/share that depends on prior context ("what percentage of my book is that?").
  if (/\bwhat (?:percentage|proportion|share|fraction|%)\b/i.test(s)) return true;
  // Per-item GENERATION the tools can't do ("draft each a different angle", "write them both a note").
  if (/\b(?:draft|write|compose|send|prepare|make)\s+(?:each|both|them|all|a different|separate)\b/i.test(s) || /\beach a (?:different|separate|unique|distinct)\b/i.test(s)) return true;
  // Pushback questioning a specific recommendation ("is she really worth another go?").
  if (/\bis (?:she|he|it|they|that|this)\s+(?:really|actually|even|still)\s+worth\b/i.test(s) || /\bworth (?:another|the) (?:go|shot|try|effort|time)\b/i.test(s)) return true;
  // ADVICE on a specific opportunity ("should I chase / pursue / walk away from the UK Civil Service deal?") —
  // needs judgement (and any remembered preference), not a record table. (NOT "should I focus this week" = agenda.)
  if (/\bshould i (?:chase|pursue|go after|bother with|keep pushing|drop|walk away from|kill|bin|ditch|pass on)\b/i.test(s)) return true;
  // RECALL of something said earlier ("remind me what my focus is again?", "how many did you say I have?") —
  // reason over the conversation/memory, don't run a fresh table.
  if (/\bremind me\b[^?]*\b(again|you said|you told|i said|i told|my (?:focus|goal|priority|plan))\b/i.test(s) || /\bdid you say\b|\bwhat did i (?:say|tell you)\b/i.test(s)) return true;
  // HYPOTHETICAL / counterfactual ("what would my win rate become?", "given X, which should I…").
  if (/\bwhat would\b|\bwould (?:my|the|it|that|this)\b[^?]*\b(become|be|change|look like|jump|drop|go up|go down)\b/i.test(s)) return true;
  if (/\bif i (?:lose|win|close|drop|land|sign|add|remove|had|got|don'?t)\b/i.test(s)) return true; // "if I lose the next two, what's my win rate?"
  // Duration/cycle metrics the tools DON'T compute — let the model reach them (and admit it can't), rather
  // than a deal keyword ("deal open to close") pulling up an unrelated opportunities table.
  if (/\b(sales cycle|cycle length|time[- ]to[- ]close|days? to close|turnaround|how long (?:does|do|it|to|a deal|deals))\b/i.test(s)) return true;
  if (/\bgiven (?:where|what|that|my|the|how)\b[^?]*\b(should|which|who|what|how)\b/i.test(s)) return true;
  if ((s.match(/\?/g) || []).length >= 2) return true; // several distinct questions in one message
  if (s.length > 220) return true; // a paragraph-long instruction is not a keyword lookup
  return false;
}

// The NARROW deterministic rail run BEFORE the LLM router on EVERY tier. ONLY the must-be-COMPUTED queries
// where a wrong number / missed relation is unforgivable AND the phrasing is high-precision: aggregate maths,
// recognised-revenue totals, and the relational anti-joins/joins. These are exactly the tools the LLM router's
// catalog can't reach — so without this rail a capable model routes them to a coarse LIST tool and then
// FABRICATES an "average" from a truncated table (the cross-tier inversion). Everything else — rankings,
// stats, breakdowns, simple lists — is LEFT to the LLM router, which owns those tools; this returns null for
// anything it doesn't own, so routing continues normally. Mirrors the same-named blocks in computeForQuery
// (which stays the full error-fallback); keep the two in sync.
export function computeExact(text: string, d: BookData, today: string): ComputeResult | null {
  void today;
  const t = text.toLowerCase();
  // JOIN+count runs BEFORE the reasoning gate (a join phrasing trips isReasoningRequest but must still compute).
  { const min = oppContactsJoin(t); if (min) return companiesWithOppAndContacts(d, min); }
  // Genuine reasoning / multi-part instructions belong to the model — never short-circuit them to a table.
  if (isReasoningRequest(text)) return null;
  // Pipeline aggregate MATHS — average / weighted / total / raw-vs-weighted gap. Computed, never the model.
  {
    const aggWord = /\b(average|avg|mean|median|typical|weight(?:ed|ing)?|total|sum)\b/.test(t);
    const valueWord = /\b(value|worth|size|£|\$|pounds?|dollars?|pipeline)\b/.test(t);
    if ((aggWord && valueWord) || /\baverage (?:deal|opportunit|open)\b/.test(t) || /\bgap between\b/.test(t) || (/\bweight/.test(t) && /\b(raw|unweighted|probability|total|pipeline)\b/.test(t))) {
      const agg = pipelineAggregate(d, t);
      if (agg) return agg;
    }
  }
  // Recognised-revenue maths over engagements (total / count / average per engagement).
  if (
    (/\b(recognis|recogniz|revenue)\w*/.test(t) && (/\b(total|how much|average|avg|mean|per engagement|across|sum|each|altogether|in total)\b/.test(t) || (/\bengagements?\b/.test(t) && !LIST_VERB.test(t.replace(/how much/g, ""))))) ||
    (/\bengagements?\b/.test(t) && /\b(average|avg|mean|typical|per engagement)\b/.test(t) && !/\b(biggest|largest|highest|top|most valuable|which one|list|show me)\b/.test(t))
  ) return contractsAggregate(d, t);
  // ANTI-JOIN: open opportunities with NO meeting logged.
  if (/\b(deals?|opportunit)/.test(t) && /\b(no|without|zero|haven'?t (?:had|logged)|not had)\b[^?]*\bmeeting/.test(t)) return openOppsWithoutMeeting(d);
  // Reverse ANTI-JOIN: meetings/met-contacts with NO opportunity logged (requires the opp/deal word, so
  // "contacts I haven't met" — which has no deal word — falls through to the normal not-met filter).
  if ((/\bmeetings?\b/.test(t) || /\b(?:people|contacts?|who)\b[^?]*\bmet\b/.test(t)) && /\b(no|without|zero|haven'?t|hasn'?t|don'?t|doesn'?t|didn'?t|not|never)\b[^?]*\b(opportunit|deals?|pipeline)/.test(t)) return meetingsWithoutOpp(d);
  // Open opps by SECTOR.
  if (/\b(deals?|opportunit|pipeline)/.test(t)) {
    const inm = t.match(/\b(?:in|within)\s+([a-z& ]+?)(?:\?|$|\s+(?:sector|space|industry|right now))/);
    const sec = inm ? matchSector(inm[1].trim()) : null;
    if (sec) return opportunitiesBySector(d, sec);
  }
  // Count-THRESHOLD on meetings ("met more than once / three or more times").
  { const min = meetThreshold(t); if (min && min >= 2) return contactsMetAtLeast(d, min); }
  return null;
}

export function computeForQuery(text: string, d: BookData, today: string, prevText?: string): ComputeResult | null {
  // Deterministically-computable relational JOINs run BEFORE the reasoning-gate, so a phrasing that trips the
  // join-condition heuristic ("companies WHERE I HAVE an open deal and 2+ contacts") still gets the exact tool
  // rather than being free-handed by the model (the original multi-constraint-join failure).
  { const min = oppContactsJoin(text.toLowerCase()); if (min) return companiesWithOppAndContacts(d, min); }
  // "log £40k of revenue" — revenue is recorded in the Revenue tab against an engagement, not something the
  // copilot books. Decline cleanly (BEFORE the reasoning gate, which would otherwise defer it to the model, and
  // before the action pre-check, which would open an opportunity card and inflate est_value).
  if (/\b(log|record|add|book|enter|mark|put in)\b[^?]*\brevenue\b/.test(text.toLowerCase()) && !/\b(what|how much|show|list|total|my|report|breakdown|summar)\b/.test(text.toLowerCase()))
    return { intro: "Revenue is recorded in the Revenue tab against an engagement, so I don't book it from here — open Revenue to log it. I can help you with contacts, meetings, and opportunities, though.", columns: [], rows: [] };
  // Hand genuine reasoning / multi-part instructions to the model — never short-circuit them to a table.
  if (isReasoningRequest(text)) return null;
  const t = text.toLowerCase();
  // A people-noun scoped to a company ("everyone at EY") — captured up front so the generic list routes
  // below don't hijack a company-specific question. Drop noise scopes ("…in total") so they fall through
  // to the generic count instead of matching an org whose name contains the word (total → TotalEnergies).
  let at = text.match(COMPANY_AT);
  if (at && AT_NOISE.test(at[1].trim())) at = null;

  // ── Meetings ──────────────────────────────────────────────────────────────────────────────────
  // by date window / upcoming / "today"/"tomorrow"
  if (/\bmeetings?\b/.test(t) && /\b(last|past|recent(?:ly)?|this|upcoming|scheduled|coming up|next|today|tomorrow|week|month|quarter|fortnight|\d+\s*(?:day|week))\b/.test(t)) return findMeetings(d, today, t);
  // "who did I speak to / meet with / talk to / catch up with" (± a time window) → recent meetings. These
  // phrasings carry no literal "meeting", so the chatty LLM router mis-sent them to the companion.
  if (/\bwho\b[^?]*\bi\s+(?:speak|spoke|spoken|meet|met|talk|talked|catch(?:ing)?\s+up|caught up|see|saw|sit down|sat down)\b/.test(t) && !/\bshould\b/.test(t)) return findMeetings(d, today, t);
  // "what's in my diary / calendar / schedule", "what's coming up / on the horizon" → upcoming meetings.
  if ((/\b(diary|calendar|schedule)\b/.test(t) && !/\b(clear|block|free up|open up)\b/.test(t)) || /\bwhat'?s?\s+(?:coming up|on the horizon|ahead|in store|lined up)\b/.test(t) || /\bmy upcoming (?:meetings?|calls?|schedule)\b/.test(t)) return findMeetings(d, today, "upcoming");

  // ── Weekly focus / priorities (deterministic agenda — never the model) ──────────────────────────
  if (/what should i (?:focus on|do|prioriti[sz]e|work on|tackle)|what'?s? (?:my )?(?:focus|priorit|agenda|to-?dos?|action items?)|where should i focus|what'?s? (?:on )?my plate|what needs (?:my )?attention|plan my (?:day|week)|focus (?:for )?(?:this|the) (?:week|day)|what(?:'?s| is) (?:due|on) (?:this|next) (?:week|few days)|what'?s? next this week|what'?s? (?:overdue|slipped|slipping|fallen through|been neglected)|what have i (?:let slip|missed|dropped|neglected)|anything overdue|what'?s? (?:gone )?overdue/.test(t)) return weeklyFocus(d, today);
  // "who's my next/top priority" (NOT scoped to a company — "highest priority at EY" is a filter) → the agenda.
  if ((/\b(?:next|top|highest|main|biggest) priorit/.test(t) || /who should i (?:prioriti[sz]e|focus on|chase|call|tackle)\b/.test(t)) && !/\bat\s+[a-z]/i.test(t)) return weeklyFocus(d, today);
  // A VAGUE business-open ("let's talk business", "catch me up", "where do things stand", "give me a rundown")
  // has no specific ask — so LEAD with the deterministic agenda instead of free-forming a question back at them
  // ("what's on your mind?"). Makes the copilot open like a partner who knows the book, on every tier.
  if (/\b(?:let'?s |i (?:wanna|want to|would like to|need to) )?talk (?:business|shop)\b|\blet'?s (?:get (?:to |down to |cracking|started)|work|do (?:some )?work|crack on)\b|\bcatch me up\b|\bwhere (?:do (?:i|we|things)|are we|things) (?:stand|at)\b|\bgive me (?:a |the )?(?:rundown|run-down|snapshot|overview|update|state of play|lay of the land)\b|\bstate of (?:my |the )?(?:book|business|play|pipeline|things)\b|\bwhat'?s (?:the latest|going on|happening)\b/.test(t)) return weeklyFocus(d, today);

  // ── Rankings ──────────────────────────────────────────────────────────────────────────────────
  if (/gone cold|\bcold\b|re-?engage|reconnect|lapsed|gone quiet|lost touch|fallen off|drifted|follow(?:ed)?[- ]?up with|need(?:s)? (?:a )?(?:follow|chase|nudge)|chase up|reach out again/.test(t) && !/opportunit|\bdeals?\b|pipeline/.test(t)) return rankContacts(d, "cold", today);
  if ((/\bwarm(est)?\b/.test(t) && /\blead|contact|people|prospect|relationship/.test(t)) || /\bhottest\b/.test(t) || /\bmost engaged\b/.test(t) || /\bbest (?:lead|contact|relationship|prospect)/.test(t) || /\bstrongest relationship/.test(t)) return rankContacts(d, "warmth", today);
  if (/\b(biggest|largest|highest[- ]value|top|most valuable)\b[^?]*\b(deals?|opportunit)/.test(t)) return rankOpportunities(d, "value");
  if (/\b(most likely to close|closest to closing|highest probability|best chance|likeliest)\b/.test(t)) return rankOpportunities(d, "probability");
  if (/\b(at risk|stalled|stalling|going cold|cooling|slipping|neglected)\b[^?]*\b(deals?|opportunit|pipeline)/.test(t) || /\b(deals?|opportunit)[^?]*\b(at risk|stalled|stalling|going cold|cooling|slipping)\b/.test(t)) return rankOpportunities(d, "risk");
  // Follow-up form after a pipeline/deals table ("which of those is most at risk?") — "at risk of stalling"
  // is inherently about DEALS, so route it deterministically even without the deal/opportunity keyword
  // (the model otherwise misreads pipeline-summary metric rows like "Open value" as if they were deals).
  if (/\b(?:which|what|any)\b[^?]*\b(most at risk|at risk|riskiest|stalling|going nowhere|likely to stall|about to stall)\b/.test(t) && !/\b(contact|people|person|lead|relationship|client)\b/.test(t)) return rankOpportunities(d, "risk");
  // Bare superlative FOLLOW-UP with no entity noun ("which is the highest value one?", "and the biggest?").
  // Use the PRIOR turn to pick the ranker, so the answer stays consistent with the table just shown
  // (engagements ranked by value vs opportunities by value) instead of the model guessing a different metric.
  if (prevText && /\b(highest|biggest|largest|most valuable|worth most)\b/.test(t) && !/\bdeals?\b|opportunit|engagements?\b|contracts?\b|sows?\b|contacts?\b|\bpeople\b|\bperson\b|\bleads?\b|meetings?\b|\brevenue\b|clients?\b|accounts?\b|sectors?\b/.test(t)) {
    const p = prevText.toLowerCase();
    if (/engagements?\b|contracts?\b|sows?\b|signed work/.test(p)) return findContracts(d, { byValue: true });
    if (/opportunit|deals?\b|pipeline/.test(p)) return rankOpportunities(d, "value");
  }

  // ── Pipeline stats / breakdowns ─────────────────────────────────────────────────────────────────
  if (/\bmy pipeline\b|\bhow'?s? (?:the )?pipeline\b|\bpipeline (?:looking|summary|health|overview|status|snapshot)\b|\bwin rate\b|\bhow am i doing\b|\bsales summary\b/.test(t)) return pipelineStats(d);
  // Pipeline MATHS — average / weighted / total / the raw-vs-weighted gap. Computed, never the model (which
  // fabricated a single-deal total here). Needs an aggregate word AND a VALUE word (or an explicit
  // pipeline-value phrase) — so "biggest by value" (a ranking) and "average sales-cycle LENGTH" (not a value
  // metric — the tools can't compute it, so it must reach the model) are BOTH excluded.
  {
    const aggWord = /\b(average|avg|mean|median|typical|weight(?:ed|ing)?|total|sum)\b/.test(t);
    const valueWord = /\b(value|worth|size|£|\$|pounds?|dollars?|pipeline)\b/.test(t);
    if (
      (aggWord && valueWord) ||
      /\baverage (?:deal|opportunit|open)\b/.test(t) ||
      /\bgap between\b/.test(t) ||
      (/\bweight/.test(t) && /\b(raw|unweighted|probability|total|pipeline)\b/.test(t))
    ) {
      const agg = pipelineAggregate(d, t);
      if (agg) return agg;
    }
  }
  if (/\bweighted toward|breakdown by|broken down by|by sector|by industry|which sector|what sector|across sectors/.test(t)) return funnelBreakdown(d, "sector_group");
  if (/\bby function\b|\bby seniority\b|\bby role\b/.test(t)) return funnelBreakdown(d, /seniority/.test(t) ? "seniority" : "function");

  // ── Contacts by funnel filter ───────────────────────────────────────────────────────────────────
  if (/agreed to meet/.test(t) && /(haven'?t|not|yet|still)/.test(t)) return findContacts(d, { stage: "agreed_not_met" });
  if (/(haven'?t|hasn'?t|hadn'?t|didn'?t|doesn'?t|don'?t|not|no|never)\s+(responded|replied|heard back|got back|answered)/.test(t) || /\b(?:un|non)-?responsive\b|\bghosted\b|\bno reply\b|\bgone silent\b/.test(t)) return findContacts(d, { stage: "not_responded" });
  // Count-THRESHOLD on meetings ("met more than once / twice / three or more times") — a subset of "met",
  // NOT the whole met set. Must precede the plain "met" route below, which would otherwise ignore the count.
  { const min = meetThreshold(t); if (min && min >= 2) return contactsMetAtLeast(d, min); }
  if (/\b(people|who|contacts)\b[^?]*\b(?:i'?ve|i have|have i)\s+met\b/.test(t) && !/haven'?t|hasn'?t|not/.test(t)) return findContacts(d, { stage: "met" });
  if (/\bdecision[- ]?makers?\b|\bc-?suite\b|\bexecutives?\b|\bsenior (?:people|contacts|leaders|stakeholders)\b/.test(t)) {
    // Honour a funnel qualifier in the SAME question ("...C-suite I've actually met" → met only).
    let stage: ContactFilter["stage"] | undefined;
    if (/\bmet\b/.test(t) && !/haven'?t|hasn'?t|not |never|yet to|still to/.test(t)) stage = "met";
    else if (/agreed to meet/.test(t)) stage = "agreed_not_met";
    else if (/responded|replied|got back|heard back/.test(t) && !/haven'?t|hasn'?t|not |never/.test(t)) stage = "responded";
    return findContacts(d, { decisionRole: true, company: extractCompany(t, d), stage });
  }

  // ── Compound / relational (aggregate · anti-join · join) — compute or decline, never mis-parse ──────
  // ANTI-JOIN: open opportunities with NO meeting logged ("open deals with no meeting against them"). Must
  // precede the generic deals route, whose naive company-grab used to turn "…at all" into a bogus company.
  if (/\b(deals?|opportunit)/.test(t) && /\b(no|without|zero|haven'?t (?:had|logged)|not had)\b[^?]*\bmeeting/.test(t)) return openOppsWithoutMeeting(d);
  // (The JOIN+count "companies with an open opp AND ≥N contacts" runs at the top, before the reasoning-gate.)

  // Open opps by SECTOR ("which of my open deals are in financial services / energy?") — filter by the
  // company's sector, computed. Must precede the generic deals route (which ignored the sector and dumped all).
  if (/\b(deals?|opportunit|pipeline)/.test(t)) {
    const inm = t.match(/\b(?:in|within)\s+([a-z& ]+?)(?:\?|$|\s+(?:sector|space|industry|right now))/);
    const sec = inm ? matchSector(inm[1].trim()) : null;
    if (sec) return opportunitiesBySector(d, sec);
  }
  // ── Opportunities / deals ───────────────────────────────────────────────────────────────────────
  if (/\bopportunit|\bdeals?\b/.test(t) && (LIST_VERB.test(t) || /\b(open|won|lost|any|all|my)\b/.test(t))) {
    const mv = t.match(/\b(?:over|above|more than|worth|>)\s*[£$€]?\s*(\d[\d,]*)\s*(k|m)?/i);
    const minValue = mv ? Number(mv[1].replace(/,/g, "")) * (mv[2]?.toLowerCase() === "m" ? 1_000_000 : mv[2]?.toLowerCase() === "k" ? 1000 : 1) : undefined;
    return findOpportunities(d, { status: /\bwon\b/.test(t) ? "Won" : /\blost\b/.test(t) ? "Lost" : "Open", minValue, company: extractCompany(t, d) });
  }
  // ── Contracts / signed work ─────────────────────────────────────────────────────────────────────
  // Recognised-revenue MATHS over engagements (total / count / average per engagement). Computed, never the
  // model — and it must precede both the "by value" rank and the generic engagements list, which used to
  // catch "revenue" and just re-list all engagements when the user asked for the total or the average.
  if (
    (/\b(recognis|recogniz|revenue)\w*/.test(t) && (/\b(total|how much|average|avg|mean|per engagement|across|sum|each|altogether|in total)\b/.test(t) || (/\bengagements?\b/.test(t) && !LIST_VERB.test(t.replace(/how much/g, ""))))) ||
    // …and the follow-up "so what's the average per engagement?" (no "revenue" word) — an average over
    // engagements is the aggregate, NOT the engagements list. Excludes ranking/list phrasings.
    (/\bengagements?\b/.test(t) && /\b(average|avg|mean|typical|per engagement)\b/.test(t) && !/\b(biggest|largest|highest|top|most valuable|which one|list|show me)\b/.test(t))
  ) return contractsAggregate(d, t);
  // Engagements RANKED by value (deterministic — never let the model pick the max).
  if (/\b(highest|biggest|largest|top|most valuable|by value|worth most)\b[^?]*\b(engagement|contract|sow)/.test(t) || /\b(engagement|contract|sow)s?\b[^?]*\b(highest|biggest|largest|most valuable|by value|worth most)\b/.test(t)) return findContracts(d, { byValue: true });
  if (/\b(contracts?|sows?|engagements?|signed work|statement of work|revenue)\b/.test(t) && (LIST_VERB.test(t) || /\b(active|signed|any|all|my)\b/.test(t))) return findContracts(d, { status: /\bactive\b/.test(t) ? "Active" : undefined });

  // ── Generic, unfiltered lists / counts ("show my contacts", "how many people do I have") ─────────
  // Only when NOT scoped to a company (COMPANY_AT below handles "... at EY").
  if (!at && /\b(contacts?|people|network|connections?|leads?|prospects?|my book)\b/.test(t) && (LIST_VERB.test(t) || /\beveryone\b/.test(t))) return findContacts(d, {});
  if (/\bmeetings?\b/.test(t) && LIST_VERB.test(t)) return findMeetings(d, today, "quarter");

  // ── Personal snapshot ("what do you know about me", "summarise my book") ─────────────────────────
  // This is a request for THEIR own numbers, NOT a contact lookup — guard it before ABOUT, or "...about
  // me" fuzzy-matches a person whose name contains "me" (e.g. A·ME·lia). Breakdowns ("by sector") win.
  if (/\babout me\b|\bknow about me\b|\babout myself\b|tell me about myself|summari[sz]e (?:my )?(?:book|network|business|pipeline)|summary of my (?:book|network|business|pipeline)|how'?s my (?:book|network)|what(?:'?s| is) in my (?:book|network)|how big is my (?:book|network|pipeline)/.test(t) && !/by sector|by function|by seniority|by role|by industry/.test(t)) return personalSnapshot(d, today);

  // "my footprint / presence / coverage / how deep am I at X" → the company's whole account footprint.
  // (Distinct from "everyone at X" below — these phrasings name no people-noun, so they were falling to the
  // LLM router, which chatted about "your impact and presence" instead of showing the account.)
  {
    const m = t.match(/\b(?:footprint|presence|coverage|penetration|standing|how (?:deep|strong|big|well[- ]connected)(?:\s+am\s+i)?)\b[^?]*\bat\s+(.+?)(?:\?|$)/);
    if (m) { const co = extractCompany(`at ${m[1].trim()}`, d); if (co) return accountSummary(d, co); }
  }

  // ── Single-record / account ─────────────────────────────────────────────────────────────────────
  const about = text.match(ABOUT);
  if (about) {
    const ref = about[1].trim();
    // "tell me about me / myself / my book" is the personal snapshot above, not a person — never resolve it.
    if (/^(?:me|myself|i|my (?:book|network|business|pipeline|data|contacts?|relationships?|leads?))$/i.test(ref)) return personalSnapshot(d, today);
    // A PRONOUN reference ("brief me on her", "tell me about them") names no one on its own — resolving it
    // as a literal name grabs the whole trailing clause ("her and what I'd open with") and reports it
    // not-found. Defer to the model, which carries the person named earlier in the thread via grounding.
    if (/^(?:her|him|them|it|that|this|they|he|she|us|those|these)\b/i.test(ref)) return null;
    // "FirstName at Company" ("tell me about Karen at JPMorgan") — resolve first-name + company. One match →
    // brief; several → DISAMBIGUATE (the old code took the whole phrase as a name and drew a blank, then
    // wrongly denied a real COO existed). NB scope this to a bare first name so full names still brief directly.
    const fc = ref.match(/^([A-Za-z][\w'’-]+)\s+(?:at|from|with|in)\s+(.+)$/i);
    if (fc && !d.contacts.some((c) => fullName(c).toLowerCase() === ref.toLowerCase())) {
      const first = fc[1].toLowerCase(), org = fc[2].trim();
      const cands = d.contacts.filter((c) => c.first.toLowerCase() === first && orgMatches(c.organisation, org));
      if (cands.length === 1) return contactBrief(d, fullName(cands[0]), today);
      if (cands.length > 1) return {
        intro: `You know ${cands.length} people called ${fc[1]} at ${cands[0].organisation} — which one?`,
        columns: ["Name", "Role", "Stage"],
        rows: cands.map((c) => ({ cells: [fullName(c), c.position || "—", stageLabel(c)], record: { tab: "contacts", id: c.url } })),
      };
    }
    // If it resolves to a company (has contacts there) and not a person, summarise the account.
    if (d.contacts.some((c) => fullName(c).toLowerCase() === ref.toLowerCase()) || resolveContact(d, ref, today)) return contactBrief(d, ref, today);
    if (d.contacts.some((c) => orgMatches(c.organisation, ref))) return accountSummary(d, ref);
    // "X and Y" (two entities): the concatenation matches nothing — resolve the FIRST named entity rather than
    // denying both. Keeps the answer grounded in the book instead of falling through to a world-knowledge recital.
    if (/\s+(?:and|&)\s+|,/.test(ref)) {
      const first = ref.split(/\s+(?:and|&)\s+|,\s*/i)[0].trim();
      if (first && first.toLowerCase() !== ref.toLowerCase()) {
        if (resolveContact(d, first, today)) return contactBrief(d, first, today);
        if (d.contacts.some((c) => orgMatches(c.organisation, first))) return accountSummary(d, first);
      }
    }
    return contactBrief(d, ref, today);
  }
  // "everyone at X" → contacts at a company. BUT if the scope word is a SECTOR or FUNCTION ("...people I
  // know in banking", "...in finance leadership roles") and NOT a real org name in the book, list that
  // sector/function's contacts DETERMINISTICALLY (ranked by seniority) — the interpret combo then adds the
  // "what to discuss". Was deferred to the model, which invented contacts; code owns the roster now.
  if (at) {
    const scope = at[1].trim();
    const sl = scope.toLowerCase();
    const isExactOrg = d.contacts.some((c) => (c.organisation || "").toLowerCase() === sl);
    if (!isExactOrg) {
      const sec = matchSector(sl);
      if (sec) return sectorContacts(d, "sector_group", sec);
      const fn = matchFunction(sl);
      if (fn) return sectorContacts(d, "function", fn);
    }
    return findContacts(d, { company: scope });
  }

  return null;
}

// Run a tool call (from the LLM tool-router or, later, native function-calling) against the data. Defensive
// about arg shapes — the model's JSON is lenient. Returns null for an unknown tool → caller falls back.
export type ToolCall = { tool: string; args?: Record<string, unknown> };
export function runTool(call: ToolCall, d: BookData, today: string): ComputeResult | null {
  const a = call.args || {};
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const num = (v: unknown): number | undefined => { const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : NaN; return Number.isFinite(n) && n > 0 ? n : undefined; };
  const oneOf = <T extends string>(v: unknown, opts: readonly T[], dflt: T): T => (typeof v === "string" && (opts as readonly string[]).includes(v) ? (v as T) : dflt);
  // Validate a model-supplied funnel stage against the KNOWN set — findContacts uses `stage` as a
  // dynamic property key on each contact, so a hallucinated value ("hot", "closed", or worse a magic
  // key like "__proto__") would otherwise yield a garbage/wrong list instead of a clean no-op.
  const STAGES = ["messaged", "responded", "two_way", "agreed_to_meet", "met", "agreed_not_met", "not_responded"] as const;
  const stageArg = (v: unknown): ContactFilter["stage"] => (typeof v === "string" && (STAGES as readonly string[]).includes(v) ? (v as ContactFilter["stage"]) : undefined);
  // A pronoun / self reference ("her", "them", "me") names no one on its own — resolving it as a literal
  // name substring-matches a coincidental contact (a "her" inside "Sheridan"), briefing the WRONG person.
  // Defer to the grounded answer, which carries the person named earlier in the thread. Mirrors the
  // deterministic ABOUT-path guard so the LLM tool-route can't bypass it.
  const PRONOUN = /^(?:me|myself|i|her|him|them|it|that|this|they|he|she|us|those|these)\b/i;
  const named = (v: unknown): string | undefined => { const s = str(v); return s && !PRONOUN.test(s) ? s : undefined; };
  // A model-supplied company that ISN'T in the book (a mishearing / typo / hallucination) must NOT be run as a
  // filter — findContacts({company:"Meridian Consulting"}) returns an empty table narrated as an authoritative
  // "nothing at X". `UNKNOWN` sentinel = a company was supplied but matches nothing → the caller returns null so
  // answer() falls through to the grounded book path (which carries the near-name for a "did you mean …?").
  // Mirrors the keyword path's extractCompany guard.
  const companyInBook = (c: string): boolean =>
    d.contacts.some((x) => orgMatches(x.organisation, c)) || d.opps.some((o) => orgMatches(o.organisation, c)) || d.sows.some((s) => orgMatches(s.organisation, c));
  const UNKNOWN = Symbol("unknown-company");
  const filterCompany = (v: unknown): string | undefined | typeof UNKNOWN => { const s = str(v); return s === undefined ? undefined : companyInBook(s) ? s : UNKNOWN; };
  // Map a model-supplied engagement status (and its natural synonyms) to a canonical RevenueStatus. An
  // UNRECOGNISED word returns undefined (= all engagements) rather than exact-matching nothing and reporting a
  // confident zero for a quarter that actually has signed work ("executed"/"wrapped" used to zero-match).
  const CONTRACT_STATUS: Record<string, string> = {
    active: "Active", live: "Active", ongoing: "Active", current: "Active", signed: "Active", won: "Active", executed: "Active", running: "Active",
    completed: "Completed", complete: "Completed", done: "Completed", finished: "Completed", delivered: "Completed", wrapped: "Completed",
    paused: "Paused", "on hold": "Paused", held: "Paused",
    closed: "Closed", ended: "Closed", terminated: "Closed", cancelled: "Closed", canceled: "Closed",
  };
  const contractStatus = (v: unknown): string | undefined => { const s = str(v)?.toLowerCase(); return s ? CONTRACT_STATUS[s] : undefined; };
  switch (call.tool) {
    case "findContacts": {
      // A sector/function scope ("who do I know in energy", "finance leaders") lists that group ranked by
      // seniority — sector/function synonyms map here so the tool owns the mapping (LLM or regex router).
      const sec = matchSector(str(a.sector) || ""); if (sec) return sectorContacts(d, "sector_group", sec);
      const fn = matchFunction(str(a.function) || ""); if (fn) return sectorContacts(d, "function", fn);
      const co = filterCompany(a.company); if (co === UNKNOWN) return null;
      const stage = stageArg(a.stage);
      // A stage was ASKED for but isn't a real funnel stage ("uncontacted", "hot", "closed"): don't silently
      // drop the filter and dump the WHOLE network as if it were that subset. Fall through unless another
      // filter still narrows the result. (Absent stage — args:{} — is fine and returns all contacts.)
      if (str(a.stage) && !stage && !co && !a.decisionRole) return null;
      return findContacts(d, { company: co, stage, decisionRole: !!a.decisionRole });
    }
    case "findMeetings": {
      const dir = str(a.direction);
      const win = num(a.windowDays) ?? num(a.window_days);
      const range = dir === "upcoming" ? `upcoming${win ? ` ${win} days` : ""}`
        : dir === "past" ? (win ? `last ${win} days` : "last two weeks")
        : (str(a.range) || str(a.window) || "last two weeks");
      return findMeetings(d, today, range);
    }
    case "findOpportunities": {
      const sec = matchSector(str(a.sector) || ""); if (sec) return opportunitiesBySector(d, sec);
      const co = filterCompany(a.company); if (co === UNKNOWN) return null;
      return findOpportunities(d, { status: ["Open", "Won", "Lost"].includes(String(a.status)) ? (a.status as OppFilter["status"]) : "Open", company: co, minValue: num(a.minValue) });
    }
    case "findContracts": { const co = filterCompany(a.company); if (co === UNKNOWN) return null; return findContracts(d, { status: contractStatus(a.status), company: co, byValue: !!a.byValue }); }
    case "rankContacts": return rankContacts(d, oneOf(a.by, ["warmth", "cold"] as const, "warmth"), today);
    case "rankOpportunities": return rankOpportunities(d, oneOf(a.by, ["value", "probability", "risk"] as const, "value"));
    case "pipelineStats": return pipelineStats(d);
    case "pipelineAggregate": return pipelineAggregate(d, "", oneOf(a.metric, ["total", "weighted", "average", "gap"] as const, "total"));
    case "revenueAggregate": return contractsAggregate(d, "", oneOf(a.metric, ["total", "average", "largest"] as const, "total"));
    case "oppsWithoutMeeting": return openOppsWithoutMeeting(d);
    case "meetingsWithoutOpp": return meetingsWithoutOpp(d);
    case "accountsWithOppAndContacts": return companiesWithOppAndContacts(d, num(a.minContacts) ?? 2);
    case "contactsMetAtLeast": return contactsMetAtLeast(d, num(a.times) ?? 2);
    case "personalSnapshot": return personalSnapshot(d, today);
    case "weeklyFocus": return weeklyFocus(d, today);
    case "owedReplies": return owedReplies(d, today);
    case "latentOpportunities": return latentOpportunities(d);
    case "funnelBreakdown": return funnelBreakdown(d, str(a.dimension) === "function" ? "function" : str(a.dimension) === "seniority" ? "seniority" : "sector_group");
    // A pronoun/self name → null, so answer() falls through to the grounded book path (which resolves
    // the thread's actual person) instead of briefing a coincidental substring match.
    case "contactBrief": { const n = named(a.name) || named(a.contact); return n ? contactBrief(d, n, today) : null; }
    case "accountSummary": { const n = named(a.company) || named(a.name); return n ? accountSummary(d, n) : null; }
    default: return null;
  }
}

// Resolve a vague "my warmest lead" reference to the ACTUAL top contact (for drafts/briefs by name).
// Returns the record + last-meeting history so grounding can state she IS in the book with a relationship —
// otherwise the model resolves the name but, seeing no record, wrongly says "she's not in your contacts".
export function resolveWarmReference(text: string, d: BookData, today: string): { name: string; meta: string; stage: string; history: string } | null {
  if (!/\b(warmest|hottest|most engaged)\b/.test(text.toLowerCase())) return null;
  const lm = lastMeetingMap(d);
  const top = d.contacts.map((c) => ({ c, s: warmth(c, lm, today) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0];
  if (!top) return null;
  const last = lm.get(top.c.url);
  const history = last ? `last meeting ${last.date} (${last.sentiment})` : stageLabel(top.c).toLowerCase();
  return { name: fullName(top.c), meta: [top.c.position, top.c.organisation].filter(Boolean).join(" · "), stage: stageLabel(top.c), history };
}

// Cross-join grounding: your COLD contacts at companies where you ALSO have live work (an active engagement
// or an open opportunity). The 70B muddled this join free-hand (it's a filter+join, not a keyword lookup),
// so we compute it and hand it over as grounding. Returns "" when the query isn't this join or nothing matches.
export function joinGroundingText(question: string, d: BookData, today: string): string {
  const q = question.toLowerCase();
  const wantsJoin = /\bcold\b/.test(q) && /\b(engagement|opportunit|deals?|active|live work|already (?:have|work)|where i (?:also )?(?:have|work|run|do))\b/.test(q);
  if (!wantsJoin) return "";
  const norm = (s?: string) => (s || "").trim().toLowerCase();
  const work = new Map<string, string>(); // normalised org → a short description of the live work there
  const note = (org: string | undefined, desc: string) => { const k = norm(org); if (k && !work.has(k)) work.set(k, desc); };
  for (const s of d.sows) if ((s.status || "").toLowerCase() === "active") note(s.organisation, `an active engagement ("${s.engagement_name || "engagement"}")`);
  for (const o of d.opps) if (oppStatus(o) === "Open") note(o.organisation, `an open opportunity ("${oppDisplayName(o)}")`);
  if (!work.size) return "";
  const lm = lastMeetingMap(d);
  const upcoming = upcomingMeetingSet(d, today);
  const isCold = (c: Contact) => {
    const stalledEarly = (c.responded || c.two_way) && !c.met && !c.agreed_to_meet;
    const last = lm.get(c.url);
    return stalledEarly || (c.met && !!last && daysBetween(last.date, today) > 45 && !upcoming.has(c.url));
  };
  const rows: string[] = [];
  for (const c of d.contacts) {
    if (rows.length >= 20) break;
    const w = work.get(norm(c.organisation));
    if (w && isCold(c)) rows.push(`${fullName(c)} — ${c.position || "?"} at ${c.organisation} (you have ${w} there)`);
  }
  if (!rows.length) return "";
  return `\n\nComputed join — your COLD contacts at companies where you ALSO have live work. These are warm-account/cold-person openings: use the existing engagement as the natural reason to reconnect.\n${rows.join("\n")}`;
}

// Backend-aware CONFIDENTIALITY answer. A consultant's first question before trusting the tool with real
// client data is "can anyone see this / does it get sent to a server?" — and the honest answer depends on
// which AI model is connected, which the free-form model doesn't know (it wrongly promised "nothing is ever
// sent to a server" even while running on a cloud backend — a false privacy claim, the worst kind for a
// confidentiality product). So we answer it DETERMINISTICALLY and accurately from the live backend. Returns
// null when the message isn't a privacy question. `avail` is optional (the eval has no live backend → the
// general, still-accurate answer that covers both modes).
type Availability = { backend?: string; byok?: boolean; onDevice?: string };
// The canonical capabilities answer, in CODE (never the model) so it can't drift into a counsellor "what's
// weighing on you?" register or invent a random contacts table. Rendered when the LLM ROUTER classifies a
// message as "help" (a capability/meta question). LLM routes; code answers.
// A capability answer that (a) gives a SHORT, targeted reply when the question names a domain ("what can you
// do with meetings?"), and (b) varies its opener across general asks so a user probing a few times doesn't get
// the identical wall of text each time. Deterministic (opener chosen by a stable hash of the question, not
// RNG) so it stays testable. `text` optional — the eval / no-arg callers still get the full menu.
export function capabilitiesResult(text?: string): ComputeResult {
  const q = (text || "").toLowerCase();
  const AREAS: { key: RegExp; line: string }[] = [
    { key: /\b(meeting|meetings|call|calls|catch[- ]?up|spoke|speak|diary|calendar|schedule)\b/, line: "your **meetings & diary** — \"meetings last month\", \"who did I speak to\", \"what's in my diary\", \"log a meeting with Tom\"" },
    { key: /\b(opportunit\w*|deal|deals|pipeline|engagement\w*|revenue)\b/, line: "your **pipeline** — \"my open opportunities\", \"biggest deals by value\", \"which of my deals are at risk\", \"create an opportunity\"" },
    { key: /\b(contact\w*|network|know|people|lead|leads|relationship\w*)\b/, line: "your **network** — \"who do I know at EY\", \"my warmest leads\", \"who's gone cold\", \"add a contact\"" },
    { key: /\b(draft|write|compose|email|emails|follow[- ]?up|message|reply)\b/, line: "**drafting** — \"draft a follow-up to my warmest lead\", \"write an intro to Jane Doe\"" },
    { key: /\b(focus|priorit\w*|this week|plan|chase|next step|to-?do|agenda)\b/, line: "**what to focus on** — \"what should I focus on this week\", \"who should I chase\", \"any opportunities in my messages\"" },
  ];
  const hit = AREAS.find((a) => a.key.test(q));
  if (hit) {
    return { intro: `Yes — I can help with ${hit.line}.\nThat's one of a few things I do across your contacts, meetings, pipeline and messages (all on your machine). Want me to run one?`, columns: [], rows: [] };
  }
  const openers = [
    "I'm your book-of-business assistant — I work over your own contacts, meetings, opportunities and messages, all on your machine. Here's what I can do:",
    "Happy to help. I work entirely over your own book — contacts, meetings, pipeline and messages, on your machine. A few of the things I can do:",
    "Here's how I can help — all grounded in your own book, nothing leaves your machine:",
  ];
  const idx = q ? [...q].reduce((s, c) => s + c.charCodeAt(0), 0) % openers.length : 0;
  return {
    intro: [
      openers[idx],
      "- Find & summarise — \"who do I know at EY\", \"my open opportunities\", \"meetings last month\"",
      "- Rank & prioritise — \"who are my warmest leads\", \"who's gone cold\", \"who do I owe a reply to\"",
      "- Brief you before a call — \"brief me on Jane Doe\", \"what's my footprint at JPMorgan\"",
      "- Draft & log — \"draft a follow-up to my warmest lead\", \"log a meeting with Tom\", \"add a contact\"",
      "- Spot what matters — \"what should I focus on this week\", \"any opportunities in my messages\"",
      "Ask in your own words — what would help right now?",
    ].join("\n"),
    columns: [],
    rows: [],
  };
}
// Regex-gated wrapper — used ONLY on the error-fallback path (when the LLM router call failed), so a
// capability question still gets the right answer with no model available. Not a pre-router gate.
const CAPABILITY_Q = /\b(what can (?:you|it) (?:do|help)|what (?:do|can) you do|how (?:can|do) you help|what can you help (?:me )?with|what are you (?:able|capable)|what do you do|what('?s| is) your (?:job|purpose|role|function)|work[\s-]?wise)\b/i;
export function capabilitiesResponse(text: string): ComputeResult | null {
  if (!CAPABILITY_Q.test(text) || text.trim().split(/\s+/).length > 14) return null;
  return capabilitiesResult(text);
}

export function privacyResponse(text: string, avail?: Availability): ComputeResult | null {
  const t = text.toLowerCase();
  // NB: no "go/goes/going" — far too common ("going to help", "how's it going") and it false-triggered the
  // privacy card on ordinary messages. A genuine "where does my data go?" is caught by the explicit patterns below.
  const asksLeaves = /\b(sent|send|sends|leave|leaves|leaving|upload|uploaded|shar(?:e|ed|ing)|stor(?:e|ed|ing)|expose|leak|transmit)\b/.test(t);
  const dataOrServer = /\b(server|cloud|anyone (?:else )?(?:can )?see|third[- ]part|external|off[- ]?(?:my )?(?:device|machine)|my data|this data|my book|my contacts|client data|the data)\b/.test(t);
  const isPrivacyQ =
    (asksLeaves && dataOrServer) ||
    /\bis (?:this|it|my data|my book|everything) (?:private|confidential|secure|safe|encrypted)\b/.test(t) ||
    /\bwhere (?:does|do|will|would|is) .{0,45}?\b(go|goes|end up|get sent|is (?:it |this )?sent|processed|stored|live|reside)\b/.test(t) ||
    /\bcan anyone (?:else )?(?:see|access|read)\b/.test(t) ||
    /\bdoes (?:this|it|anything|that) (?:get |ever )?(?:sent|uploaded|shared|stored)\b/.test(t);
  if (!isPrivacyQ) return null;
  const onDevice = !!avail && (avail.backend === "webllm" || avail.backend === "builtin" || avail.backend === "ollama") && !avail.byok;
  const cloud = !!avail && (avail.byok || avail.backend === "byok");
  // The storefront demo runs a Freehold-HOSTED model (democloud) so a first visitor gets instant AI with no
  // download — which means the questions they type ARE sent to a Freehold server. Say so plainly; do NOT give
  // the on-device "nothing leaves" answer here.
  const demoHosted = !!avail && avail.backend === "democloud";
  const intro = demoHosted
    ? "This is a hosted demo running on sample data. The questions you type here are sent to a Freehold-hosted AI model to answer them — so please don't paste real client details into the demo. In the copy you own, the AI runs privately on your device (or on your own API key) and your book never leaves your machine."
    : onDevice
    ? "Everything stays on this device. Your book lives in your browser's local storage, and the AI model you're using runs locally too — so your question and your data never leave the machine, aren't sent to any server, and we never see them. Safe to put real client data in. (The one exception: if you ask something that needs a live web lookup, that search term is sent to the web-search provider — nothing else about your book goes with it.)"
    : cloud
      ? "Your book itself never leaves this device — it's held in your browser's local storage, never uploaded to us, and we store nothing on our servers. When you ask a question, only the slice needed to answer it (your question plus the relevant records) is sent to the AI model you connected with your own API key, so your own provider processes it under your account — not us, and no one else can see it. If you'd rather nothing leaves the machine at all, switch to an on-device model."
      : "Your book is stored locally in your browser — it's never uploaded to us and we keep nothing on our servers. What happens when you ask a question depends on which AI model you've connected: an on-device model keeps everything on this machine; a cloud model (your own API key) receives only your question plus the relevant records, processed under your own account. Either way we can't see your book, and no one else can.";
  return { intro, columns: [], rows: [] };
}

// Should this computed result get a follow-on LLM INTERPRETATION (the compute→interpret combo)? The tool
// already computed the ground-truth table; for anything analytical we then ask the model to read it and
// add guidance. We DON'T interpret when there's nothing to add: an empty result (the intro already
// explains the gap), or a bare count/lookup where the number IS the answer ("how many contacts do I
// have?") and an essay would just be noise. Everything else — rankings, breakdowns, pipeline stats,
// filtered lists, joins, aggregates, a person/account brief — gets the read. Shared by the app and the
// eval harness so both decide identically. (Tier/speed gating lives at the call site — capable backends
// only, so a slow on-device model never blocks the instant table.)
export function shouldInterpretResult(question: string, r: ComputeResult): boolean {
  if (!r.rows.length) return false;
  const q = question.toLowerCase();
  const analytical = /\b(at risk|priorit|warm|cold|biggest|largest|top|most|important|should|worth|why|analy|assess|doing enough|focus|next|strong|weak|gap|opportunit|pipeline|engaged|senior|expand)\b/.test(q);
  if (/^\s*(?:how many|how much|number of|count of|count)\b/.test(q) && !analytical) return false;
  return true;
}

// Flatten to Markdown — for persistence/history (rendered statically) and for deriving the chips.
export function computeText(r: ComputeResult): string {
  if (!r.rows.length) return r.intro;
  const head = `| ${r.columns.join(" | ")} |`;
  const sep = `| ${r.columns.map(() => "---").join(" | ")} |`;
  const body = r.rows.map((row) => `| ${row.cells.join(" | ")} |`).join("\n");
  const more = r.more ? `\n\n_${r.more.count} in total — open the ${r.more.tab} tab to see them all._` : "";
  return `${r.intro}\n\n${head}\n${sep}\n${body}${more}`;
}
