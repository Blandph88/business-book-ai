// Shared chip ("prompt card") logic — cleaning + validation + the deterministic fallback — so the SAME
// rules can be exercised by the eval harness, not just the running app. Chips are the tappable follow-up
// suggestions under a reply. The model round-trip itself (suggestionsPrompt → aiJson) stays with the
// caller; this module cleans + VALIDATES the model's chips and builds the deterministic fallback.
//
// The failure modes this guards (the "chip errors" we kept hitting):
//   1. a chip that ECHOES the question just asked (useless) — echoesQuestion.
//   2. a chip that names an entity NOT in the answer, or anchors to a HALLUCINATED company ("…at Related
//      Companies" when that firm isn't in the book) — validateChips + anchorIsReal.
//
// Guards (ORG_STOP/ORG_NOISE, chip stoplist, anchor patterns, anchorIsReal) are copied verbatim from
// CopilotBar; the entity-in-answer check uses the importable searchBook (the component's own entityHits is
// UI-coupled). CopilotBar still has its entityHits-based copy — converge it onto this module later.

import type { BookData } from "./bookContext";
import { matchContacts } from "./actions/actionSpecs";
import { isCommonOrgToken } from "../data/orgTokens";
import { searchBook } from "./grounding";

export type Chip = { label: string; prompt: string };

const ORG_STOP = new Set(["of", "the", "and", "for", "group", "inc", "llc", "ltd", "co", "plc", "corp", "corporation", "company", "partners", "global", "services", "holdings"]);
const ORG_NOISE = new Set([
  "open", "new", "all", "my", "your", "list", "show", "find", "get", "pull", "who", "what", "which", "recent",
  "active", "current", "top", "best", "warm", "cold", "last", "this", "next", "any", "some", "people", "contact",
  "contacts", "meeting", "meetings", "opportunity", "opportunities", "deal", "deals", "pipeline", "network", "text",
  "data", "world", "first", "national", "american", "united", "civil", "service", "energy", "capital", "health", "care",
  "one", "two", "sector", "sectors", "report", "summary", "weighted", "industry", "across", "between",
  "business", "trade", "department", "bank", "financial", "international", "solutions", "systems",
  "technologies", "consulting", "advisory", "management", "ventures", "media", "digital", "associates",
  "enterprises", "industries", "securities", "insurance", "markets", "british", "european", "federal",
  "university", "universities", "college", "institute", "institutes", "school", "schools", "academy",
  "foundation", "hospital", "council", "office", "agency", "authority", "ministry", "association",
  "society", "centre", "center", "chase", "general", "standard", "central", "metropolitan",
]);

const CHIP_STOP = new Set(["that", "this", "what", "which", "should", "would", "could", "have", "with", "about", "there", "their", "know", "from", "your", "mine", "they", "them", "into", "over", "some", "good", "next", "week", "today", "right", "now", "really"]);
function chipTokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !CHIP_STOP.has(w)));
}
// Does a candidate next-step just echo the question the user already asked? (Content-word overlap.)
export function echoesQuestion(prompt: string, question: string): boolean {
  const A = chipTokens(prompt), B = chipTokens(question);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size) >= 0.5;
}

// Post-process raw model chips: complete label+prompt, non-echoing, de-duped, max 3. Returns [] on garbage.
export function cleanChips(raw: unknown, question: string): Chip[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const clean: Chip[] = [];
  for (const c of raw as Chip[]) {
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
}

const CHIP_ANCHOR_PATTERNS: RegExp[] = [
  /\b(?:follow[- ]?up|outreach|reply|response|message|email|note|intro(?:duction)?)\s+(?:to|for)\s+(.+?)(?:\s+(?:about|regarding|on)\b.*)?$/i,
  /\bbrief me on\s+(.+?)$/i,
  /\b(?:meeting|catch[- ]?up|call|coffee|lunch|sync)\s+with\s+(.+?)$/i,
  /\b(?:opportunity|deal|engagement)\s+(?:for|with|at|from)\s+(.+?)$/i,
  /\b(?:know|anyone|contacts|people|connections)\b[^?]*\bat\s+(.+?)$/i,
  /\bnext step on\s+(?:the\s+)?(.+?)(?:\s+opportunity)?$/i,
  /\b(?:reconnect with|reach out to|introduce me to|chase|connect with)\s+(.+?)$/i,
];
export function chipAnchor(prompt: string): string | null {
  const p = prompt.trim().replace(/[?.!,]+$/, "");
  for (const re of CHIP_ANCHOR_PATTERNS) {
    const m = p.match(re);
    if (m && m[1]) return m[1].trim().replace(/^the\s+/i, "").trim();
  }
  return null;
}

// Is an anchor a REAL entity in the book (a contact, an org, or an opportunity)? Rejects a name the model
// invented (a real-world company not in this user's book).
export function anchorIsReal(anchor: string, d: BookData): boolean {
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

// Which book people/orgs a text names, as a set of "p:name"/"o:org" keys (searchBook-based).
function namedEntities(text: string, d: BookData): Set<string> {
  const g = searchBook(text, d);
  const s = new Set<string>();
  if (!g) return s;
  for (const p of g.people) s.add("p:" + p.main.toLowerCase());
  for (const c of g.companies) s.add("o:" + c.org.toLowerCase());
  return s;
}

// Validate model chips: (a) every book entity a chip names must appear in the answer; (b) a chip anchored to
// a PROPER NOUN that isn't a real book entity is dropped (kills hallucinated-company chips). Returns the kept
// chips; callers can compare against the input to count/report drops.
export function validateChips(chips: Chip[], answer: string, d: BookData): Chip[] {
  const inAnswer = namedEntities(answer, d);
  return chips.filter((c) => {
    const named = [...namedEntities(c.prompt, d)];
    if (!named.every((k) => inAnswer.has(k))) return false;
    const anchor = chipAnchor(c.prompt);
    if (anchor && /^[A-Z0-9]/.test(anchor) && !anchorIsReal(anchor, d)) return false;
    return true;
  });
}

// Deterministic fallback chips, built from the people/companies the ANSWER actually names.
export function chipsFromAnswer(answer: string, d: BookData): Chip[] {
  const g = searchBook(answer, d);
  const people = g ? g.people.map((h) => h.main) : [];
  const orgs = g ? g.companies.map((c) => c.org) : [];
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
