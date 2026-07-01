// Shared GROUNDING assembly — the records we hand the model for a question. Lives OUTSIDE the React layer
// (was buried in CopilotBar) so the eval harness tests the REAL grounding, not an approximation. Layers:
//   1. assembleContext — the budget-scaled book summary + a relevant-record slice (bookContext.ts).
//   2. named-entity injection — the exact people/companies/meetings/opps the message NAMES (searchBook),
//      APOSTROPHE-ROBUST so "Rachel O'Connor" resolves to the stored "Rachel OConnor" (was the #1 trust bug:
//      the model declared real contacts non-existent).
//   3. criteria retrieval — when the message asks by SECTOR or FUNCTION ("the people I know in banking"),
//      inject the matching contacts, so the model reasons over the RIGHT subset, not a random slice.
// (The app layers cross-chat memory + any uploaded doc on top — those are app-state, not book data.)
import type { BookData } from "./bookContext";
import { assembleContext } from "./bookContext";
import { resolveWarmReference, joinGroundingText } from "./compute";

export type Hit = { id: string; main: string; meta: string };
export type Company = { org: string; count: number };
export type Groups = { people: Hit[]; companies: Company[]; meetings: Hit[]; opps: Hit[]; contracts: Hit[]; empty: boolean };

// Tokenise for matching — apostrophes/punctuation FOLDED OUT first ("O'Connor" → "oconnor"), so a name typed
// with an apostrophe matches the stored "OConnor". Word-PREFIX match (so "EY" hits EY, not Foley).
const tokenize = (s: string) => s.toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
// Question/command words dropped from the QUERY so a full sentence still resolves the entity it names —
// "What do I know about Rachel O'Connor?" must match the contact, not require "what/do/i/know/about" to match
// it too. (Only the query is filtered; the haystack keeps every word.) Deliberately function-words only —
// never business terms like "open"/"next"/"capital" that could be part of a real name.
const QUERY_STOP = new Set(["what", "who", "whom", "which", "where", "when", "why", "how", "do", "does", "did", "i", "me", "my", "mine", "you", "your", "is", "are", "am", "was", "were", "be", "the", "a", "an", "about", "tell", "told", "know", "knew", "show", "find", "give", "list", "pull", "get", "of", "on", "at", "in", "for", "to", "with", "and", "or", "that", "this", "these", "those", "can", "could", "would", "should", "will", "up", "everyone", "anyone", "someone", "somebody", "people", "person", "got", "have", "has", "had", "there", "their", "them", "they", "it", "also", "just", "please", "like", "look", "need", "want"]);

export function searchBook(q: string, d: BookData): Groups | null {
  const qTokens = tokenize(q).filter((t) => !QUERY_STOP.has(t));
  if (!qTokens.length) return null;
  // Match by whether the ENTITY's name appears in the message — NOT whether every message word matches the
  // entity. The old direction (every query token must match one record) broke the moment a name was embedded
  // in a sentence ("I just had a meeting with Amelia Wright about a finance project") — the extra words meant
  // no record matched and the model was wrongly told a real contact didn't exist. This direction is robust:
  // a contact hits when BOTH its name tokens are somewhere in the message; a company when all its name tokens
  // are (so "Boeing" and "JPMorgan Chase" resolve inside a long multi-part ask).
  const qSet = new Set(qTokens);
  const allIn = (s: string) => { const t = tokenize(s); return t.length > 0 && t.every((x) => qSet.has(x)); };
  const nameHit = (first: string, last: string) => { const f = tokenize(first)[0], l = tokenize(last)[0]; return !!f && !!l && qSet.has(f) && qSet.has(l); };

  const people: Hit[] = [];
  for (const c of d.contacts) {
    if (people.length >= 6) break;
    if (nameHit(c.first, c.last)) people.push({ id: c.url, main: `${c.first} ${c.last}`.trim(), meta: [c.position, c.organisation].filter(Boolean).join(" · ") });
  }
  const orgCount = new Map<string, number>();
  for (const c of d.contacts) { const o = c.organisation?.trim(); if (o && allIn(o)) orgCount.set(o, (orgCount.get(o) || 0) + 1); }
  const companies: Company[] = [...orgCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([org, count]) => ({ org, count }));

  const meetings: Hit[] = [];
  for (const r of d.meetingRows) {
    if (meetings.length >= 4) break;
    const [mf, ml] = String(r.contactInfo.name).split(/\s+/);
    if (mf && ml && nameHit(mf, ml)) meetings.push({ id: r.id, main: `${r.contactInfo.name} · #${r.meeting_no}`, meta: r.meeting_stage || "—" });
  }
  const oppsHits: Hit[] = [];
  for (const o of d.opps) {
    if (oppsHits.length >= 4) break;
    if (o.organisation && allIn(o.organisation)) oppsHits.push({ id: o.id, main: o.opportunity_name || "(unnamed)", meta: o.organisation || "—" });
  }
  const contracts: Hit[] = [];
  for (const s of d.sows) {
    if (contracts.length >= 3) break;
    if (s.organisation && allIn(s.organisation)) contracts.push({ id: s.id, main: s.engagement_name || "(unnamed)", meta: s.organisation || "—" });
  }
  const empty = !people.length && !companies.length && !meetings.length && !oppsHits.length && !contracts.length;
  return { people, companies, meetings, opps: oppsHits, contracts, empty };
}

export function groundingFromGroups(g: Groups | null): string {
  if (!g || g.empty) return "";
  const lines: string[] = [];
  if (g.people.length) lines.push("People: " + g.people.map((h) => `${h.main}${h.meta ? ` (${h.meta})` : ""}`).join("; "));
  if (g.companies.length) lines.push("Companies: " + g.companies.map((c) => `${c.org} (${c.count})`).join("; "));
  if (g.meetings.length) lines.push("Meetings: " + g.meetings.map((h) => `${h.main} — ${h.meta}`).join("; "));
  if (g.opps.length) lines.push("Opportunities: " + g.opps.map((h) => `${h.main} (${h.meta})`).join("; "));
  if (g.contracts.length) lines.push("Engagements: " + g.contracts.map((h) => `${h.main} (${h.meta})`).join("; "));
  return lines.length ? `\n\nRecords in your book matching this message:\n${lines.join("\n")}` : "";
}

// ── criteria retrieval (sector / function) ──────────────────────────────────────────────────────────
// Sector words checked first (a clear industry), then function words. "in banking" → Financial Services;
// "finance roles" → Finance & Accounting function. Maps to the contact's sector_group / function fields.
// The keyword maps live in data/criteria.ts so the deterministic router (compute.ts) uses the SAME mapping.
import { SECTOR_KEYWORDS, FUNCTION_KEYWORDS } from "../data/criteria";
const SENIORITY_RANK: Record<string, number> = { "Executive Leadership": 5, "Head of / Director": 4, "VP / SM": 3, "Manager": 2, "Associate / Analyst": 1 };

export function criteriaGrounding(question: string, d: BookData): string {
  const q = question.toLowerCase();
  let field: "sector_group" | "function" | "" = "", value = "";
  for (const [re, sec] of SECTOR_KEYWORDS) if (re.test(q)) { field = "sector_group"; value = sec; break; }
  if (!field) for (const [re, fn] of FUNCTION_KEYWORDS) if (re.test(q)) { field = "function"; value = fn; break; }
  if (!field) return "";
  const matches = d.contacts.filter((c) => ((c as unknown as Record<string, string>)[field] || "") === value);
  if (!matches.length) return "";
  const ranked = matches.sort((a, b) => (SENIORITY_RANK[b.seniority] || 0) - (SENIORITY_RANK[a.seniority] || 0)).slice(0, 30);
  const lines = ranked.map((c) => `${`${c.first} ${c.last}`.trim()} — ${c.position || "?"} at ${c.organisation || "?"}${c.seniority ? ` · ${c.seniority}` : ""}`);
  return `\n\nYour contacts in ${value} (the most senior ${ranked.length} of ${matches.length}) — for this ${field === "sector_group" ? "sector" : "function"} question, choose ONLY from these (never invent others):\n${lines.join("\n")}`;
}

// The full data grounding for a question. The app adds memory + uploaded-doc context on top of this.
// `convo` = the last couple of turns' text. Entity resolution runs over the current message AND that recent
// context, so a follow-up that only says "make it more formal" or "prep me for a meeting with her" still
// carries the person named a few turns back — otherwise the model finds no record for THIS turn and wrongly
// declares a real contact "not in your book" (the #1 multi-turn failure). Query-shaped grounding
// (sector/function/join/warmest-trigger) keys off the current message; entity carry keys off both.
export function assembleGrounding(question: string, d: BookData, charBudget: number, today: string, convo = ""): string {
  let g = assembleContext(question, d, charBudget, today);
  const entityText = convo ? `${question}\n${convo}` : question;
  // Resolve names from the current message FIRST (priority), then top up from recent context — so the active
  // entity leads and we don't crowd it out with everyone mentioned earlier in the thread.
  g += groundingFromGroups(mergeGroups(searchBook(question, d), convo ? searchBook(entityText, d) : null));
  g += criteriaGrounding(question, d);
  g += joinGroundingText(question, d, today);
  const warm = resolveWarmReference(entityText, d, today);
  if (warm) g += `\n\nResolved reference — "my warmest lead" is ${warm.name}, who IS a contact in your book: ${warm.meta} · ${warm.history}. Treat them as a known relationship (do not say they aren't in the book); address anything about "my warmest lead" to ${warm.name} by name, using this history.`;
  return g;
}

// Merge two searchBook results, PRIMARY first (deduped by id), so current-message hits lead recent-context
// hits. Keeps the per-group caps so grounding stays compact.
function mergeGroups(primary: Groups | null, secondary: Groups | null): Groups | null {
  if (!secondary || secondary.empty) return primary;
  if (!primary || primary.empty) return secondary;
  const dedupe = <T extends { id: string }>(a: T[], b: T[], cap: number) => {
    const seen = new Set(a.map((x) => x.id));
    return [...a, ...b.filter((x) => !seen.has(x.id))].slice(0, cap);
  };
  const orgSeen = new Set(primary.companies.map((c) => c.org));
  return {
    people: dedupe(primary.people, secondary.people, 6),
    companies: [...primary.companies, ...secondary.companies.filter((c) => !orgSeen.has(c.org))].slice(0, 6),
    meetings: dedupe(primary.meetings, secondary.meetings, 4),
    opps: dedupe(primary.opps, secondary.opps, 4),
    contracts: dedupe(primary.contracts, secondary.contracts, 3),
    empty: false,
  };
}
