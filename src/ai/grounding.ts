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
import { oppDisplayName } from "../data/opportunities";
import { personalRegister, crisisSignal } from "./intents";

// TOPIC-GATE. For a turn that DIDN'T resolve to a deterministic tool (computeForQuery returned null), decide
// how to handle it — the fix for the copilot treating "I feel sad" as a pipeline problem and dumping a
// contact card. "crisis" → the deterministic safety floor (no model). "companion" → the warm general
// companion, with NO book records injected (personal, an idea, a decision, code, their day). "book" → a
// grounded question or piece of advice about their ACTUAL book (names a real contact/company, or explicitly
// asks about their pipeline/outreach) → the grounded book path. Personal register always wins over a stray
// book keyword ("my boss keeps booking meetings" stays companion — "boss" isn't a contact, "meetings" alone
// isn't enough). Runs on every tier — the gate is deterministic so even a tiny model can't fumble it.
// A first-person LIFE / CAREER decision ("turning down EY", "should I take the Saudi job", "torn between",
// "go all in") is a personal conversation even when it names a company in their book — the decision is about
// THEIR life, not a book record. Distinct from a book-advisory question ("should I chase the Merck deal"),
// which is about a record and stays on the grounded path. Keeps a career deliberation in the companion.
const LIFE_DECISION = /\b(turn(?:ing)? (?:it |them |the (?:job|offer|role) )?down|walk(?:ing)? away from|go(?:ing)? all[- ]in|give (?:it |everything |this )?up|quit(?:ting)?|hand in my notice|should i (?:take|accept|leave|quit|stay|resign|move to|relocate|go for|say yes to)|thinking (?:of|about) (?:leaving|quitting|moving|resigning|jacking)|torn between|i'?ve decided(?:\s+to)?\s+(?:quit|leave|resign|take|accept|move|relocate|go for|stay|not to|against|hand in)|made up my mind|big (?:life |career )?decision|life decision|career (?:decision|move|change|crossroads)|whether to (?:take|accept|leave|quit|stay|go))\b/i;

// A bare greeting / pleasantry (the WHOLE message is one) → small talk, never a book search. Without this,
// "Hello" falls through to searchBook and matches any company containing "hello" (Hello Charlie, HelloReport
// …), so a simple hello dumps the user's network at them. Anchored ^…$ so real queries ("who do I know at
// Hello?") still route to the book.
const SMALL_TALK = /^\s*(hi+|hey+|hello+|hiya|yo|howdy|sup|greetings|(good\s+)?(morning|afternoon|evening)|(hi|hey|hello)\s+there|how\s+are\s+(you|things|we)|how'?s\s+(it\s+going|things|life)|what'?s\s+up|thank(s| you)|cheers|nice to (meet|see) you)[\s!.,?’']*$/i;

// BUSINESS-DEVELOPMENT / book intent — the WHOLE POINT of the product. Clients, leads, prospects,
// opportunities, pipeline, "who should I reach out to", "help me find clients", "analyse my book". These
// must GROUND on the user's data (the book path), even mid-companion-thread — otherwise the copilot gives
// generic ChatGPT advice and asks the user who their clients are, defeating why they bought it. Runs before
// personalRegister + the companion-stickiness so a BD ask always beats "keep it personal". (Genuine life/
// career decisions are caught by LIFE_DECISION above and stay personal; pure emotion has no BD nouns.)
const BOOK_INTENT = /\b(clients?|customers?|leads?|prospects?|opportunit\w*|pipelines?|book of business|my (book|network|contacts?|deals?|leads?|clients?|prospects?|pipeline|meetings?))\b|\bwho are my\b|\banaly[sz]e (?:my |the )?(?:book|network|pipeline|contacts?|clients?)\b|\breach(?:ing)? out\b|\b(?:who|anyone|anybody|someone)\s+(?:i\s+(?:should|could|can|need to|ought to|might)|to)\b|\bwho (?:else )?(?:do|should|can|could) i (?:know|contact|target|approach|reach|prioriti[sz]e)\b|\b(?:talk|do|get to|back to|crack on(?: with)?|focus on|down to) (?:some )?(?:business|work|shop)\b|\btalk shop\b|\blet'?s (?:work|get (?:to |cracking|down to )?work|talk (?:business|shop)|do (?:some )?work|get (?:down to|cracking|started))\b|\b(?:my |our )?(?:history|relationship|dealings|track record|rapport|connection) with\b|\bhow (?:do|did|well do) i know\b|\b(?:brief|prime|fill me in|catch me up|prep) (?:me )?(?:on|for|about)\b|\b(?:strongest|warmest|closest|best|top|key) (?:contact|lead|relationship|client|connection)\b/i;

// Oblique / idiomatic BD phrasings the narrow BOOK_INTENT missed — the personal floor was swallowing real
// pipeline questions ("where am I leaking deals?", "what's ready to close?", "who have I not contacted?",
// "what's stuck at proposal?", "any big fish I'm ignoring?"). Every branch is BD-ANCHORED (a sales-world
// noun/verb/idiom), so a genuinely personal/emotional message ("I'm stuck", "I've gone quiet lately") still
// falls through to the companion path. Checked ALONGSIDE BOOK_INTENT in both gates below.
const BD_EXTRA = new RegExp([
  "\\b(deals?|accounts?|engagements?|proposals?|contracts?|contracted|funnel|quota|sectors?)\\b",
  "\\bwin[- ]?rate\\b",
  "\\b(?:ready|about|going)\\s+to\\s+close\\b",
  "\\bclos(?:e|ing)\\s+(?:the\\s+|a\\s+|my\\s+|this\\s+)?deals?\\b",
  "\\bclose\\s+rate\\b",
  "\\b(?:stuck|stalled)\\s+(?:at|in the)\\b",
  "\\b(?:gone|going|went)\\s+(?:cold|quiet|dark)\\b",
  "\\bbig fish\\b",
  "\\ball talk\\b",
  "\\bleak\\w*\\s+(?:deals?|revenue|pipeline)\\b",
  "\\bwho\\s+(?:have|has|did|do|should|can|could|else)?\\s*i?\\s*(?:not\\s+)?(?:contacted?|met|meet|spoke(?:n)?|speak|called?|reach(?:ed)?|nudged?|chas(?:e|ed)|followed?\\s*up|prioriti[sz]ed?|targeted?|approach(?:ed)?)\\b",
  "\\bwho\\s+(?:to|should i|do i|can i|could i)\\s+(?:call|chase|nudge|prioriti[sz]e|target|approach|reach|contact|follow up)\\b",
  "\\bmy\\s+(?:priorit\\w+|quota|targets?|numbers?)\\b",
].join("|"), "i");

export function conversationPath(text: string, d: BookData, prevCompanion = false): "crisis" | "companion" | "book" {
  if (crisisSignal(text)) return "crisis";
  if (SMALL_TALK.test(text)) return "companion";
  if (LIFE_DECISION.test(text)) return "companion"; // a life/career decision stays personal even if it names a company
  if (BOOK_INTENT.test(text) || BD_EXTRA.test(text)) return "book"; // BD/book asks GROUND on data — beats personal register + stickiness
  if (personalRegister(text)) return "companion";
  // An EXPLICIT book request ("brief me on X", "my pipeline", "the Merck deal", "status of…") always pulls
  // to the grounded path — even mid-conversation.
  const explicitBook = /\b(my pipeline|my deals?|my opportunit|my contacts?|my network|my book|my leads?|my meetings?|my engagements?|who do i know|book of business|follow[- ]?up with|reach out to|draft (?:a |an )?(?:note|message|email|follow|intro|reply)|brief me on|log (?:a |an )?(?:meeting|opportunit|contact)|prep me for|account plan|status (?:of|on)|the \w+ (?:deal|opportunit(?:y|ies)|account|engagement))\b/i.test(text);
  if (explicitBook) return "book";
  // STICKINESS: once we're in a companion conversation, a follow-up that merely MENTIONS a book entity
  // ("part of me thinks I'm mad to turn down EY") must not yank them back to grounded mode mid-thread — only
  // an explicit book request (above) does. This keeps a personal thread personal even when it names their
  // employer / a company they know. A fresh turn (no companion context) still routes on the entity.
  if (prevCompanion) return "companion";
  const g = searchBook(text, d);
  return g && !g.empty ? "book" : "companion";
}

// HIGH-CONFIDENCE personal/emotional register — the subset of conversationPath's "companion" verdict
// that stands on the message ALONE (no book data, no conversation stickiness): small talk, an explicit
// life/career decision, or a personal/emotional register — and, exactly as in conversationPath, ONLY
// when there's no competing BD/book intent (a business-development ask, even one worded emotionally,
// keeps grounding on the user's data). Deliberately EXCLUDES conversationPath's ambiguous fall-through
// (empty-search default → companion) and stickiness, so genuinely ambiguous / capability / tool queries
// still reach the LLM router. Used as a DETERMINISTIC pre-router floor alongside the crisis floor: a
// clearly personal message is caught BEFORE the LLM router, so a tiny on-device model can't misroute
// "work is grinding me down" into a pipeline/book answer. (crisis is handled separately by the caller.)
export function clearlyPersonal(text: string): boolean {
  if (BOOK_INTENT.test(text) || BD_EXTRA.test(text)) return false;
  return SMALL_TALK.test(text) || LIFE_DECISION.test(text) || personalRegister(text);
}

export type Hit = { id: string; main: string; meta: string };
export type Company = { org: string; count: number };
export type Groups = { people: Hit[]; companies: Company[]; meetings: Hit[]; opps: Hit[]; contracts: Hit[]; empty: boolean };

// Tokenise for matching — apostrophes/punctuation FOLDED OUT first ("O'Connor" → "oconnor"), so a name typed
// with an apostrophe matches the stored "OConnor". Word-PREFIX match (so "EY" hits EY, not Foley).
// POSSESSIVE-aware: strip a trailing "'s" first ("Wright's" → "wright", so "what's Amelia Wright's salary?"
// still resolves the contact — a very common phrasing that otherwise left the last-name token as "wrights"
// and made the model deny a real contact), THEN fold out remaining apostrophes ("O'Connor" → "oconnor").
const tokenize = (s: string) => s.toLowerCase().replace(/['’]s\b/g, "").replace(/['’]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
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

// For each person the message NAMES, state plainly they ARE in the book and attach their relationship state,
// last meeting (real date + sentiment) and any related opportunity. This is what stops the model flip-
// flopping — declaring a real contact "not in your book", then finding them a turn later — and stops it
// inventing or disclaiming a meeting date: it references the REAL one every time. Consistency, not just
// existence: the same named person yields the same grounded facts on every turn.
function personDetailGrounding(people: Hit[], d: BookData): string {
  if (!people.length) return "";
  const lines = people.map((p) => {
    const c = d.contacts.find((x) => x.url === p.id);
    if (!c) return `${p.main}${p.meta ? ` (${p.meta})` : ""}`;
    const held = d.meetingRows
      .filter((m) => m.contact_url === c.url && m.meeting_stage === "Held")
      .sort((a, b) => (b.date_held || "").localeCompare(a.date_held || ""));
    const stage = c.met ? "you've met them" : c.agreed_to_meet ? "agreed to meet, not met yet"
      : c.two_way ? "two-way contact" : c.responded ? "replied, no meeting yet"
      : c.messaged ? "messaged, no reply yet" : "not contacted yet";
    const last = held.length
      ? `; last meeting ${held[0].date_held}${held[0].sentiment ? ` (${held[0].sentiment})` : ""}${held.length > 1 ? `, ${held.length} meetings in total` : ""}`
      : "; no meeting logged";
    const opp = d.opps.find((o) => o.contact_url === c.url)
      || d.opps.find((o) => !!o.organisation && !!c.organisation && o.organisation.toLowerCase() === c.organisation.toLowerCase());
    const oppTxt = opp ? `; related opportunity "${oppDisplayName(opp)}"` : "";
    return `${c.first} ${c.last} — ${c.position || "?"} at ${c.organisation || "?"} (${stage}${last}${oppTxt})`;
  });
  return `\n\nThese people ARE in the user's book — treat each as a known contact (never say they're not in the book), and use these exact facts (their real relationship state and real meeting dates):\n${lines.join("\n")}`;
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
  const named = mergeGroups(searchBook(question, d), convo ? searchBook(entityText, d) : null);
  g += groundingFromGroups(named);
  // …and for the PEOPLE named, attach their full relationship state + real meeting dates, so the model is
  // consistent about who's in the book and never invents/disclaims a meeting it can look up right here.
  g += personDetailGrounding(named?.people ?? [], d);
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
