// The global "ask / search your book" copilot. ONE box that, on submit, always does both: it surfaces
// any matching records from the book (instant, deterministic) AND answers in natural language grounded
// in a factual summary of the whole book — no "Ask AI" button, no "Search web" button. When the search
// capability is enabled (account/product settings), the chat itself decides from the question whether a
// web lookup would help and folds the results into the answer (citing the sources). Three views:
//   • SEARCH: live record matches as you type; Enter submits a question.
//   • CHAT: the conversation, with the composer at the BOTTOM; each answer shows related records/sources.
//   • HISTORY: every past conversation, saved — pick one to reload and continue.
// Read/query only — no bulk or destructive writes (9a). Opens from the top bar (Search or Chats).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { loadContacts, type Contact } from "../data/contacts";
import { loadAllMeetings } from "../storage/meetings";
import { buildMeetingRows, type MeetingRow } from "../data/meetings";
import { loadAllOpportunities, type Opportunity } from "../storage/opportunities";
import { loadAllSows, type Sow } from "../storage/revenue";
import { todayISO } from "../data/agenda";
import { isCommonOrgToken } from "../data/orgTokens";
import { useAiAvailable, aiAvailability, aiPromptStream, aiJson, searchAvailable, searchWeb, searchEntity, useAiBackend, isCapableBackend, capabilityLevel, shortModelName, aiCapabilities } from "../ai/ai";
import { BusinessBookLogo } from "./Brand";
import { askBookPrompt, suggestionsPrompt, routerPrompt, distilMemoryPrompt, interpretResultPrompt, companionPrompt, CRISIS_RESPONSE, type ChatTurn, type RouteResult } from "../ai/prompts";
import { type BookData } from "../ai/bookContext";
import { computeForQuery, computeExact, computeText, runTool, shouldInterpretResult, privacyResponse, capabilitiesResponse, capabilitiesResult, type ComputeResult } from "../ai/compute";
import { searchBook, assembleGrounding, conversationPath, clearlyPersonal, type Groups, type Hit } from "../ai/grounding";
import { formatTokens } from "../data/format";
import { subscribeWarmth, getWarmthState, isAnalysisRunning, pauseWarmthAnalysis } from "../ai/warmthTask";
import { ComputeTable } from "./ComputeTable";
import { contextBudget } from "../ai/contextBudget";
import { routeIntent, isActionIntent, heavyDistress, crisisSignal } from "../ai/intents";
import { track, lenBucket } from "../lib/analytics";
import { SPECS, matchContacts, matchOpportunity, extractSubjectSpan } from "../ai/actions/actionSpecs";
import { readDoc, type LoadedDoc } from "../ai/docs";
import { ActionCard, type ActionCardData } from "./ActionCard";
import { Markdown } from "./Markdown";
import { listChats, getChat, saveChat, deleteChat, newChatId, titleFromTurns, type SavedChat, type StoredTurn } from "../storage/chats";
import { relevantNotes, addNotes, listNotes, deleteNote, clearNotes, type Note } from "../storage/memory";
import { markBusy, markDone, isBusy, subscribeInflight } from "../ai/inflight";
import type { Navigate, TabId, TabIntent } from "./TabNav";
import "./CopilotBar.css";

// Default typeahead lists for action-card fields (all still free-text). Locations cover common business
// hubs + countries; next-actions are the deterministic moves a consultant logs against a contact.
const COMMON_LOCATIONS = [
  "London", "New York", "San Francisco", "Boston", "Chicago", "Los Angeles", "Washington DC", "Toronto",
  "Dublin", "Paris", "Frankfurt", "Berlin", "Munich", "Amsterdam", "Zurich", "Geneva", "Madrid", "Milan",
  "Stockholm", "Copenhagen", "Dubai", "Singapore", "Hong Kong", "Tokyo", "Sydney", "Mumbai", "Bangalore",
  "United Kingdom", "United States", "Canada", "Ireland", "France", "Germany", "Netherlands", "Switzerland",
  "Spain", "Italy", "Sweden", "UAE", "Singapore", "Australia", "India", "Japan",
];
const NEXT_ACTIONS = ["Call", "Email", "Send a proposal", "Schedule a meeting", "Follow up", "Make an introduction", "Send information", "Check in", "Reconnect"];

type View = "search" | "chat" | "history" | "memory";

// A record/company/web link surfaced alongside an answer. A "view" is a clickable jump to a filtered
// list on a record tab — for "list everyone who…" questions, far more reliable than the model trying to
// enumerate the whole list in prose (which on a small model drifts and invents names).
type RelatedHit =
  | { kind: "record"; tab: TabId; id: string; main: string; meta: string }
  | { kind: "company"; org: string; main: string; meta: string }
  | { kind: "view"; tab: TabId; intent: TabIntent; main: string; meta: string }
  | { kind: "web"; url: string; main: string; meta: string };
// A chat turn as shown in the UI — a persisted you/ai message (with optional related links), or a
// transient "action" turn carrying a propose→confirm card (not persisted).
type Chip = { label: string; prompt: string };
type UITurn = { role: "you" | "ai" | "action"; text: string; related?: RelatedHit[]; action?: ActionCardData; undo?: () => void; chips?: Chip[]; compute?: ComputeResult; genMs?: number; genTok?: number; receipt?: boolean };

// Rough token estimate for the live/after "N tokens" readout (we don't get exact counts mid-stream).
const approxTokens = (s: string) => Math.max(1, Math.round((s || "").length / 4));
// Web snippets arrive with raw HTML entities (&#039; &amp;) — decode without touching the DOM (no innerHTML).
function decodeEntities(s: string): string {
  return (s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ");
}

// First-token stall watchdog. Rejects only if the model produces NO first token within `baseMs` — but
// while a model DOWNLOAD is actively in progress (first-time WebLLM fetch can take minutes), it keeps
// pushing the deadline out, so a legitimate big download never trips the "took too long" fallback.
// `onStall` fires just before it rejects (to flag the caller's `bailed` guard).
function firstTokenStall(stillFirstTok: () => boolean, downloading: () => boolean, onStall: () => void, baseMs = 60_000): Promise<never> {
  return new Promise<never>((_, reject) => {
    let deadline = Date.now() + baseMs;
    const tick = () => {
      if (!stillFirstTok()) return; // first token arrived → the stream wins the race; stop watching
      if (downloading()) deadline = Date.now() + baseMs; // still downloading, not stalled → reset
      if (Date.now() >= deadline) { onStall(); reject(new Error("model-timeout")); return; }
      setTimeout(tick, 2_500);
    };
    setTimeout(tick, 2_500);
  });
}

// searchBook + groundingFromGroups now live in ../ai/grounding (shared with the eval harness).

// Tokens to ignore when matching a company name (so "JPMorgan Chase" matches on "jpmorgan", and a
// distinctive token is enough rather than requiring every word).
const ORG_STOP = new Set(["of", "the", "and", "for", "group", "inc", "llc", "ltd", "co", "plc", "corp", "corporation", "company", "partners", "global", "services", "holdings"]);
// The stable COMMAND/query stoplist: verbs + query words that must NOT trigger a company match on their own
// (so "List my OPEN opportunities" doesn't match "Open Text", or "chase up" doesn't match "JPMorgan Chase").
// This list is small and stable because it's about ENGLISH/command vocabulary, not org names — the org-COMMON
// words (bank/group/financial/university…) are now DERIVED from the org dictionary by frequency in
// data/orgTokens.ts (COMMON_ORG_TOKENS), so they stay current without hand-maintenance. The org-name entries
// kept below are a deliberate safety net for words that are BOTH common prose AND org tokens.
const ORG_NOISE = new Set([
  "open", "new", "all", "my", "your", "list", "show", "find", "get", "pull", "who", "what", "which", "recent",
  "active", "current", "top", "best", "warm", "cold", "last", "this", "next", "any", "some", "people", "contact",
  "contacts", "meeting", "meetings", "opportunity", "opportunities", "deal", "deals", "pipeline", "network", "text",
  "data", "world", "first", "national", "american", "united", "civil", "service", "energy", "capital", "health", "care",
  "one", "two", "sector", "sectors", "report", "summary", "weighted", "industry", "across", "between",
  // Common words that appear in org names AND ordinary prose — must not single-handedly match a company
  // (e.g. "growing your business" → "Department for Business and Trade").
  "business", "trade", "department", "bank", "financial", "international", "solutions", "systems",
  "technologies", "consulting", "advisory", "management", "ventures", "media", "digital", "associates",
  "enterprises", "industries", "securities", "insurance", "markets", "british", "european", "federal",
  // Institutional / generic words that recur across many org names (so "University of Oxford" in an answer
  // can't match the unrelated "Harvard University", nor "chase up" match "JPMorgan Chase"). The org still
  // matches on its DISTINCTIVE token (oxford / jpmorgan) — just not on these.
  "university", "universities", "college", "institute", "institutes", "school", "schools", "academy",
  "foundation", "hospital", "council", "office", "agency", "authority", "ministry", "association",
  "society", "centre", "center", "chase", "general", "standard", "central", "metropolitan",
]);

// Find book ENTITIES named anywhere in the message — companies and people — even when the literal
// full-text search misses (e.g. "show me everyone at EY"). A records request should always yield
// something clickable: the company card opens that account; a person card deep-links to the contact.
// Normalise for name matching: drop apostrophes, fold non-alphanumerics to spaces ("O'Connor" → "oconnor").
const nameNorm = (s: string) => s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
// Everyday / conversational words that must NOT drive a company-card match — a company whose name merely
// CONTAINS one of these ("Cook Book", "Before Smiles Talk Show", "About You") was surfacing off a stray
// word in ordinary chat ("can we talk about my book"). Distinctive names (Deloitte, EY, TaxValet) aren't
// here, so they still match. Function words + generic content words only — never brandable nouns.
const CHATTY_STOP = new Set([
  "the","a","an","and","or","but","if","so","of","to","in","on","at","for","with","from","by","about","as","into","over","after","before","up","down","out","off",
  "i","me","my","mine","we","us","our","you","your","he","she","it","its","they","them","their","this","that","these","those","who","whom","what","which","when","where","why","how",
  "is","are","am","was","were","be","been","being","do","does","did","done","have","has","had","can","could","would","should","will","shall","may","might","must","let","lets",
  "not","no","yes","yeah","ok","okay","just","really","very","too","also","then","now","here","there","some","something","anything","everything","nothing","any","all","more","most","much","many",
  "talk","talking","show","tell","think","thinking","know","feel","feeling","chat","help","today","tomorrow","time","day","work","working","book","books","thing","things","stuff","idea","ideas","people","person","want","like","need","make","making","get","got","go","going","say","said","good","great","nice","happy","sad","lonely","food","friend","friends","life","hope","maybe","sure","thanks","thank","please","sorry","hello","hi","hey",
  "business","professional","professionals","company","companies","industry","market","world","body","challenge","challenges","opportunity","opportunities","area","areas","specific","currently","dealing","facing",
  // Ordinary words that ALSO happen to be (part of) a one-off company name in a big book — matched junk orgs
  // like "In Kind Direct" / "Together — loans" / "Ready Event & Creative" from casual phrasing. Stop them.
  "kind","together","ready","creative","event","events","self","employed","open","role","crack","cracks","start","started","begin",
]);
function entityHits(text: string, d: BookData): RelatedHit[] {
  const msg = new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !CHATTY_STOP.has(w)));
  if (!msg.size) return [];
  const lowText = " " + nameNorm(text) + " ";
  const people: RelatedHit[] = [];
  // People FIRST, matching the FULL name CONTIGUOUSLY ("Richard Murphy" must appear together) — not just
  // both tokens anywhere, which would stitch "Richard" (Murphy) + "Moore" (John) into a fake "Richard
  // Moore". Claim each matched name's tokens so a surname can't then trigger a same-named company.
  const claimed = new Set<string>();
  for (const c of d.contacts) {
    if (people.length >= 4) break;
    const first = (c.first || "").toLowerCase(), last = (c.last || "").toLowerCase();
    const full = nameNorm(`${first} ${last}`);
    if (first && last && full && lowText.includes(` ${full} `)) {
      people.push({ kind: "record", tab: "contacts", id: c.url, main: `${c.first} ${c.last}`.trim(), meta: [c.position, c.organisation].filter(Boolean).join(" · ") });
      claimed.add(first); claimed.add(last);
    }
  }
  // Companies: a distinctive org token that appears in the message and ISN'T part of a matched person's name.
  const orgCount = new Map<string, number>();
  for (const c of d.contacts) { const o = c.organisation?.trim(); if (o) orgCount.set(o, (orgCount.get(o) || 0) + 1); }
  const orgHits: { org: string; count: number }[] = [];
  for (const [org, count] of orgCount) {
    const words = org.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    // A 2-char token only counts when it IS the whole org (e.g. "EY") — never a short suffix like the
    // "Re" in "Swiss Re"/"Munich Re", which else matches stray tokens like the "re" in "re-engage".
    const toks = words.filter((w) => !ORG_STOP.has(w) && !ORG_NOISE.has(w) && !isCommonOrgToken(w) && !claimed.has(w) && (w.length >= 3 || words.length === 1));
    const present = toks.filter((w) => msg.has(w));
    // Require a DISTINCTIVE match, so one ordinary word can't conjure a company that merely contains it:
    // either 2+ of the org's tokens are named, OR a single STRONG token (len>=5 and not a conversational
    // word) is. ("kind"→"In Kind Direct", "josé"→"…José Cela", "KIND" alone are all rejected by this.)
    const strong = (w: string) => w.length >= 5 && !CHATTY_STOP.has(w);
    if (present.length >= 2 || (present.length === 1 && strong(present[0]))) orgHits.push({ org, count });
  }
  orgHits.sort((a, b) => b.count - a.count);
  const hits: RelatedHit[] = orgHits.slice(0, 3).map(({ org, count }) => ({ kind: "company", org, main: org, meta: `${count} ${count === 1 ? "person" : "people"}` }));
  hits.push(...people);
  return hits;
}

// Recognise "list everyone who…" questions and return a clickable jump to the matching FILTERED view on
// a record tab — so the user gets the real, complete, accurate list (and we don't lean on the model to
// enumerate it, which drifts on small models). Extend with more saved views as patterns emerge.
function detectView(text: string): RelatedHit | null {
  const t = text.toLowerCase();
  const view = (main: string, tab: TabId, intent: TabIntent): RelatedHit => ({ kind: "view", tab, intent, main, meta: "Open filtered list" });
  // Agreed to meet but not met yet.
  if (/agreed to meet/.test(t) && /(haven'?t|not|yet|still)/.test(t) && /\bmet\b|\bmeet\b/.test(t.replace("agreed to meet", ""))) {
    return view("People you've agreed to meet but not met", "contacts", { filters: [{ key: "agreed", value: "Yes" }, { key: "met", value: "No" }] });
  }
  // Haven't met yet (no explicit "agreed").
  if (/(haven'?t|not yet|still need to|yet to)\s+(actually\s+)?met\b/.test(t) || /\bnot met\b/.test(t)) {
    return view("People you haven't met yet", "contacts", { filter: { key: "met", value: "No" } });
  }
  // People I've met.
  if (/(who|people|everyone|contacts).*\b(have|i'?ve)?\s*met\b/.test(t) && !/haven'?t|not/.test(t)) {
    return view("People you've met", "contacts", { filter: { key: "met", value: "Yes" } });
  }
  // Haven't responded / replied.
  if (/(haven'?t|not|no)\s+(responded|replied|heard back)/.test(t)) {
    return view("People who haven't responded", "contacts", { filter: { key: "responded", value: "No" } });
  }
  // Listing opportunities → the Opportunities tab.
  if (/\b(list|show|pull up|what are)\b[^?]*\bopportunit/.test(t) || /\bmy (open |current |live )?opportunit/.test(t)) {
    return view("Open the Opportunities list", "opportunities", {});
  }
  // Listing contracts / SoWs.
  if (/\b(list|show|pull up)\b[^?]*\b(contract|sow|engagement)/.test(t)) {
    return view("Open the Contracts list", "revenue", {});
  }
  return null;
}

// Flatten the top matches into the "related records" shown under an answer.
function collectRelated(g: Groups): RelatedHit[] {
  const out: RelatedHit[] = [];
  for (const h of g.people) out.push({ kind: "record", tab: "contacts", id: h.id, main: h.main, meta: h.meta });
  for (const c of g.companies) out.push({ kind: "company", org: c.org, main: c.org, meta: `${c.count} ${c.count === 1 ? "person" : "people"}` });
  for (const h of g.meetings) out.push({ kind: "record", tab: "meetings", id: h.id, main: h.main, meta: h.meta });
  for (const h of g.opps) out.push({ kind: "record", tab: "opportunities", id: h.id, main: h.main, meta: h.meta });
  for (const h of g.contracts) out.push({ kind: "record", tab: "revenue", id: h.id, main: h.main, meta: h.meta });
  return out.slice(0, 6);
}

// Serialize the records that match the user's message into a compact context block, so the model can
// reference real records by name (not just aggregate stats). This is what lets it SEE a contact like
// "Ethan Rossi" instead of claiming he isn't in the book.
// Does a candidate next-step just echo the question the user already asked? (Content-word overlap.)
// Used to stop chips like "Who's gone cold?" reappearing under the answer to "who's gone cold?".
const CHIP_STOP = new Set(["that","this","what","which","should","would","could","have","with","about","there","their","know","from","your","mine","they","them","into","over","some","good","next","week","today","right","now","really"]);
function chipTokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !CHIP_STOP.has(w)));
}
function echoesQuestion(prompt: string, question: string): boolean {
  const A = chipTokens(prompt), B = chipTokens(question);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size) >= 0.5;
}

// Ask the model for contextual next-step chips based on the actual answer; fall back to templates. Each
// must be a complete first-person instruction that doesn't just restate the question. Returns [] on any
// failure so the caller can use its deterministic fallback.
async function generateChips(question: string, reply: string, grounding: string): Promise<Chip[]> {
  try {
    const raw = await aiJson<Chip[]>(suggestionsPrompt(question, reply, grounding));
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const clean: Chip[] = [];
    for (const c of raw) {
      const label = (c?.label || c?.prompt || "").trim().replace(/[.…]+$/, "");
      const prompt = (c?.prompt || c?.label || "").trim();
      if (!label || !prompt) continue;
      if (echoesQuestion(prompt, question)) continue;
      const key = prompt.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      clean.push({ label, prompt });
      if (clean.length >= 3) break;
    }
    return clean;
  } catch {
    return [];
  }
}

// Deterministic chips built from the people/companies the ANSWER actually names (via entityHits on the
// reply text) — so on small models, where the JSON chip generator fails, the suggestions still reference
// exactly who the reply talked about, with a varied action per person. This is the key fix for chips that
// named random book contacts who weren't in the message.
function chipsFromAnswer(answer: string, d: BookData): Chip[] {
  const hits = entityHits(answer, d);
  const people = hits.filter((h) => h.kind === "record").map((h) => h.main);
  const orgs = hits.filter((h): h is Extract<RelatedHit, { kind: "company" }> => h.kind === "company").map((h) => h.org);
  const verbs: ((n: string) => Chip)[] = [
    (n) => ({ label: `Draft a follow-up to ${n}`, prompt: `Draft a follow-up to ${n}` }),
    (n) => ({ label: `Log an opportunity for ${n}`, prompt: `Log an opportunity for ${n}` }),
    (n) => ({ label: `Brief me on ${n}`, prompt: `Brief me on ${n}` }),
  ];
  const chips: Chip[] = [];
  people.slice(0, 3).forEach((n, i) => chips.push(verbs[i % verbs.length](n)));
  if (chips.length < 3 && orgs.length) chips.push({ label: `Who else do I know at ${orgs[0]}?`, prompt: `Who do I know at ${orgs[0]}?` });
  return chips.slice(0, 3);
}

// The person/company a chip is "anchored" to (the object of its action), if any — e.g. "Draft a
// follow-up to **Noah Miller**", "Who else do I know at **Related Companies**?". Returns it in original
// case so we can tell a proper noun ("Related Companies") from a generic phrase ("my warmest lead").
const CHIP_ANCHOR_PATTERNS: RegExp[] = [
  /\b(?:follow[- ]?up|outreach|reply|response|message|email|note|intro(?:duction)?)\s+(?:to|for)\s+(.+?)(?:\s+(?:about|regarding|on)\b.*)?$/i,
  /\bbrief me on\s+(.+?)$/i,
  /\b(?:meeting|catch[- ]?up|call|coffee|lunch|sync)\s+with\s+(.+?)$/i,
  /\b(?:opportunity|deal|engagement)\s+(?:for|with|at|from)\s+(.+?)$/i,
  /\b(?:know|anyone|contacts|people|connections)\b[^?]*\bat\s+(.+?)$/i,
  /\bnext step on\s+(?:the\s+)?(.+?)(?:\s+opportunity)?$/i,
  /\b(?:reconnect with|reach out to|introduce me to|chase|connect with)\s+(.+?)$/i,
];
function chipAnchor(prompt: string): string | null {
  const p = prompt.trim().replace(/[?.!,]+$/, "");
  for (const re of CHIP_ANCHOR_PATTERNS) {
    const m = p.match(re);
    if (m && m[1]) return m[1].trim().replace(/^the\s+/i, "").trim();
  }
  return null;
}
// Is an anchor a REAL entity in the book (a contact, an org, or an opportunity)? Used to reject chips that
// name something the model invented (a real-world company not in this user's book).
function anchorIsReal(anchor: string, d: BookData): boolean {
  const a = anchor.trim().toLowerCase();
  if (!a) return true;
  if (matchContacts(a, d.contacts).length > 0) return true;
  const aToks = new Set(a.split(/[^a-z0-9]+/).filter(Boolean));
  for (const c of d.contacts) {
    const o = (c.organisation || "").trim().toLowerCase();
    if (!o) continue;
    if (o === a) return true;
    const owords = o.split(/[^a-z0-9]+/).filter(Boolean);
    const oToks = owords.filter((w) => !ORG_STOP.has(w) && !ORG_NOISE.has(w) && !isCommonOrgToken(w) && (w.length >= 3 || owords.length === 1));
    if (oToks.length && oToks.every((w) => aToks.has(w))) return true;
  }
  for (const op of d.opps) if ((op.opportunity_name || "").trim().toLowerCase() === a) return true;
  return false;
}

// Validate model-generated chips: (a) every BOOK entity a chip names must appear in the answer (small
// models — and capable ones — sometimes pull a name from the broader book); (b) a chip anchored to a
// PROPER NOUN that isn't a real book entity is dropped (kills hallucinated-company chips like "…at Related
// Companies"). Chips that name nobody specific, or anchor to a generic phrase, are kept.
function chipNamesInAnswer(chips: Chip[], answer: string, d: BookData): Chip[] {
  const key = (h: RelatedHit): string => (h.kind === "company" ? "o:" + h.org.toLowerCase() : h.kind === "record" ? "p:" + h.main.toLowerCase() : "");
  const inAnswer = new Set(entityHits(answer, d).map(key).filter(Boolean));
  return chips.filter((c) => {
    if (!entityHits(c.prompt, d).map(key).filter(Boolean).every((k) => inAnswer.has(k))) return false;
    const anchor = chipAnchor(c.prompt);
    // Only police anchors that look like a proper noun (start uppercase) — leave generic phrases alone.
    if (anchor && /^[A-Z0-9]/.test(anchor) && !anchorIsReal(anchor, d)) return false;
    return true;
  });
}

// Convert the live UI turns into the persisted transcript. Interactive action cards can't be persisted,
// so a SAVED action becomes its summary line (and we drop the now-meaningless "Here's a draft… confirm to
// save" lead that immediately preceded it). Unsaved drafts are simply omitted — they aren't real history.
function serializeForPersist(turns: UITurn[]): StoredTurn[] {
  const out: StoredTurn[] = [];
  for (const t of turns) {
    if (t.role === "action") {
      if (t.action?.status === "saved" && t.action.savedSummary) {
        // A SAVED card collapses to a PERMANENT RECEIPT row (audit trail — Gate-0 decision: the ✓ banner
        // persists in the thread; Undo stays live-toast-only and is deliberately not restorable).
        if (out.length && out[out.length - 1].role === "ai") out.pop();
        out.push({ role: "ai", text: t.action.savedSummary, receipt: true });
      } else if (t.action && t.action.status === "draft") {
        // Persist the DRAFT (unconfirmed) card so it survives leaving + returning to the thread (#28).
        // ActionCardData is fully serializable; the render loop rebuilds an interactive card by index.
        out.push({ role: "action", text: "", action: t.action });
      }
      continue;
    }
    out.push({ role: t.role, text: t.text, ...(t.chips && t.chips.length ? { chips: t.chips } : {}), ...(t.compute ? { compute: t.compute } : {}), ...(t.receipt ? { receipt: true } : {}) });
  }
  return out;
}

// After an action saves, the assistant offers the next logical move — anchored to what was just created
// (the contact/opportunity/engagement), phrased as an offer ("Want me to…?") with 2–3 tappable chips.
function actionFollowUp(kind: "contact" | "meeting" | "opportunity" | "contract", values: Record<string, string>, subjectName: string): { text: string; chips: Chip[] } {
  const v = (k: string) => (values[k] || "").trim();
  const chips: Chip[] = [];
  if (kind === "opportunity") {
    const name = v("opportunity_name") || "that opportunity";
    const org = v("organisation");
    const who = v("primary_contact") || subjectName;
    if (who) chips.push({ label: `Draft outreach to ${who}`, prompt: `Draft an outreach message to ${who} about ${name}` });
    chips.push({ label: `Log a meeting on ${name}`, prompt: `Log a meeting about the ${name} opportunity` });
    if (org) chips.push({ label: `Who else do I know at ${org}?`, prompt: `Who do I know at ${org}?` });
    return { text: `Done — ${name}${org ? ` at ${org}` : ""} is in your pipeline now. Want me to help you take the first step on it?`, chips: chips.slice(0, 3) };
  }
  if (kind === "meeting") {
    const who = subjectName || v("primary_contact");
    if (who) {
      chips.push({ label: `Draft a follow-up to ${who}`, prompt: `Draft a follow-up message to ${who}` });
      chips.push({ label: `Add an opportunity for ${who}`, prompt: `Add an opportunity for ${who}` });
    }
    chips.push({ label: "Log another meeting", prompt: "Log another meeting I just had" });
    return { text: `Logged${who ? ` — your meeting with ${who}` : ""}. Want me to tee up what comes next?`, chips: chips.slice(0, 3) };
  }
  if (kind === "contact") {
    const who = subjectName || `${v("first")} ${v("last")}`.trim();
    if (who) {
      chips.push({ label: `Log a meeting with ${who}`, prompt: `Log a meeting with ${who}` });
      chips.push({ label: `Add an opportunity for ${who}`, prompt: `Add an opportunity for ${who}` });
    }
    return { text: `Updated${who ? ` ${who}` : ""}. Want to log a meeting or an opportunity for them?`, chips: chips.slice(0, 3) };
  }
  const eng = v("engagement_name") || "that engagement";
  const org = v("organisation");
  chips.push({ label: "Log a kickoff meeting", prompt: `Log a kickoff meeting for ${eng}` });
  if (org) chips.push({ label: `Brief me on ${org}`, prompt: `Brief me on ${org}` });
  return { text: `Saved — ${eng}${org ? ` with ${org}` : ""}. Want me to set up the kickoff?`, chips: chips.slice(0, 3) };
}

// Heuristic: does the question call for EXTERNAL/current info a private book can't hold? Cheap and
// instant (no extra inference) — keeps the on-device demo snappy. Only consulted when web is allowed.
const WEB_HINTS = /\b(news|latest|recent|today|current|currently|happening|update|updates|announce|announced|stock|share price|market|markets|industry|trend|trends|who is|what is|tell me about|look up|search|google|website|headquarters|revenue of|ceo of|founder|founded|acquisition|competitor|competitors)\b/i;
function needsWeb(text: string): boolean { return WEB_HINTS.test(text); }

// Starter prompts shown on an empty copilot — one per capability, so users discover they can ask,
// act, run a workflow and draft. `submit` chips fire immediately; the open-ended ones seed the box.
// Self-contained starter prompts in three lanes the assistant infers between: Find (return clickable
// records), Ask (a written answer), Do (take an action). Every one is fully-formed — no trailing "…",
// no half-sentence to complete — so a click is a real question, not a fill-in-the-blank. A rotating,
// lane-balanced subset shows each open (via pickStarters) so it never feels static.
const STARTER_POOL: { group: "Find" | "Ask" | "Do"; text: string }[] = [
  { group: "Ask", text: "How's my pipeline looking this quarter?" },
  { group: "Ask", text: "Who's gone cold that I should re-engage?" },
  { group: "Ask", text: "What should I focus on this week?" },
  { group: "Ask", text: "What do you know about me?" },
  { group: "Ask", text: "Where am I losing momentum in my funnel?" },
  { group: "Find", text: "Find people I haven't spoken to in 90 days" },
  { group: "Find", text: "Show my largest open opportunities" },
  { group: "Find", text: "Show meetings from the last two weeks" },
  { group: "Find", text: "Find my warmest leads right now" },
  { group: "Find", text: "List the companies in my pipeline" },
  { group: "Do", text: "Log a meeting I just had" },
  { group: "Do", text: "Add a new opportunity" },
  { group: "Do", text: "Draft a follow-up to my warmest lead" },
  { group: "Do", text: "Remind me to check in with a contact" },
  { group: "Do", text: "Mark an opportunity as won" },
];

// Pick a rotating, lane-balanced set (2 from each of Ask / Find / Do). `seed` advances once per open
// so the suggestions differ each time — deterministic (no Math.random; safe under the sealed runtime).
function pickStarters(seed: number): { group: string; text: string }[] {
  const out: { group: string; text: string }[] = [];
  for (const lane of ["Ask", "Find", "Do"] as const) {
    const items = STARTER_POOL.filter((s) => s.group === lane);
    for (let i = 0; i < 2; i++) out.push(items[(seed * 2 + i) % items.length]);
  }
  return out;
}

// Advances each time a CopilotBar mounts (the modal remounts per open; the ChatTab per visit), so the
// starter set rotates without any timer or randomness.
let starterRotation = 0;

function relativeTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

// A livelier "Thinking…/Working…" indicator: a little glyph on the left that morphs through plus/star
// shapes every beat (so it visibly churns), and the whole thing drifts through shades of blue. Pure CSS
// for the colour drift; a tiny interval cycles the glyph (remounting it replays a pop animation).
const THINK_GLYPHS = ["+", "✦", "✶", "✷", "✸", "✹", "✺", "✳", "∗"];
// Quirky-but-business-focused verbs the indicator cycles through (fun, and it reads as "still working").
const THINK_VERBS = [
  "Thinking", "Crunching", "Proofing", "Connecting", "Digging", "Scanning", "Weighing",
  "Sharpening", "Mapping", "Synthesising", "Strategising", "Consulting",
];
function ThinkingIndicator({ label, startMs, staged }: { label?: string; startMs?: number; staged?: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 420);
    return () => clearInterval(t);
  }, []);
  const secs = startMs ? Math.max(0, Math.floor((Date.now() - startMs) / 1000)) : 0;
  // STAGED mode (composed compute answers — Gate-0 delivery decision): the wait communicates competence by
  // narrating the real pipeline — the numbers landed instantly, the commentary is being written.
  const stagedWord = secs < 2 ? "Reading your book" : secs < 4 ? "Computing" : secs >= 30 ? "Still writing" : "Writing";
  // A fixed label (model download / "Working…") shows verbatim; otherwise rotate a quirky verb every ~3s,
  // and settle into "Almost there…" on long waits so it never feels stuck.
  const word = label ?? `${staged ? stagedWord : secs >= 22 ? "Almost there" : THINK_VERBS[Math.floor(tick / 7) % THINK_VERBS.length]}…`;
  return (
    <span className="thinking">
      <span className="thinking-glyph" key={tick % THINK_GLYPHS.length}>{THINK_GLYPHS[tick % THINK_GLYPHS.length]}</span>
      <span className="thinking-word">{word}</span>
      {secs > 0 && <span className="thinking-secs">· {secs}s</span>}
    </span>
  );
}

// Read-only indicator of the AI tier in use, shown in the composer's bottom-right. Detection only —
// switching models is a Freehold (host) action, not done in-app.
function TierLabel() {
  const { label, contextTokens, backend, model } = useAiBackend();
  if (!backend) return null;
  const ctx = contextTokens ? ` · ~${Math.round(contextTokens / 1000)}k context` : "";
  const short = shortModelName(model);
  const lvl = capabilityLevel(backend, model);
  return (
    <span className="copilot-tier" title={`AI tier: ${label}${short ? ` (${short})` : ""} · capability: ${lvl}${ctx}. Model selection is managed by Freehold.`}>
      <span className="copilot-tier-dot" />
      {label}{short ? ` · ${short}` : ""}
    </span>
  );
}

// An input that WRAPS and auto-grows with the text (up to maxH, then scrolls). Enter sends; Shift+Enter
// inserts a newline. Used for both the search field and the chat composer so long messages don't run off.
function GrowTextarea({ value, onChange, onEnter, className, placeholder, autoFocus, maxH = 160, refCb }: {
  value: string; onChange: (v: string) => void; onEnter: () => void; className?: string; placeholder?: string; autoFocus?: boolean; maxH?: number; refCb?: (el: HTMLTextAreaElement | null) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const resize = () => { const el = ref.current; if (!el) return; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, maxH) + "px"; };
  useEffect(() => { resize(); }, [value]); // grow on type + shrink back when cleared programmatically
  return (
    <textarea
      ref={(el) => { ref.current = el; refCb?.(el); }}
      rows={1}
      className={className}
      placeholder={placeholder}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onEnter(); } }}
    />
  );
}

export function CopilotBar({ onNavigate, onOpenAccount, onClose, initialView = "search", fullPage = false, onAsk, seedPrompt, openChatId, onChatsChanged }: { onNavigate: Navigate; onOpenAccount?: (org: string) => void; onClose: () => void; initialView?: View; fullPage?: boolean; onAsk?: (text: string) => void; seedPrompt?: string; openChatId?: string; onChatsChanged?: () => void }) {
  const aiReady = useAiAvailable();
  // Re-checkable active backend. When it's the stub (no real on-device model), we show the setup ladder
  // instead of letting the copilot answer with placeholder text. `aiNonce` bumps after a successful setup.
  const [aiNonce, setAiNonce] = useState(0);
  const { backend: activeBackend, label: aiLabel, model: aiModel, local: activeLocal } = useAiBackend(aiNonce);
  // Chat + a background scan share the SAME local model (on-device WebLLM, or a local LM Studio/Ollama), so a
  // running scan makes chat crawl. A cloud key handles concurrent requests, so no contention there.
  const sharesLocalModel = !isCapableBackend(activeBackend) || !!activeLocal;
  // Live scan status → drives the "chatting pauses the scan" notice.
  const scanStatus = useSyncExternalStore(subscribeWarmth, () => getWarmthState().status);
  const [pauseNoticeDismissed, setPauseNoticeDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem("bb.chatPauseNotice.seen") === "1"; } catch { return false; }
  });
  const dismissPauseNotice = () => {
    setPauseNoticeDismissed(true);
    try { localStorage.setItem("bb.chatPauseNotice.seen", "1"); } catch { /* ignore */ }
  };
  const [view, setView] = useState<View>(initialView);
  const [histQuery, setHistQuery] = useState("");
  const [, setInflightTick] = useState(0);
  // First-use model download progress (broadcast by the broker), so "Thinking…" becomes "Setting up the
  // assistant… 34%" while the one-time model loads — stops people abandoning, thinking it's frozen.
  const [aiLoad, setAiLoad] = useState<{ active: boolean; progress: number; firstRun: boolean } | null>(null);
  const aiLoadRef = useRef<{ active: boolean; progress: number; firstRun: boolean } | null>(null); // latest, for the stall watchdog
  const seededRef = useRef(false);
  // The rotating starter set, fixed for this mount so it doesn't reshuffle on every keystroke.
  const [starters] = useState(() => pickStarters(starterRotation++));
  const [q, setQ] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [meetingRows, setMeetingRows] = useState<MeetingRow[]>([]);
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [sows, setSows] = useState<Sow[]>([]);
  const [chat, setChat] = useState<UITurn[]>([]);
  const [asking, setAsking] = useState(false);
  const [streaming, setStreaming] = useState(false); // a reply is streaming in token-by-token
  const [actionBusy, setActionBusy] = useState(false);
  // Composed compute answers hold table+narration and show the staged pipeline indicator meanwhile.
  const [stagedThinking, setStagedThinking] = useState(false);
  const [genTokens, setGenTokens] = useState(0); // live token estimate shown while a reply streams
  const genStartRef = useRef(0); // ms when the current generation began (for the live secs + "Thought for XXs")
  const wasGenRef = useRef(false); // tracks generating→idle transitions to stamp the finished turn
  const [saved, setSaved] = useState<SavedChat[]>(() => listChats());
  const [notes, setNotes] = useState<Note[]>([]); // the AI's distilled memory (loaded when the view opens)
  const [doc, setDoc] = useState<LoadedDoc | null>(null); // an attached document, fed into the next message
  const [docNote, setDocNote] = useState("");
  const chatIdRef = useRef<string | null>(null);
  // The opportunity touched most recently in THIS session — the referent for "update that/it" (Gate-0 #35).
  const lastOppIdRef = useRef<string | null>(null);
  const latestChatRef = useRef<UITurn[]>([]); // newest chat turns, for distilling memory on leave/unmount
  const distilledRef = useRef<Map<string, number>>(new Map()); // chatId → turns already distilled (skip redundant)
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const docInputRef = useRef<HTMLInputElement | null>(null);

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    setDocNote("Reading…");
    try {
      const d = await readDoc(file);
      setDoc(d);
      setDocNote("");
    } catch (e) {
      setDoc(null);
      setDocNote(e instanceof Error ? e.message : "Couldn't read that file.");
    }
  }

  // (Re)load every store — run at mount and after any agent write so later answers see the new record.
  function reloadData() {
    const m = loadAllMeetings();
    setOpps(Object.values(loadAllOpportunities()));
    setSows(Object.values(loadAllSows()));
    loadContacts().then((rows) => { setContacts(rows); setMeetingRows(buildMeetingRows(rows, m)); }).catch(() => {});
  }
  useEffect(() => { reloadData(); }, []);

  // Open a specific saved chat on mount (clicked from the Recent-chats rail or the chats list).
  useEffect(() => {
    if (!openChatId) return;
    const c = getChat(openChatId);
    if (c) { setChat(c.turns); chatIdRef.current = c.id; setView("chat"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openChatId]);

  // Seed a brand-new conversation from a prompt handed in by the top-bar search box (Enter escalates the
  // draft into the full Chat surface). Fire once, only when AI is actually ready.
  useEffect(() => {
    if (!seedPrompt || seededRef.current || aiReady !== true) return;
    seededRef.current = true;
    ask(seedPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedPrompt, aiReady]);

  // Keep this view in sync with generations that may be running in a DIFFERENT (now-unmounted) view: when
  // a chat finishes generating elsewhere, reload it from storage so the answer appears; and re-render so
  // the "thinking" indicator tracks the live busy state. (The generation itself runs to completion and
  // persists regardless of which view is mounted — see ai/inflight.ts.)
  // Keep the latest turns handy + distil the conversation into memory when this view unmounts (the user
  // navigated away). Runs once on unmount with whatever the chat held at that point.
  latestChatRef.current = chat;
  useEffect(() => () => { void maybeDistil(latestChatRef.current, chatIdRef.current); }, []);

  // Listen for one-time model-download progress from the broker.
  useEffect(() => {
    function onLoad(e: Event) {
      const d = (e as CustomEvent).detail as { active: boolean; progress: number; firstRun?: boolean } | undefined;
      if (d) { const v = d.active ? { active: true, progress: d.progress, firstRun: !!d.firstRun } : null; setAiLoad(v); aiLoadRef.current = v; }
    }
    window.addEventListener("freehold:ai-load", onLoad);
    return () => window.removeEventListener("freehold:ai-load", onLoad);
  }, []);

  useEffect(() => subscribeInflight(() => {
    setInflightTick((t) => t + 1);
    const id = chatIdRef.current;
    if (!id || isBusy(id)) return; // still generating — just refresh the thinking state
    // Finished. If our view is still waiting (last shown turn is the user's), pull in the saved answer.
    setChat((cur) => {
      const last = cur[cur.length - 1];
      if (last && last.role === "you") {
        const c = getChat(id);
        if (c) return c.turns as UITurn[];
      }
      return cur;
    });
  }), []);

  const data: BookData = useMemo(() => ({ contacts, meetingRows, opps, sows }), [contacts, meetingRows, opps, sows]);
  const today = useMemo(() => todayISO(), []);
  const groups = useMemo(() => searchBook(q, data), [q, data]);
  // Contacts as picker options (for the action card's contact field).
  const contactOptions = useMemo(() => contacts.map((c) => ({ url: c.url, label: `${`${c.first} ${c.last}`.trim()} · ${c.organisation || "—"}` })).sort((a, b) => a.label.localeCompare(b.label)), [contacts]);
  // The user's own organisations (from their contacts) — typeahead suggestions for the org field.
  const orgOptions = useMemo(() => [...new Set(contacts.map((c) => c.organisation?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)), [contacts]);
  // Typeahead suggestion lists for the action-card fields (org from the book; locations + next-actions are
  // sensible defaults — all still free-text, so the user can type anything).
  const actionSuggestions = useMemo(() => ({ organisation: orgOptions, based_in: COMMON_LOCATIONS, next_action: NEXT_ACTIONS }), [orgOptions]);

  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }); }, [chat, asking, view]);

  // One place owns generation timing (no per-answer-path edits): when a turn STARTS generating, record the
  // start + reset the live token count; when it ENDS, stamp the just-finished AI turn with elapsed ms +
  // token estimate so it can show "Thought for XXs · ~N tokens" (Claude-style). Display-only (not persisted).
  useEffect(() => {
    const gen = asking || streaming;
    if (gen && !wasGenRef.current) { genStartRef.current = Date.now(); setGenTokens(0); }
    else if (!gen && wasGenRef.current && genStartRef.current) {
      const ms = Date.now() - genStartRef.current;
      setChat((cur) => {
        const last = cur[cur.length - 1];
        if (!last || last.role !== "ai" || last.genMs != null) return cur;
        return cur.map((t, i) => (i === cur.length - 1 ? { ...t, genMs: ms, genTok: approxTokens(t.text) } : t));
      });
    }
    wasGenRef.current = gen;
  }, [asking, streaming]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const renderHits = (title: string, items: Hit[], tab: TabId) =>
    items.length > 0 ? (
      <div className="copilot-group">
        <div className="copilot-group-head">{title}</div>
        {items.map((h) => (
          <button key={tab + h.id} type="button" className="copilot-hit" onClick={() => { onNavigate(tab, { openId: h.id }); onClose(); }}>
            <span className="copilot-hit-main">{h.main}</span>
            <span className="copilot-hit-meta">{h.meta}</span>
          </button>
        ))}
      </div>
    ) : null;

  function persistTo(id: string, turns: (ChatTurn | StoredTurn)[]) {
    if (!turns.length) return;
    const existing = getChat(id);
    saveChat({ id, title: titleFromTurns(turns), createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now(), turns: turns.map((t) => ({ role: t.role, text: t.text, ...(t.chips && t.chips.length ? { chips: t.chips } : {}), ...("action" in t && t.action ? { action: t.action } : {}), ...("compute" in t && t.compute ? { compute: t.compute } : {}), ...("receipt" in t && t.receipt ? { receipt: true } : {}) })) });
    setSaved(listChats());
    onChatsChanged?.();
  }

  // One-time nudge: if the active model is the small built-in (Gemini Nano) but this browser CAN run the
  // more capable on-device model (WebGPU present, WebLLM not yet set up), encourage the upgrade the first
  // time they ask something. It still works on Nano — this just offers the better model. Decline once and
  // we never ask again (a remembered flag). On accept we mark consent + clear the off flags so the very next
  // answer loads WebLLM (the broker shows download progress, no second confirm).
  function offerUpgradeIfOnNano() {
    // Only meaningful in `npm run dev` (the dev shim owns backend switching). Sealed on Freehold the HOST
    // owns the AI backend, so this nudge's dev-flag writes are inert — firing the confirm there just shows
    // a dead "~1.9 GB download?" dialog that does nothing. Never run it outside dev.
    if (!import.meta.env.DEV) return;
    try {
      if (activeBackend !== "builtin") return;            // only nudge people actually on Nano
      const caps = aiCapabilities();
      if (!caps.webgpu) return;                            // can't run WebLLM here — nothing to offer
      if (localStorage.getItem("freehold.dev.webllm.consented") === "1") return; // already upgrading/upgraded
      if (localStorage.getItem("bob.webllm.upgradeDismissed") === "1") return;   // they said no once
      const ok = window.confirm(
        "You're using Chrome's built-in AI (Gemini Nano) — it works, but it's a small, less capable model.\n\n" +
        "Want to upgrade to a more capable on-device assistant? It's a one-time ~1.9 GB download, stays private on your device, and gives noticeably better answers.\n\n" +
        "OK to upgrade · Cancel to keep using Gemini Nano.",
      );
      if (ok) {
        localStorage.setItem("freehold.dev.webllm.consented", "1");
        localStorage.removeItem("freehold.dev.webllm");
        localStorage.removeItem("freehold.dev.backend");
        setAiNonce((n) => n + 1); // re-read the backend so the badge flips to the on-device model
      } else {
        localStorage.setItem("bob.webllm.upgradeDismissed", "1");
      }
    } catch { /* never block a question on the nudge */ }
  }

  // Blend WORLD knowledge into a company account answer: after the deterministic table renders, append a
  // short factual description of what the organisation does — SOURCED ONLY from a brokered web/ENTITY lookup
  // (Wikipedia, real current data). We deliberately do NOT fall back to the model's own training memory: that
  // was capability-gated (a weak model hallucinates company facts), which made the SAME account read
  // differently by tier, and — worse for a confidential BD tool — blurred "from your book" vs "from the
  // model's head". Web-lookup only = identical on every tier that has web access, honest, and clearly labelled
  // as an external lookup. Best-effort and non-blocking; adds nothing when the lookup yields nothing.
  async function enrichCompany(name: string, id: string, display: UITurn[], persisted: ChatTurn[]) {
    try {
      if (!(await searchAvailable())) return;
      const facts = await searchEntity(name);
      if (!facts.found) return;
      let blurb = (facts.extract || facts.description || "").trim();
      const title = facts.title || name;
      if (!blurb || chatIdRef.current !== id) return;
      if (blurb.length > 480) blurb = blurb.slice(0, 480).replace(/\s+\S*$/, "") + "…";
      // Label it as an external lookup so the reader never mistakes it for something from their own book.
      const turnText = `**About ${title}** (public web lookup — not from your book) — ${blurb}`;
      setChat([...display, { role: "ai", text: turnText }]);
      persistTo(id, [...persisted, { role: "ai", text: turnText }]);
    } catch { /* enrichment is best-effort — the table already rendered */ }
  }

  // The compute→interpret combo: a deterministic tool computed the ground-truth table; now stream an ANALYSIS
  // of it — what stands out + one next move — so the answer reads like a partner, not a database. The figures
  // stay code-computed and un-fabricatable (the model is told they're ground truth and never restates/alters
  // them); this only ADDS insight. `position`: "above" (CAPABLE tiers — the narrative reads FIRST, the table
  // sits below as evidence) or "below" (WebLLM — the table is already up as an instant anchor and the slower
  // narrative streams underneath). The working indicator runs the WHOLE time (asking→streaming) so it never
  // looks finished before the narrative lands. Best-effort and non-blocking.
  async function interpretCompute(question: string, md: string, id: string, base: UITurn[], tableTurn: UITurn, persisted: ChatTurn[], tablePersist: ChatTurn, position: "above" | "below") {
    const compose = (narr: string): UITurn[] => position === "above" ? [...base, { role: "ai", text: narr }, tableTurn] : [...base, tableTurn, { role: "ai", text: narr }];
    // COMPOSED delivery: tokens accumulate silently (no partial renders, no reflow — the Gate-0 decision);
    // the answer lands once, complete. Hard 60s bound so a stalled model can never hold the table hostage —
    // on stall/error the table delivers alone with an honest note (and a partial narration ≥120 chars is
    // salvaged rather than binned).
    let acc = "";
    const NOTE = "_Couldn't add commentary this time — the model stalled. The numbers above are complete._";
    const deliverFallback = () => {
      if (chatIdRef.current !== id) return;
      const salvage = acc.trim().length >= 120 ? `${acc.trim()}…` : "";
      if (salvage) {
        setChat(compose(salvage));
        persistTo(id, position === "above" ? [...persisted, { role: "ai", text: salvage } as ChatTurn, tablePersist] : [...persisted, tablePersist, { role: "ai", text: salvage } as ChatTurn]);
      } else {
        setChat([...base, tableTurn, { role: "ai", text: NOTE }]);
        persistTo(id, [...persisted, tablePersist, { role: "ai", text: NOTE }]);
      }
    };
    try {
      if (chatIdRef.current !== id) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const bound = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("interpret-timeout")), 60_000); });
      let streamed = "";
      try {
        streamed = await Promise.race([
          aiPromptStream(interpretResultPrompt(question, md), (full) => { acc = full; }),
          bound,
        ]);
      } finally { if (timer) clearTimeout(timer); }
      const finalText = (streamed || acc).trim();
      if (chatIdRef.current !== id) return;
      if (!finalText) { setChat([...base, tableTurn]); persistTo(id, [...persisted, tablePersist]); return; }
      setChat(compose(finalText));
      const narr: ChatTurn = { role: "ai", text: finalText };
      persistTo(id, position === "above" ? [...persisted, narr, tablePersist] : [...persisted, tablePersist, narr]);
    } catch { deliverFallback(); }
    finally { setAsking(false); setStreaming(false); }
  }

  // The COMPANION stream: for a personal / general / advice turn the topic-gate routed AWAY from the book.
  // Warm and broad — NO records, NO chips, NO related cards, NO "want me to…?" — just talk with them. The
  // persona's depth/challenge scales with model capability; on a stall it falls back to a warm line, never a
  // contact card (the old fallback dumping "Richard Singh" into an emotional chat was the worst offender).
  async function streamCompanion(text: string, prior: UITurn[], id: string, history: ChatTurn[], level: "small" | "mid" | "high") {
    let firstTok = true, bailed = false;
    const streamP = aiPromptStream(companionPrompt(text, history, level, { heavy: heavyDistress(text) }), (full) => {
      if (bailed || chatIdRef.current !== id) return;
      if (firstTok) { firstTok = false; setAsking(false); setStreaming(true); }
      setGenTokens(approxTokens(full));
      setChat([...prior, { role: "you", text }, { role: "ai", text: full }]);
    });
    try {
      const reply = await Promise.race([
        streamP,
        firstTokenStall(() => firstTok, () => !!aiLoadRef.current?.active, () => { bailed = true; }),
      ]);
      const aiText = reply.trim() || "(no response)";
      persistTo(id, [...history, { role: "you", text }, { role: "ai", text: aiText }]);
      if (chatIdRef.current === id) setChat([...prior, { role: "you", text }, { role: "ai", text: aiText }]);
    } catch {
      const aiText = "Sorry — that one took too long for the on-device model to get through (it can be slow to warm up the first time). Mind giving it another go? It's usually quicker the second time.";
      persistTo(id, [...history, { role: "you", text }, { role: "ai", text: aiText }]);
      if (chatIdRef.current === id) setChat([...prior, { role: "you", text }, { role: "ai", text: aiText }]);
    } finally {
      setStreaming(false); setAsking(false); markDone(id);
    }
  }

  // When a conversation is finished (the user leaves it), distil any DURABLE facts into the AI's long-term
  // memory (capable tiers only — it's a JSON extraction). Fire-and-forget; deduped; skips if nothing new
  // since the last distil of this chat. This is what makes the assistant remember across conversations.
  async function maybeDistil(turns: UITurn[], id: string | null) {
    if (!id) return;
    const real = turns.filter((t) => t.role === "you" || t.role === "ai");
    if (real.length < 2) return; // need at least one full exchange
    if ((distilledRef.current.get(id) ?? 0) >= real.length) return; // nothing new since last distil
    try {
      const av = await aiAvailability();
      if (capabilityLevel(av.backend, av.model) === "small") return; // tiny models can't distil reliably
      if ((distilledRef.current.get(id) ?? 0) >= real.length) return; // re-check after the await
      distilledRef.current.set(id, real.length);
      const transcript = real.map((t) => `${t.role === "you" ? "User" : "Assistant"}: ${t.text}`).join("\n").slice(0, 4000);
      const facts = await aiJson<string[]>(distilMemoryPrompt(transcript));
      // Tag the notes with the model/tier that wrote them, so a later capable pass can re-verify anything a
      // weaker model distilled (and, under dynamic routing, so a cheap model can't silently poison memory).
      if (Array.isArray(facts)) addNotes(facts.filter((f) => typeof f === "string"), "chat", { model: av.model, tier: capabilityLevel(av.backend, av.model) });
    } catch { /* best-effort memory — never block the UI */ }
  }

  // Submit: route the message. Actions (create/update) open a propose→confirm card; everything else
  // surfaces records + answers (with auto web-lookup). One box, one action.
  async function ask(override?: string) {
    const text = (override ?? q).trim();
    const attached = doc;
    // Block a CONCURRENT generation on this chat: `asking` only covers the pre-first-token window — once
    // tokens start, asking flips false and streaming flips true, so we must also gate on `streaming`. And
    // `isBusy(chatId)` is the durable cross-mount guard: the copilot can be closed + reopened mid-reply
    // (the generation keeps running + persisting), which resets the local asking/streaming flags — without
    // this, a second Enter would launch a racing generation that corrupts the same conversation.
    if ((!text && !attached) || asking || streaming || actionBusy || isBusy(chatIdRef.current) || !aiReady) {
      // They tried to ask but the AI isn't ready (no on-device model / no key). Demo-only, content-free.
      if ((text || attached) && !aiReady) track("ai_unavailable", { backend: activeBackend || "none" });
      return;
    }
    // Foreground wins: if a background scan is grinding the SAME local model, pause it so this reply comes
    // through quickly. It stays paused (banner shows Resume) — the user resumes when they're done chatting.
    if (sharesLocalModel && isAnalysisRunning()) pauseWarmthAnalysis();
    // Launcher mode (the top-bar quick palette): don't answer inline — hand the draft to the full Chat
    // surface, which opens a fresh conversation and runs it there.
    if (onAsk) { onAsk(text); setQ(""); return; }
    offerUpgradeIfOnNano(); // one-time: on Nano but a better on-device model is possible → encourage it
    const freshChat = !chatIdRef.current;
    if (freshChat) chatIdRef.current = newChatId();
    const id = chatIdRef.current as string; // set above (fresh) or already present
    // Demo analytics (no-op in the owned/sealed copy; content-free — category + counts only, never the text).
    // A cheap regex prior labels the intent for analytics only — the REAL routing is the unified LLM router
    // inside answer() (which decides action/tool/chat/book in one schema-constrained call, on every tier).
    const priorIntent = routeIntent(text || "summarise this document", { hasDoc: !!attached });
    if (freshChat) track("conversation_start", { backend: activeBackend || "unknown" });
    track("ai_prompt", { intent: priorIntent.kind, action: isActionIntent(priorIntent), hasDoc: !!attached, len: lenBucket(text.length), backend: activeBackend || "unknown" });
    const display = text || (attached ? `Uploaded “${attached.name}”` : "");
    const prior = chat;
    setChat([...prior, { role: "you", text: display + (attached ? `  📎 ${attached.name}` : "") }]);
    setQ("");
    setDoc(null);
    setView("chat");
    // Persist the user's message right away so the conversation appears in Recent chats the moment it's
    // sent — without waiting for the AI to reply. The answer/action path persists again with the reply.
    const priorTurns: ChatTurn[] = prior.filter((t) => t.role !== "action").map((t) => ({ role: t.role as "you" | "ai", text: t.text }));
    persistTo(id, [...priorTurns, { role: "you", text: display }]);
    // Mark this chat busy in the cross-mount tracker so the generation shows as "thinking" and survives the
    // user navigating away (the work keeps running and persists; a returning view reloads the answer).
    markBusy(id);
    try {
      // One routing brain: answer() runs the unified LLM router (action/tool/chat/book) and dispatches —
      // including opening the propose→confirm card when the model routes to an action.
      await answer(text || `Summarise the document “${attached?.name}”.`, prior, id, attached?.text);
    } finally {
      markDone(id);
    }
  }

  // The query/search/web/answer path (grounded in the tier-scaled context, plus any attached document).
  async function answer(text: string, prior: UITurn[], id: string, docText?: string) {
    setAsking(true);
    const history: ChatTurn[] = prior.filter((t) => t.role !== "action").map((t) => ({ role: t.role as "you" | "ai", text: t.text }));
    // Deterministic answers for date-range / ranking queries ("meetings last two weeks", "warmest leads",
    // "gone cold"): computed in code and rendered directly — the model can't fabricate dates, invent people,
    // or pad the table, and it's instant (no model call, which matters a lot on WebLLM). Skipped for docs.
    // Don't short-circuit a DRAFT/generation request ("draft a follow-up to my warmest lead") into a
    // LIST table — that wants the model to write something, not a roster. Only list/show/find queries.
    const isGenerate = /^\s*(draft|write|compose|prepare|prep|send|email|message|reply|respond)\b/i.test(text);
    const avail = await aiAvailability();
    // Render a computed result directly (clickable rows via `compute`); markdown kept for persistence + chips.
    const renderCompute = (computed: ComputeResult) => {
      const md = computeText(computed);
      // Only derive chips when there are REAL records — a "can't find / nothing matches" reply has no
      // entities worth anchoring to, and deriving them produces non-sequiturs (a stray "Smith" → "DS Smith").
      const chips = computed.rows.length ? chipsFromAnswer(md, data) : [];
      const base: UITurn[] = [...prior, { role: "you", text }];
      const tableTurn: UITurn = { role: "ai", text: md, compute: computed, chips: chips.length ? chips : undefined };
      const persisted: ChatTurn[] = [...history, { role: "you", text }];
      const tablePersist: ChatTurn & { compute?: ComputeResult } = { role: "ai", text: md, chips: chips.length ? chips : undefined, compute: computed };
      // The follow-on read. The factual "About <company>" web blurb is appended ONLY when the user asks about
      // the COMPANY itself (what does X do / tell me about X) — NOT on a footprint/depth question ("how deep at
      // X", "lay of the land"), where a Wikipedia paragraph is irrelevant padding. Otherwise an analytical
      // result gets the compute→interpret read (what stands out + a next move), on every tier with a real model.
      const wantsCompanyFacts = /\b(what (?:does|do)\b[^?]*\bdo\b|tell me about|background on|profile of|overview of|describe|what kind of (?:company|business|firm|outfit))\b/i.test(text)
        && !/\b(how deep|lay of the land|footprint|presence|coverage|penetration|what do i (?:know|have)|my (?:relationship|history|contacts?|footprint|presence))\b/i.test(text);
      const willEnrich = computed.enrich?.kind === "company" && wantsCompanyFacts;
      const cap = isCapableBackend(avail.backend);
      const willInterpret = !willEnrich && (cap || avail.backend === "webllm") && shouldInterpretResult(text, computed);
      // COMPOSED DELIVERY (decided during Gate-0): hold the table until the narration is ready and deliver
      // them together as ONE complete answer — two-stage delivery read as "partial answer, then more than
      // the answer". The wait shows the STAGED indicator ("Reading your book… → Computing… → Writing…");
      // a narration timeout/failure still delivers the table with a quiet note (the numbers never wait on
      // a broken model). Turns with no narration render immediately as before.
      persistTo(id, [...persisted, tablePersist]);
      markDone(id);
      if (willInterpret) {
        if (chatIdRef.current === id) setChat(base); // question + staged spinner; the composed answer lands once
        setStagedThinking(true);
        void interpretCompute(text, md, id, base, tableTurn, persisted, tablePersist, "above").finally(() => setStagedThinking(false));
      } else {
        if (chatIdRef.current === id) setChat([...base, tableTurn]);
        setAsking(false);
        if (willEnrich) void enrichCompany(computed.enrich!.name, id, [...base, tableTurn], [...persisted, tablePersist]);
      }
    };
    // Confidentiality question → answer accurately from the LIVE backend (never the model, which over-promises
    // "nothing is sent anywhere" even on a cloud tier). Deterministic, so it's correct and identical every time.
    // PRIVACY stays a deterministic accuracy floor (like the crisis floor) — the model over-promises
    // "nothing leaves" even on a cloud tier, so we never let it answer this. Everything ELSE (incl. "what
    // can you do") goes through the LLM router below — capabilities is a router "help" route, not a pre-gate.
    if (!docText && !isGenerate) {
      const priv = privacyResponse(text, avail);
      if (priv) { renderCompute(priv); return; }
    }
    // DETERMINISTIC SAFETY FLOOR — a distress signal must NEVER depend on the model routing correctly. Checked
    // before the router, on every tier, so a tiny model can't misroute "I want to end it" into a pipeline query.
    if (!docText) {
      const prevUserText0 = [...prior].reverse().find((tn) => tn.role === "you")?.text || "";
      const prevComp0 = !!prevUserText0 && conversationPath(prevUserText0, data) === "companion";
      // A farewell / goodbye / final NOTE draft is caught by the crisis floor ONLY when distress co-occurs
      // (this turn or the one before) — so "write a goodbye note, I can't do this anymore" isn't handled as a
      // drafting task, while a benign "draft a farewell note for my retiring colleague" (no distress) still
      // drafts normally. Deliberately narrow, so we don't false-fire the canned crisis response.
      const farewellDraft = /\b(?:draft|write|compose|help me (?:to )?write|prepare|pen)\b[^.?!]*\b(?:goodbye|good-?bye|farewell|final|last)\s+(?:note|letter|message|email|text|word)s?\b/i.test(text);
      const distressNear = crisisSignal(text) || heavyDistress(text) || crisisSignal(prevUserText0) || heavyDistress(prevUserText0);
      if (conversationPath(text, data, prevComp0) === "crisis" || (farewellDraft && distressNear)) {
        persistTo(id, [...history, { role: "you", text }, { role: "ai", text: CRISIS_RESPONSE }]);
        if (chatIdRef.current === id) setChat([...prior, { role: "you", text }, { role: "ai", text: CRISIS_RESPONSE }]);
        setAsking(false); markDone(id);
        return;
      }
    }
    // DETERMINISTIC PERSONAL FLOOR — the same principle as the crisis floor, one notch down. A CLEARLY
    // personal/emotional message (small talk, a life/career decision, or a personal register with no BD
    // intent) is routed to the companion BEFORE the LLM router runs — so a tiny on-device router can't
    // misroute "I feel worthless, work is grinding me down" into a pipeline/book answer. The LLM router
    // still owns all the normal routing (which tool / action / help / book); this only pre-empts the
    // narrow, safety-relevant personal case. A genuine BD ask carries book intent and is NOT caught here.
    // clearlyPersonal already returns false for any BD/book intent (the BOOK_INTENT guard), so a legit
    // "draft a follow-up to my warmest lead" is NOT caught here and still routes to the book — but a personal
    // draft ("draft a message to my wife about the divorce") correctly goes to the companion, even though it's
    // a generate request. That's why this floor is NOT gated on !isGenerate.
    if (!docText && clearlyPersonal(text)) {
      await streamCompanion(text, prior, id, history, capabilityLevel(avail.backend, avail.model));
      return;
    }
    if (!docText && !isGenerate) {
      // DETERMINISTIC BD PRE-PASS (before the LLM router, every tier): unambiguous book questions — the agenda,
      // meetings by date, rankings, pipeline stats, sector filters, account/contact briefs, exact maths — are
      // routed IN CODE so the (chatty) LLM router can't mis-send them to companion/chit-chat. Real testing on a
      // 26k book showed the cloud router routing "who should I chase", "footprint at X", "who did I speak to",
      // "what's in my diary" all to the companion. computeForQuery DEFERS genuinely nuanced/advice/drafting
      // queries (isReasoningRequest → null) to the LLM router below; the crisis/personal floors already ran.
      // PRE-PASS SPLIT (the Gate-0 root-cause fix — restores the July design that was never wired):
      // CAPABLE tiers get ONLY the NARROW exact rail (computeExact — floors, exact record names, counts,
      // aggregate maths, anti-joins/joins) and then the LLM ROUTER routes everything else — the broad
      // greedy keyword router no longer short-circuits a capable model's routing. SMALL tiers (WebLLM/
      // Nano — no LLM router) keep the full keyword router as their router, now with the constraint/
      // deixis/negation guards. The keyword router remains the error fallback for capable tiers below.
      const prevUserText = [...prior].reverse().find((tn) => tn.role === "you")?.text;
      const preCapable = capabilityLevel(avail.backend, avail.model) !== "small";
      const pre = preCapable ? computeExact(text, data, today) : computeForQuery(text, data, today, prevUserText);
      if (pre) { renderCompute(pre); return; }
      // DETERMINISTIC ACTION PRE-CHECK: an EXPLICIT record command ("add a contact", "log a meeting with Tom",
      // "create an opportunity") opens the propose→confirm card in code — the chatty LLM router was sending a
      // bare "add a contact" to companion ("give me their details…") instead of the empty form. Scoped to the
      // dictionary phrasings (not the softer "met/coffee" signal) so reflective turns still reach the model.
      const actIntent = routeIntent(text, { hasDoc: false });
      if (isActionIntent(actIntent) && actIntent.entity && actIntent.source === "dictionary") {
        await startAction(actIntent.entity, actIntent.op ?? "create", actIntent.target ?? text, text, prior, id, text);
        return;
      }
      // UNIFIED LLM FUNCTION-CALLING ROUTER — PRIMARY on capable tiers (BYOK cloud, local Ollama/LM Studio large
      // models, on-prem). ONE schema-constrained call maps the message (however oblique) to the single best of
      // ~21 deterministic TOOLS + args, or a personal CHAT, or open-ended BOOK advice. This is the thing an LLM
      // is genuinely good at (intent understanding), so we trust it here instead of enumerating phrasings in
      // regex. WebLLM (a small 3B) can't tool-select reliably — and a 21-tool prompt makes it WORSE — so it
      // SKIPS the LLM router entirely and rides the deterministic regex path (computeForQuery already ran above;
      // the regex fallback below finishes the job). Capable models that fluff the call also fall back gracefully.
      // 22 s cap so a cold/stalled model can't hang on "Thinking…" — on timeout we treat it as a failed call.
      let routed: RouteResult | null = null;
      const routerCapable = capabilityLevel(avail.backend, avail.model) !== "small";
      if (routerCapable) {
        let routeTimer: ReturnType<typeof setTimeout> | undefined;
        const routeTimeout = new Promise<null>((resolve) => { routeTimer = setTimeout(() => resolve(null), 22_000); });
        try { routed = await Promise.race([aiJson<RouteResult>(routerPrompt(text, history)), routeTimeout]); }
        catch { routed = null; }
        finally { if (routeTimer) clearTimeout(routeTimer); }
      }
      if (routed?.route === "help") {
        // Capability/meta question → the canonical capabilities answer (code, not the model), tailored to the
        // domain the question names (and varied across general asks so it doesn't read identically each time).
        renderCompute(capabilitiesResult(text));
        return;
      } else if (routed?.route === "action" && routed.entity) {
        // The model says the user is recording data → open the propose→confirm card (fields extracted by the
        // model inside startAction). text is both the display bubble and the extraction source (no attachment here).
        await startAction(routed.entity, routed.op ?? "create", text, text, prior, id, text);
        return;
      } else if (routed?.route === "tool" && routed.tool) {
        const result = runTool({ tool: routed.tool, args: routed.args }, data, today);
        // Empty tool result → don't dead-end; fall through to the grounded book answer below.
        if (result && (result.rows.length || result.intro)) { renderCompute(result); return; }
      } else if (routed?.route === "chat") {
        await streamCompanion(text, prior, id, history, capabilityLevel(avail.backend, avail.model));
        return;
      } else if (!routed || routed.route !== "book") {
        // ERROR / INVALID-ROUTE FALLBACK — the model call failed, timed out, or returned an incomplete/unknown
        // decision: null, a missing `route`, or an actionable route with the required field absent (e.g. {},
        // {stub:true}, route:"action" with no entity, route:"tool" with no tool). Any of these must NOT silently
        // skip to a generic book answer, so we run the deterministic regex router (old behaviour), which also
        // covers ACTIONS (regex action-intent → the same card) and capability questions. NOTE: route:"book" is a
        // DELIBERATE model choice and is deliberately excluded here — it falls through to the grounded book answer.
        const cap = capabilitiesResponse(text);
        if (cap) { renderCompute(cap); return; }
        const rgx = routeIntent(text, { hasDoc: false });
        if (isActionIntent(rgx) && rgx.entity) {
          await startAction(rgx.entity, rgx.op ?? "create", rgx.target ?? text, text, prior, id, text);
          return;
        }
        const prevText = [...prior].reverse().find((tn) => tn.role === "you")?.text;
        const computed = computeForQuery(text, data, today, prevText);
        if (computed) { renderCompute(computed); return; }
        const prevUserText = [...prior].reverse().find((tn) => tn.role === "you")?.text || "";
        const prevCompanion = !!prevUserText && conversationPath(prevUserText, data) === "companion";
        if (conversationPath(text, data, prevCompanion) === "companion") {
          await streamCompanion(text, prior, id, history, capabilityLevel(avail.backend, avail.model));
          return;
        }
      }
      // routed.route === "book" (or a tool that returned nothing) → grounded book answer below.
    }
    const g = searchBook(text, data);
    const related: RelatedHit[] = g && !g.empty ? collectRelated(g) : [];
    // A "list everyone who…" question → a clickable jump to the real filtered list (complete + accurate),
    // shown first, instead of relying on the model to enumerate it.
    const viewLink = detectView(text);
    if (viewLink) related.unshift(viewLink);
    // Also surface book entities NAMED in the message even if the literal search missed them (e.g. "show
    // me everyone at EY" → an EY account card), so a records request always gives something to click.
    for (const h of entityHits(text, data)) {
      if (related.length >= 6) break;
      // Cross-kind dedup too (Gate-0 #42): "HSBC" + "HSBC — Technology engagement" + "Technology
      // engagement · HSBC" used to render as three cards for one account — one entity, one card.
      const key = (r: { main?: string; meta?: string } & Record<string, unknown>) => `${r.main || ""}|${r.meta || ""}`.toLowerCase().replace(/[^a-z0-9|]+/g, "");
      const dup = related.some((r) =>
        (r.kind === "company" && h.kind === "company" && r.org === h.org) ||
        (r.kind === "record" && h.kind === "record" && r.id === h.id) ||
        key(r as Record<string, unknown>) === key(h as Record<string, unknown>));
      if (!dup) related.push(h);
    }
    let webContext = "";
    if (!docText && (routeIntent(text).kind === "web" || needsWeb(text))) {
      try {
        if (await searchAvailable()) {
          const results = await searchWeb(text, 3);
          webContext = results.map((r) => `- ${decodeEntities(r.title)}: ${decodeEntities(r.snippet || "").slice(0, 160)} (${r.url})`).join("\n");
          for (const r of results.slice(0, 3)) related.push({ kind: "web", url: r.url, main: decodeEntities(r.title), meta: decodeEntities(r.snippet || "").slice(0, 100) });
        }
      } catch { /* best-effort */ }
    }
    try {
      const budget = await contextBudget();
      // The full DATA grounding: book context + the records the message NAMES (apostrophe-robust) + any
      // sector/function subset it asks for + a resolved "warmest lead". Shared with the eval harness so we
      // tune the real thing. (Memory + uploaded doc are app-state, layered on below.)
      // Recent context so entity resolution carries the person/company named earlier in the thread — a
      // follow-up like "make it more formal" or "and her?" must still know who "her"/"him" is. Widened to the
      // last 8 turns to match the answer prompt's own history window (was 2, which silently dropped a subject
      // named 5 turns back). assembleGrounding/mergeGroups prioritises current-message hits, so a stale earlier
      // entity can't crowd out a fresh one.
      const convo = history.slice(-8).map((h) => h.text).join("\n");
      let grounding = assembleGrounding(text, data, budget.grounding, today, convo);
      // Ambient memory: durable facts distilled from past chats, surfaced when relevant so the assistant
      // "remembers" across conversations. Fit them to the memory allocation (most-relevant/newest first) so on
      // a small model they can't crowd out the records — instead of a fixed note count regardless of window.
      const memNotes = relevantNotes(text, 8);
      if (memNotes.length) {
        const lines: string[] = [];
        let usedMem = 0;
        for (const n of memNotes) {
          const line = `- ${n.text}`;
          if (usedMem + line.length > budget.memory && lines.length) break;
          lines.push(line);
          usedMem += line.length + 1;
        }
        grounding += `\n\nMemory from past chats (use only if relevant):\n${lines.join("\n")}`;
      }
      if (docText) grounding += `\n\nAttached document the user uploaded (answer from this for the document; cite it):\n${docText.slice(0, Math.max(2000, budget.grounding))}`;
      // Small models (Nano + WebLLM-3B) get the SLIMMED persona — they follow a short, punchy instruction
      // set far more faithfully (and warmly) than the long one. CAPABLE backends (BYOK cloud OR a local
      // Ollama running a real model) get the full nuanced persona. Gate on capability, not the tier.
      const capable = isCapableBackend(avail.backend);
      const compact = !capable;
      // Only a capable backend runs the extra chip-generation round-trip — small on-device models are too
      // slow for a second call and too unreliable at JSON, so there we use the instant deterministic chips.
      const canGenChips = capable;
      // STREAM the answer in — show it forming token-by-token instead of a long "Thinking…". On the first
      // token we drop the spinner and start rendering the partial reply.
      const relatedOrUndef = related.length ? related : undefined;
      let firstTok = true;
      let bailed = false;
      const streamP = aiPromptStream(askBookPrompt(text, grounding, history, webContext, compact, budget.history), (full) => {
        if (bailed || chatIdRef.current !== id) return;
        if (firstTok) { firstTok = false; setAsking(false); setStreaming(true); }
        setGenTokens(approxTokens(full));
        setChat([...prior, { role: "you", text }, { role: "ai", text: full, related: relatedOrUndef }]);
      });
      // Safety net: a small on-device model can stall on load/prefill (WebLLM runs one job at a time). If NO
      // token has streamed within the window, stop waiting and fall back gracefully (the catch below surfaces
      // any matched records) instead of leaving the user on an endless "Thinking…".
      const reply = await Promise.race([
        streamP,
        firstTokenStall(() => firstTok, () => !!aiLoadRef.current?.active, () => { bailed = true; }),
      ]);
      setStreaming(false);
      const aiText = reply.trim() || "(no response)";
      // Chips come ONLY from who the answer actually names (accurate on every tier). If the answer named
      // nobody recognisable (e.g. a purely analytical reply), show no chips here rather than inventing a
      // random book contact/company — the model-generated, answer-validated chips below may still add some.
      const answerChips = chipsFromAnswer(aiText, data);
      const baseOrUndef = answerChips.length ? answerChips : undefined;
      persistTo(id, [...history, { role: "you", text }, { role: "ai", text: aiText, chips: baseOrUndef }]);
      // Finalise the rendered turn (with chips + related) now the stream is complete.
      if (chatIdRef.current === id) setChat([...prior, { role: "you", text }, { role: "ai", text: aiText, related: relatedOrUndef, chips: baseOrUndef }]);
      setAsking(false);
      markDone(id);
      // On the cloud tier only: upgrade to chips generated FROM the answer (more varied phrasing), validated
      // so they can't name anyone outside the answer/book. On-device tiers keep the deterministic chips above.
      if (canGenChips) {
        const generated = chipNamesInAnswer(await generateChips(text, aiText.slice(0, 1600), grounding.slice(0, 2400)), aiText, data);
        if (generated.length && chatIdRef.current === id) {
          setChat([...prior, { role: "you", text }, { role: "ai", text: aiText, related: relatedOrUndef, chips: generated }]);
          persistTo(id, [...history, { role: "you", text }, { role: "ai", text: aiText, chips: generated }]);
        }
      }
    } catch {
      // Even if the model errors, still surface any records the message pointed at (e.g. the EY account
      // card) so a records request isn't a dead end.
      const relatedOrUndef = related.length ? related : undefined;
      const aiText = relatedOrUndef
        ? "Sorry — the on-device model stalled before it finished that one, but I did pull these from your book in the meantime — open any of them:"
        : "Sorry about that — the on-device model took too long to respond (it can be slow to warm up the first time). Mind giving it another go? It's usually quicker the second time.";
      persistTo(id, [...history, { role: "you", text }, { role: "ai", text: aiText }]);
      if (chatIdRef.current === id) setChat([...prior, { role: "you", text }, { role: "ai", text: aiText, related: relatedOrUndef }]);
    } finally {
      setStreaming(false);
      setAsking(false);
    }
  }

  // Begin an action: resolve the subject contact, extract fields (from the message + any document),
  // and open a review card.
  // Build a "which record did you mean?" turn for an UPDATE we couldn't resolve to a single record — so we
  // never silently open a create-shaped card. Chips re-issue an explicit, resolvable command (routeIntent
  // maps `Update the "X" opportunity` / `Log a meeting with N` deterministically, so this survives a flaky
  // LLM router).
  function buildUpdateClarification(kind: "opportunity" | "meeting", target: string, subjectUrl: string | undefined, oppCandidates: Opportunity[]): UITurn {
    const CAP = 6;
    if (kind === "opportunity") {
      // Newest-first (the state array is insertion-ordered with fresh saves appended) so a just-created
      // deal is ALWAYS offered — the old head-slice dropped it past position 6 (Gate-0 #35/#36).
      const pool = oppCandidates.length ? oppCandidates : [...opps].reverse().filter((o) => !o.lost);
      const chips: Chip[] = pool.slice(0, CAP).map((o) => {
        const name = o.opportunity_name || o.organisation || "opportunity";
        return { label: name, prompt: `Update the "${name}" opportunity` };
      });
      chips.push({ label: "+ New opportunity", prompt: `Log a new opportunity${target ? ` for ${target}` : ""}` });
      const text = oppCandidates.length
        ? "A few deals could match — which one?"
        : opps.length ? "I couldn't tell which deal you meant. Which one?"
        : "You don't have any opportunities yet — want to log one?";
      return { role: "ai", text, chips };
    }
    // meeting
    if (subjectUrl) {
      const c = contacts.find((x) => x.url === subjectUrl);
      const name = c ? `${c.first} ${c.last}`.trim() : "them";
      return { role: "ai", text: `I couldn't find a meeting logged with ${name} yet. Want to log one?`, chips: [{ label: `Log a meeting with ${name}`, prompt: `Log a meeting with ${name}` }] };
    }
    const cand = matchContacts(target, contacts).slice(0, CAP);
    if (cand.length) {
      const chips: Chip[] = cand.map((c) => { const n = `${c.first} ${c.last}`.trim(); return { label: n, prompt: `Update my meeting with ${n}` }; });
      return { role: "ai", text: "Which contact's meeting do you mean?", chips };
    }
    return { role: "ai", text: "I couldn't find that contact — tell me who the meeting was with and I'll update it.", chips: [] };
  }

  async function startAction(kind: "contact" | "meeting" | "opportunity" | "contract", op: "create" | "update", target: string, display: string, prior: UITurn[], id: string, extractText: string) {
    setAsking(false); // the card takes over from the thinking spinner — this flag used to leak true forever (Gate-0 #29 spinner)
    setActionBusy(true);
    const spec = SPECS[kind];
    // CREATE-a-contact makes a NEW person, so there's no existing contact to resolve/pick.
    const needsContact = spec.needsContact && !(kind === "contact" && op === "create");
    // SUBJECT RESOLUTION — for EVERY action kind (Gate-0 #29/#34/#40: opportunities/contracts used to skip
    // this entirely because needsContact=false, which is exactly why "for them"/"for Daniel" left blank or
    // contaminated fields; a resolved subject now feeds the extract's contact + employer defaults).
    // Order: (1) the DETERMINISTIC command-clause span ("…note TO Karen OConnor: body" → "Karen OConnor" —
    // the note body never reaches the name matcher, killing the Grace Walker class of wrong-person match);
    // (2) the legacy with-name regex + full-target fallback, only for needsContact kinds; (3) pronoun carry
    // from the most recent prior turn naming exactly one contact — for ALL kinds now.
    let subjectUrl: string | undefined;
    {
      const span = extractSubjectSpan(target) || (extractText !== target ? extractSubjectSpan(extractText) : "");
      const pronounOnly = /^(?:them|him|her|they|he|she|it|that|this)$/i.test(span);
      let matches = span && !pronounOnly ? matchContacts(span, contacts) : [];
      if (matches.length !== 1 && needsContact) {
        const withName = target.match(/\b(?:with|for|to|re|about)\s+([A-Za-z][A-Za-z'’.-]+(?:\s+[A-Za-z][A-Za-z'’.-]+){0,2})/)?.[1];
        if (!matches.length && withName) matches = matchContacts(withName, contacts);
        if (matches.length !== 1) { const mm = matchContacts(target, contacts); if (mm.length) matches = mm; }
      }
      if (matches.length === 1) subjectUrl = matches[0].url;
      // PRONOUN-led follow-up ("add a meeting with HIM tomorrow", "create an opportunity for THEM") — the
      // message names no one, so resolve the subject from the most recent prior turn that unambiguously did.
      if (!subjectUrl && (pronounOnly || /\b(him|her|hers|his|them|their|they|he|she|it|that|this|those|these)\b/i.test(target))) {
        for (const t of [...prior].reverse().slice(0, 8)) {
          if (t.role !== "you") continue;
          const m = matchContacts(extractSubjectSpan(t.text) || t.text, contacts);
          if (m.length >= 1) { if (m.length === 1) subjectUrl = m[0].url; break; }
        }
      }
    }
    // For an UPDATE to an opportunity, resolve WHICH existing deal it is ("the JPMorgan deal") so the form
    // pre-fills with its real values and confirming edits it in place. Auto-target ONLY on a single match —
    // 0 or several are ambiguous and get clarified below (never silently pick one / create a duplicate).
    // "That/it" straight after a create/update in THIS session auto-targets the record just touched
    // (Gate-0 #35/#36: the picker used to omit the just-created deal entirely).
    let targetId: string | undefined;
    let oppCandidates: Opportunity[] = [];
    if (op === "update" && kind === "opportunity") {
      oppCandidates = matchOpportunity(`${target} ${extractText}`, opps);
      if (oppCandidates.length === 1) targetId = oppCandidates[0].id;
      if (!targetId && !oppCandidates.length && /\b(that|it|this)\b/i.test(target) && lastOppIdRef.current && opps.some((o) => o.id === lastOppIdRef.current)) {
        targetId = lastOppIdRef.current;
      }
    }
    // For an UPDATE to a meeting, edit the resolved contact's MOST RECENT meeting in place (no duplicate).
    if (op === "update" && kind === "meeting" && subjectUrl) {
      const theirs = meetingRows
        .filter((m) => m.contact_url === subjectUrl)
        .sort((a, b) => (b.date_held || b.date_scheduled || "").localeCompare(a.date_held || a.date_scheduled || ""));
      if (theirs.length) targetId = theirs[0].id;
    }
    // An UPDATE we couldn't pin to ONE existing record → ASK which one (or offer to create) rather than open a
    // create-shaped card that writes a duplicate on confirm. write() also hard-guards this as a backstop.
    if (op === "update" && !targetId && (kind === "opportunity" || kind === "meeting")) {
      const turn = buildUpdateClarification(kind, target, subjectUrl, oppCandidates);
      setActionBusy(false);
      if (chatIdRef.current === id) setChat([...prior, { role: "you", text: display }, turn]);
      return;
    }
    // The LLM does the field-extraction on EVERY tier — it interprets which parts of the message map to which
    // field (and leaves fields blank when the message doesn't actually contain them), rather than a brittle
    // deterministic split that turned "Can I add a contact" into First="Can", Last="I". Worth the call.
    const skipModel = false;
    const ctx = { op, text: extractText, subjectUrl, targetId, today, contacts, meetingRows, opps, sows, skipModel };
    // The model field-extraction is best-effort — a slow/stuck cloud call must NOT hang the card behind the
    // "thinking" spinner (a real 150s+ stall was observed). Bound it, and on timeout fall back to the INSTANT
    // deterministic prefill (skipModel) so the card opens right away with what code could parse.
    let values: Record<string, string> = {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("extract-timeout")), 12000); });
      values = await Promise.race([spec.extract(ctx), timeout]);
    } catch {
      try { values = await spec.extract({ ...ctx, skipModel: true }); } catch { /* card opens with blanks */ }
    } finally {
      if (timer) clearTimeout(timer);
    }
    const fields = typeof spec.fields === "function" ? spec.fields(op) : spec.fields;
    const card: ActionCardData = { kind, op, title: spec.title(ctx), fields, values, needsContact, subjectUrl, targetId, status: "draft" };
    let lead = op === "create" ? `Here's a draft ${spec.label.toLowerCase()} from what you said — check it${needsContact && !subjectUrl ? ", pick the contact" : ""} and confirm to save.` : `Here's the change — review and confirm to update.`;
    // A meeting UPDATE defaults to the contact's MOST RECENT meeting; when they have several, name WHICH one
    // in the lead (date + who) so the user can't silently confirm an edit to the wrong call — they can say the
    // date if they meant a different one. (R7b: never silently pick among several and pass it off as correct.)
    if (op === "update" && kind === "meeting" && targetId) {
      const m = meetingRows.find((x) => x.id === targetId);
      const same = m ? meetingRows.filter((x) => x.contact_url === m.contact_url).length : 0;
      if (m && same > 1) {
        const c = contacts.find((x) => x.url === m.contact_url);
        const when = m.date_held || m.date_scheduled || "—";
        lead = `Editing your ${when} meeting with ${c ? `${c.first} ${c.last}`.trim() : "them"} — your most recent of ${same}. If you meant a different one, tell me the date. Review and confirm.`;
      }
    }
    setActionBusy(false);
    // Persist the DRAFT (lead + interactive card) so it survives the user leaving the thread and coming back
    // (#28) — the card is fully serializable and the render loop rebuilds it interactively by index. Confirm /
    // cancel below re-persist the resolved outcome (a saved card collapses to its summary line).
    if (chatIdRef.current === id) {
      const draftTurns: UITurn[] = [...prior, { role: "you", text: display }, { role: "ai", text: lead }, { role: "action", text: "", action: card }];
      setChat(draftTurns);
      persistTo(id, serializeForPersist(draftTurns));
    }
  }

  function confirmAction(idx: number, values: Record<string, string>, subjectUrl?: string) {
    const card = chat[idx]?.action;
    if (!card) return;
    setActionBusy(true);
    try {
      const ctx = { op: card.op, text: "", subjectUrl, targetId: card.targetId, today, contacts, meetingRows, opps, sows };
      const res = SPECS[card.kind].write(values, ctx);
      if (card.kind === "opportunity") lastOppIdRef.current = res.id;
      const subject = subjectUrl ? contacts.find((c) => c.url === subjectUrl) : undefined;
      const subjectName = subject ? `${subject.first} ${subject.last}`.trim() : "";
      const follow = actionFollowUp(card.kind, values, subjectName);
      // A clickable link to the record we just created, so the user can jump straight to it.
      const tabFor: Record<typeof card.kind, TabId> = { opportunity: "opportunities", meeting: "meetings", contact: "contacts", contract: "revenue" };
      const openId = card.kind === "contact" ? (subjectUrl || res.id) : res.id;
      const viewHit: RelatedHit = { kind: "view", tab: tabFor[card.kind], intent: { openId }, main: `Open the ${SPECS[card.kind].label.toLowerCase()}`, meta: "View the new record" };
      // Mark the card saved, then append the AI's "what's next?" offer with the view link + chips.
      const next: UITurn[] = chat.map((t, i) => (i === idx ? { ...t, action: { ...card, status: "saved", values, subjectUrl, savedSummary: res.summary }, undo: res.undo } : t));
      next.push({ role: "ai", text: follow.text, related: [viewHit], chips: follow.chips });
      setChat(next);
      reloadData();
      if (chatIdRef.current) persistTo(chatIdRef.current, serializeForPersist(next));
    } catch (e) {
      // The write layer rejects an UPDATE with no resolved target rather than creating a duplicate — surface
      // that specifically so the user can name the record instead of hitting a generic failure.
      const msg = e instanceof Error && e.message === "UNRESOLVED_UPDATE"
        ? "I couldn't tell which existing record to update — tell me which one (by name) and I'll change it."
        : "That didn't save — please try again.";
      setChat((c) => [...c, { role: "ai", text: msg }]);
    } finally {
      setActionBusy(false);
    }
  }
  function cancelAction(idx: number) {
    // Replace the card with a plain note, and drop the preceding "confirm to save" lead so the persisted
    // transcript reads cleanly.
    const dropLead = idx > 0 && chat[idx - 1].role === "ai";
    const next = chat.flatMap((t, i) => {
      if (i === idx) return [{ role: "ai", text: "No problem — I didn't save anything." } as UITurn];
      if (i === idx - 1 && dropLead) return [];
      return [t];
    });
    setChat(next);
    if (chatIdRef.current) persistTo(chatIdRef.current, serializeForPersist(next));
  }
  function undoAction(idx: number) {
    chat[idx]?.undo?.();
    reloadData();
    const next = chat.map((t, i) => (i === idx ? { role: "ai", text: "Undone — I removed that change." } as UITurn : t));
    setChat(next);
    if (chatIdRef.current) persistTo(chatIdRef.current, serializeForPersist(next));
  }

  function startNew() { void maybeDistil(chat, chatIdRef.current); setChat([]); chatIdRef.current = null; setQ(""); setView("search"); }
  function openHistory() { setSaved(listChats()); setView("history"); }
  function openChat(c: SavedChat) { void maybeDistil(chat, chatIdRef.current); setChat(c.turns); chatIdRef.current = c.id; setQ(""); setView("chat"); }
  function removeChat(id: string) { deleteChat(id); setSaved(listChats()); onChatsChanged?.(); }
  function openMemory() { setNotes(listNotes()); setView("memory"); }
  function removeNote(id: string) { deleteNote(id); setNotes(listNotes()); }
  function clearAllNotes() { clearNotes(); setNotes([]); }

  const renderRelated = (related?: RelatedHit[]) =>
    related && related.length > 0 ? (
      <div className="copilot-turn-related">
        {related.map((h, j) =>
          h.kind === "web" ? (
            <a key={"w" + j} className="copilot-related copilot-related--web" href={h.url} target="_blank" rel="noreferrer">
              <span className="copilot-related-main">{h.main}</span>
              <span className="copilot-related-meta">{h.meta}</span>
            </a>
          ) : (
            <button key={"r" + j} type="button" className={"copilot-related" + (h.kind === "view" ? " copilot-related--view" : "")} onClick={() => { if (h.kind === "company") { if (onOpenAccount) onOpenAccount(h.org); else onNavigate("contacts", { search: h.org }); } else if (h.kind === "view") { onNavigate(h.tab, h.intent); } else { onNavigate(h.tab, { openId: h.id }); } onClose(); }}>
              <span className="copilot-related-main">{h.main}</span>
              <span className="copilot-related-meta">{h.meta}</span>
            </button>
          ),
        )}
      </div>
    ) : null;

  const chatTitle = chat.length ? titleFromTurns(chat) : "New chat";

  // History search: match the title first, then (secondarily) the message bodies — body-only matches
  // are listed after the title matches.
  const histQ = histQuery.trim().toLowerCase();
  const titleHits = histQ ? saved.filter((c) => c.title.toLowerCase().includes(histQ)) : saved;
  const titleHitIds = new Set(titleHits.map((c) => c.id));
  const bodyHits = histQ ? saved.filter((c) => !titleHitIds.has(c.id) && c.turns.some((t) => t.text.toLowerCase().includes(histQ))) : [];
  const renderChatItem = (c: SavedChat) => (
    <div key={c.id} className="copilot-chatitem">
      <button type="button" className="copilot-chatitem-main" onClick={() => openChat(c)}>
        <span className="copilot-chatitem-title">{c.title}</span>
        <span className="copilot-chatitem-meta">{relativeTime(c.updatedAt)} · {c.turns.length} message{c.turns.length === 1 ? "" : "s"}</span>
      </button>
      <button type="button" className="copilot-chatitem-del" onClick={() => removeChat(c.id)} aria-label="Delete chat" title="Delete">✕</button>
    </div>
  );

  return (
    <div className={"copilot-backdrop" + (fullPage ? " copilot-backdrop--inline" : "")} onClick={fullPage ? undefined : onClose}>
      <div className={"copilot copilot--" + view + (fullPage ? " copilot--fullpage" : "")} role="dialog" aria-label="Ask or search your book" onClick={(e) => e.stopPropagation()}>
        <input ref={docInputRef} type="file" accept=".txt,.md,.csv,.tsv,.json,.vtt,.srt,text/*,application/json" style={{ display: "none" }} onChange={(e) => { onPickFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
        {view === "chat" && (
          <div className="copilot-head">
            {saved.length > 0 && <button type="button" className="copilot-headbtn" onClick={openHistory}>‹ Chats</button>}
            <span className="copilot-head-title">{chatTitle}</span>
            {aiReady && activeBackend && (
              <span className="copilot-head-model" title={`AI model in use: ${aiLabel}${shortModelName(aiModel) ? ` · ${shortModelName(aiModel)}` : ""}. Managed by Freehold.`}>
                <span className="copilot-tier-dot" />{shortModelName(aiModel) || aiLabel}
              </span>
            )}
            <button type="button" className="copilot-headbtn" onClick={startNew}>+ New</button>
          </div>
        )}
        {view === "history" && (
          <>
            <div className="copilot-head">
              <span className="copilot-head-title">Your chats</span>
              <button type="button" className="copilot-headbtn" onClick={openMemory}>What I remember</button>
              <button type="button" className="copilot-headbtn" onClick={startNew}>+ New chat</button>
            </div>
            <div className="copilot-histsearch">
              <span className="copilot-histsearch-ico" aria-hidden>⌕</span>
              <input
                className="copilot-histsearch-input"
                placeholder="Search your chats…"
                value={histQuery}
                onChange={(e) => setHistQuery(e.target.value)}
              />
              {histQuery && <button type="button" className="copilot-clear" onClick={() => setHistQuery("")} aria-label="Clear" title="Clear">✕</button>}
            </div>
          </>
        )}

        {view === "search" && (
          // One composer that self-degrades: with AI it's the assistant; without AI configured it's a clean
          // deterministic search box (AI features simply don't render). No in-app setup ladder — AI is set up
          // once at the Freehold level and inherited, so here we only POINT there when it isn't on.
          <div className={"copilot-search" + (q.trim() && !fullPage ? " copilot-search--active" : "")}>
            {(!q.trim() || fullPage) && (
              <div className="copilot-hero-head">
                <BusinessBookLogo size={44} />
                <h2 className="copilot-hero-title">{aiReady ? "What shall we work on?" : "Search your book"}</h2>
              </div>
            )}
            <div className="copilot-field">
              <GrowTextarea
                refCb={(el) => { inputRef.current = el; }}
                className="copilot-field-input"
                autoFocus
                placeholder={aiReady ? "How can I help you today?" : "Search contacts, meetings, opportunities…"}
                value={q}
                onChange={setQ}
                onEnter={() => ask()}
              />
              <div className="copilot-field-foot">
                {aiReady && <button type="button" className="copilot-plus" onClick={() => docInputRef.current?.click()} title="Add meeting notes, proposals, contracts and more" aria-label="Add meeting notes, proposals, contracts and more">+</button>}
                <span className="copilot-field-spacer" />
                {aiReady && <TierLabel />}
                {(q.trim() || doc) && <button type="button" className="copilot-clear" onClick={() => { setQ(""); setDoc(null); inputRef.current?.focus(); }} aria-label="Clear" title="Clear">✕</button>}
                {aiReady && (q.trim() || doc) && <button type="button" className="copilot-send2" disabled={asking || streaming || actionBusy} onClick={() => ask()} aria-label="Send" title="Send (Enter)">↑</button>}
              </div>
            </div>
            {(doc || docNote) && (
              <div className="copilot-doc">
                {doc ? (<><span className="copilot-doc-name">⎘ {doc.name}</span><button type="button" className="copilot-doc-x" onClick={() => setDoc(null)} aria-label="Remove">✕</button></>) : <span className="copilot-doc-note">{docNote}</span>}
              </div>
            )}
            {aiReady && !isCapableBackend(activeBackend) && !q.trim() && (
              <div className="copilot-capnote">
                You're on an <strong>on-device model</strong> — private and free, but its answers can be limited and occasionally off. For sharper, more reliable results, connect a more capable model — your own API key, or a local model — in your AI settings on Freehold.
              </div>
            )}
            {aiReady && !q.trim() && (
              <div className="copilot-starters">
                {starters.map((s, i) => (
                  <button key={s.text + i} type="button" className="copilot-starter" onClick={() => ask(s.text)}>
                    <span className="copilot-starter-label">{s.text}</span>
                  </button>
                ))}
              </div>
            )}
            {!aiReady && !q.trim() && (
              <p className="copilot-ai-off">The AI assistant isn't set up for this app. Turn it on from your Freehold <strong>AI settings</strong> (the ⚙ beside this app in your library) to unlock the copilot — everything else here works without it.</p>
            )}

            {q.trim() && !fullPage && (
              <div className="copilot-results">
                {groups?.empty && (
                  aiReady
                    ? <button type="button" className="copilot-empty copilot-empty--ask" onClick={() => ask()}>No direct matches — press Enter and I'll answer from your book →</button>
                    : <p className="copilot-empty">No matches.</p>
                )}
                {renderHits("People", groups?.people ?? [], "contacts")}
                {groups && groups.companies.length > 0 && (
                  <div className="copilot-group">
                    <div className="copilot-group-head">Companies</div>
                    {groups.companies.map((c) => (
                      <button key={"org" + c.org} type="button" className="copilot-hit" onClick={() => { if (onOpenAccount) onOpenAccount(c.org); else onNavigate("contacts", { search: c.org }); onClose(); }}>
                        <span className="copilot-hit-main">{c.org}</span>
                        <span className="copilot-hit-meta">{c.count} {c.count === 1 ? "person" : "people"}</span>
                      </button>
                    ))}
                  </div>
                )}
                {renderHits("Meetings", groups?.meetings ?? [], "meetings")}
                {renderHits("Opportunities", groups?.opps ?? [], "opportunities")}
                {renderHits("Engagements", groups?.contracts ?? [], "revenue")}
              </div>
            )}
          </div>
        )}

        {view === "history" && (
          <div className="copilot-history">
            {saved.length === 0 ? (
              <p className="copilot-empty">No saved chats yet. Ask your book a question to start one.</p>
            ) : titleHits.length === 0 && bodyHits.length === 0 ? (
              <p className="copilot-empty">No chats match “{histQuery}”.</p>
            ) : (
              <>
                {titleHits.map(renderChatItem)}
                {bodyHits.length > 0 && <div className="copilot-hist-sep">Found in messages</div>}
                {bodyHits.map(renderChatItem)}
              </>
            )}
          </div>
        )}

        {view === "memory" && (
          <>
            <div className="copilot-head">
              <button type="button" className="copilot-headbtn" onClick={openHistory}>‹ Chats</button>
              <span className="copilot-head-title">What I remember</span>
              {notes.length > 0 && <button type="button" className="copilot-headbtn" onClick={clearAllNotes}>Clear all</button>}
            </div>
            <div className="copilot-memory">
              <p className="copilot-memory-lede">Durable facts I've picked up from our chats — I use these when they're relevant. Remove anything that's wrong or out of date.</p>
              {notes.length === 0 ? (
                <p className="copilot-empty">Nothing yet. As we chat, I'll note things worth remembering (decisions, priorities, preferences) — they'll show here.</p>
              ) : (
                notes.map((n) => (
                  <div key={n.id} className="copilot-noteitem">
                    <span className="copilot-noteitem-text">{n.text}</span>
                    <button type="button" className="copilot-noteitem-del" onClick={() => removeNote(n.id)} aria-label="Forget this" title="Forget this">✕</button>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {view === "chat" && (
          <>
            <div className="copilot-chat" ref={threadRef}>
              {/* Capability heads-up on an on-device model (WebLLM / Nano): sets expectations about quality
                  without disparaging the privacy default. Sits at the TOP of the thread, so it's there on a
                  new chat and simply scrolls up as the conversation grows — no nag, no dismiss needed. */}
              {aiReady && !isCapableBackend(activeBackend) && (
                <div className="copilot-capnote">
                  You're on an <strong>on-device model</strong> — private and free, but its answers can be limited and occasionally off. For sharper, more reliable results, connect a more capable model — your own API key, or a local model — in your AI settings on Freehold.
                </div>
              )}
              {/* Chatting shares one local model with a background scan, so we pause the scan for you when you
                  chat. Tell them once (dismissable), so the paused banner isn't a surprise. */}
              {aiReady && sharesLocalModel && !pauseNoticeDismissed && (scanStatus === "running" || scanStatus === "paused") && (
                <div className="copilot-capnote copilot-capnote--info">
                  <span>Chatting <strong>pauses your background analysis</strong> so your reply comes through quickly — resume it any time from the progress bar at the top.</span>
                  <button type="button" className="copilot-capnote-x" onClick={dismissPauseNotice} aria-label="Dismiss">×</button>
                </div>
              )}
              {chat.map((t, i) =>
                t.role === "action" && t.action ? (
                  <div key={i} className="copilot-turn copilot-turn--action">
                    <ActionCard
                      data={t.action}
                      contacts={contactOptions}
                      suggestions={actionSuggestions}
                      busy={actionBusy}
                      onConfirm={(v, u) => confirmAction(i, v, u)}
                      onCancel={() => cancelAction(i)}
                      onUndo={t.undo ? () => undoAction(i) : undefined}
                    />
                  </div>
                ) : (
                  <div key={i} className={"copilot-turn copilot-turn--" + t.role}>
                    <div className="copilot-turn-text">{t.role === "ai" ? (t.receipt ? (<div className="actc actc--saved"><span className="actc-tick">✓</span><span className="actc-savedtext">{t.text}</span></div>) : t.compute ? <ComputeTable data={t.compute} onNavigate={onNavigate} onClose={onClose} /> : <Markdown text={t.text} />) : t.text}</div>
                    {t.role === "ai" && renderRelated(t.related)}
                    {t.role === "ai" && t.chips && t.chips.length > 0 && (
                      <div className="copilot-chips">
                        {t.chips.map((c, j) => (
                          <button key={j} type="button" className="copilot-chip" onClick={() => ask(c.prompt)}>{c.label}</button>
                        ))}
                      </div>
                    )}
                    {t.role === "ai" && t.genMs != null && (
                      <div className="copilot-genmeta">Thought for {Math.max(1, Math.round(t.genMs / 1000))}s{t.genTok ? ` · ~${formatTokens(t.genTok)} tokens` : ""}</div>
                    )}
                  </div>
                ),
              )}
              {!streaming && (asking || actionBusy || isBusy(chatIdRef.current)) && <div className="copilot-turn copilot-turn--ai"><div className="copilot-turn-text copilot-turn-text--thinking"><ThinkingIndicator label={aiLoad?.active ? `${aiLoad.firstRun ? "Downloading the assistant (one-time)" : "Starting the assistant"}… ${Math.round((aiLoad.progress || 0) * 100)}%` : actionBusy ? "Working…" : undefined} staged={stagedThinking} startMs={genStartRef.current} /></div></div>}
              {streaming && <div className="copilot-genmeta copilot-genmeta--live">~{formatTokens(genTokens)} tokens · {Math.max(0, Math.round((Date.now() - genStartRef.current) / 1000))}s</div>}
            </div>
            {(doc || docNote) && (
              <div className="copilot-doc copilot-doc--composer">
                {doc ? (<><span className="copilot-doc-name">⎘ {doc.name}</span><button type="button" className="copilot-doc-x" onClick={() => setDoc(null)} aria-label="Remove">✕</button></>) : <span className="copilot-doc-note">{docNote}</span>}
              </div>
            )}
            <div className="copilot-composer">
              <button type="button" className="copilot-attach" onClick={() => docInputRef.current?.click()} title="Add meeting notes, proposals, contracts and more" aria-label="Add meeting notes, proposals, contracts and more">+</button>
              <GrowTextarea
                className="copilot-composer-input"
                autoFocus
                placeholder="How can I help you today?"
                value={q}
                onChange={setQ}
                onEnter={() => ask()}
              />
              <button type="button" className="copilot-ask" disabled={(!q.trim() && !doc) || asking || streaming || actionBusy} onClick={() => ask()}>{asking || streaming ? "…" : "Send"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
