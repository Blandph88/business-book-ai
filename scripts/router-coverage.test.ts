// Coverage battery for the KEYWORD ROUTER (computeForQuery) — the deterministic path that is the ONLY
// structured route on low-capability tiers (Gemini Nano skips the LLM tool-router). Every query a real
// consultant is likely to type that we CAN answer from the book should resolve here; if it falls through
// to null, a tiny model answers free-form and tends to fabricate. So this test is the robustness gate:
// it asserts (a) the right tool fires (via a distinguishing substring in the intro) for the things we
// should catch, and (b) genuinely open-ended / chit-chat correctly passes through to null.
//
//   npx tsx scripts/router-coverage.test.ts
//
// Reuses the SAME loader as qa-ground-truth so it runs against the real seed book.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Papa from "papaparse";
import { computeForQuery } from "../src/ai/compute.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const today = process.env.QA_TODAY || new Date().toISOString().slice(0, 10);
const toBool = (v: string | undefined) => /^(true|yes|1|y)$/i.test((v ?? "").trim());

// ── Load the seed book (same shape compute expects) ────────────────────────────────────────────────
type AnyRow = Record<string, string>;
const contactsCsv = readFileSync(join(ROOT, "public/contacts_enriched.csv"), "utf8");
const contacts = (Papa.parse<AnyRow>(contactsCsv, { header: true, skipEmptyLines: true }).data).map((r) => ({
  first: r.first ?? "", last: r.last ?? "", organisation: r.organisation ?? "", position: r.position ?? "",
  seniority: r.seniority ?? "", function: r.function ?? "", sector_group: r.sector_group ?? "", phone: r.phone ?? "",
  messaged: toBool(r.messaged), responded: toBool(r.responded), two_way: toBool(r.two_way),
  agreed_to_meet: toBool(r.agreed_to_meet), met: false, url: r.url ?? "",
})) as any[];
const byUrl = new Map(contacts.map((c) => [c.url, c]));
const seedMeetings = JSON.parse(readFileSync(join(ROOT, "public/seed_meetings.json"), "utf8")) as AnyRow[];
const meetingRows = seedMeetings.map((m) => {
  const c = byUrl.get(m.contact_url as string);
  return { ...m, id: `${m.contact_url}#${m.meeting_no}`, contactInfo: { name: c ? `${c.first} ${c.last}`.trim() : "(unknown)", organisation: c?.organisation ?? "—" } };
}) as any[];
for (const m of meetingRows) if (m.meeting_stage === "Held") { const c = byUrl.get(m.contact_url); if (c) c.met = true; }
const opps = seedMeetings.filter((m) => (m as any).opportunity).map((m, i) => {
  const op = (m as any).opportunity; const c = byUrl.get(m.contact_url as string);
  return { id: `opp:seed-${i}`, opportunity_name: op.opportunity_name, organisation: c?.organisation ?? "—", primary_contact: c ? `${c.first} ${c.last}`.trim() : "", service_line: op.service_line, current_step: op.step || "meeting", est_value: op.est_value, probability: op.probability, lost: !!op.lost, contact_url: m.contact_url };
}) as any[];
let sows: any[] = [];
try { sows = (JSON.parse(readFileSync(join(ROOT, "public/seed_extras.json"), "utf8")).sows ?? []); } catch { /* none */ }
const data = { contacts, meetingRows, opps, sows } as any;

// ── Assertions ──────────────────────────────────────────────────────────────────────────────────────
// expected: null = must pass through to free-form; "*" = must catch (any tool); string/[strings] = must
// catch AND the intro must contain one of these (case-insensitive) — guards mis-routes (cold vs warm, …).
type Expect = null | "*" | string | string[];
let pass = 0, fail = 0;
function check(text: string, expected: Expect, prev?: string) {
  const r = computeForQuery(text, data, today, prev);
  let ok: boolean; let got: string;
  if (expected === null) { ok = r === null; got = r ? `caught: "${r.intro.slice(0, 50)}…"` : "null"; }
  else if (r === null) { ok = false; got = "null (fell through!)"; }
  else if (expected === "*") { ok = true; got = "caught"; }
  else { const subs = Array.isArray(expected) ? expected : [expected]; const lc = r.intro.toLowerCase(); ok = subs.some((s) => lc.includes(s.toLowerCase())); got = `"${r.intro.slice(0, 50)}…"`; }
  ok ? pass++ : fail++;
  if (!ok) console.log(`✗ FAIL  ${text}\n         expected ${expected === null ? "null" : JSON.stringify(expected)}, got ${got}`);
}

// Meetings — windowed, upcoming, and bare/count phrasings
check("Show meetings from the last two weeks", ["two weeks", "no meetings"]);
check("what meetings do I have coming up", ["upcoming", "no upcoming"]);
check("any meetings this week", ["week"]);
check("show my meetings", ["meeting"]);
check("list all my meetings", ["meeting"]);
check("how many meetings have I had", ["meeting"]);

// Cold / re-engage / follow-up (must NOT be warmth, must NOT be opportunities)
check("Who's gone cold that I should re-engage?", ["re-engag", "gone cold"]);
check("who should I follow up with", ["re-engag", "gone cold"]);
check("who have I lost touch with", ["re-engag", "gone cold"]);
check("anyone I need to chase up", ["re-engag", "gone cold"]);
check("which contacts have gone quiet", ["re-engag", "gone cold"]);

// Warmest (must NOT be cold)
check("Find my warmest leads right now", ["warmest", "engagement logged"]);
check("who are my hottest contacts", ["warmest", "engagement logged"]);
check("my strongest relationships", ["warmest", "engagement logged"]);
check("who's most engaged with me", ["warmest", "engagement logged"]);

// Opportunity rankings
check("Show my biggest deals", ["biggest", "no open"]);
check("what are my most valuable opportunities", ["biggest", "no open"]);
check("which deals are most likely to close", ["most likely to close", "no open"]);
check("which opportunities are at risk of stalling?", ["early stage", "at risk", "no open"]);
check("any deals stalling?", ["early stage", "at risk", "no open"]);

// Pipeline / breakdowns
check("How's my pipeline looking?", "at a glance");
check("What's in my pipeline?", "at a glance"); // was leaking to the slow free-form model — must be instant
check("show me my pipeline", "at a glance");
check("what's my win rate", "at a glance");
check("how am I doing?", "at a glance");
check("Is my network weighted toward any one sector?", "broken down by sector");
check("break down my contacts by seniority", "broken down by seniority");
check("split my network by function", "broken down by function");

// Contacts by funnel stage
check("Who have I agreed to meet but haven't met yet?", ["agreed to meet", "agreed to"]);
check("who hasn't responded to me", ["responded"]);
check("who has ghosted me", ["responded"]);
check("who have I met", ["met"]);
check("decision makers at JPMorgan", ["decision-maker", "senior"]);
check("show me the C-suite contacts", ["decision-maker", "senior"]);

// Opportunity / contract lists (incl. counts, value filters, company scope)
check("List my open opportunities", ["open opportunities", "no open"]);
check("show my deals", ["opportunit", "no open"]);
check("how many opportunities do I have", ["opportunit", "no open"]);
check("open deals over 100k", ["over", "opportunit", "no open"]);
check("show my contracts", ["engagement"]); // entity renamed Contracts → Engagements
check("any active engagements", ["engagement"]);

// Generic, unfiltered contact lists + counts
check("show me my contacts", ["contacts"]);
check("how many people do I have", ["contacts"]);
check("list my whole network", ["contacts"]);
check("Show me everyone at JPMorgan", ["jpmorgan", "at jpmorgan"]);
check("Show me everyone at JP Morgan", ["contacts at jp morgan", "jp morgan"]); // spacing variant must still resolve (was "can't find")

// Personal snapshot — "about me / my book" must be MY numbers, NOT a person whose name contains "me"
check("What do you know about me?", "know about your book");
check("what do you know about me", "know about your book");
check("tell me about myself", "know about your book");
check("summarise my book", "know about your book");
check("how big is my network", "know about your book");
check("summarise my network by sector", "broken down by sector"); // breakdown still wins, not the snapshot

// Single record / account (just needs to catch, and must NOT collapse to the personal snapshot)
check("Brief me on Amelia Wright", "*");
check("tell me about JPMorgan", "*");
check("what do you know about Ethan Rossi", "*");

// Weekly focus / priorities → deterministic agenda, NOT the slow model (this used to hang on WebLLM)
check("What should I focus on this week?", ["focus on this week", "on top of it", "due or overdue"]);
check("what's my priority right now", ["focus on this week", "on top of it", "due or overdue"]);
check("what needs my attention", ["focus on this week", "on top of it", "due or overdue"]);
check("who is my next highest priority today", ["focus on this week", "on top of it", "due or overdue"]); // 'next' must NOT match company "Next"
check("who should I prioritise", ["focus on this week", "on top of it", "due or overdue"]);

// Engagements ranked by value — deterministic (the model picked 91k over 510k on a small model)
check("which engagement is the highest value", ["by value", "no engagements"]);
check("what's my biggest engagement", ["by value", "no engagements"]);

// Reasoning / multi-part instructions → MUST pass through to the model (no hijack to a table)
check("You are a senior BD advisor. Analyse my pipeline and develop a detailed strategy to close more deals, considering my strengths in operational transformation and the customers I've met.", null);
check("Do a few things: prepare me for my meeting with Rachel, tell me who works with Noah, and give me a strategy for Boeing.", null);
check("Give me a contrarian assessment for someone I know at JP Morgan — you choose who.", null);
check("Look at my pipeline and tell me the 3 deals I should prioritise this week, the key contact for each, and the next action for each.", null); // 'my pipeline' trigger + per-item 'for each'
check("Build me an account plan for JPMorgan: who I know there, where the relationships are strong vs cold, and how I'd expand.", null); // 'cold' + 'build a plan'
check("Which of my cold contacts work at companies where I also have an active engagement, and how should I use the relationship?", null); // 'cold' + join + how-to
check("Play devil's advocate on my pipeline — which deals are going nowhere?", null);

// Sector / function CRITERIA → defer to the model + criteriaGrounding (a sector word must NOT be matched as
// a company: "in banking" was wrongly hitting "Lloyds Banking Group" → 6 contacts instead of 304 in sector).
check("Who are the 5 most important people I know in banking?", null);
check("who do I know in finance leadership roles?", null);
check("people I know in pharma", null);
check("anyone in the energy sector?", null);
// …but a REAL company whose NAME contains a sector word must STAY a deterministic account lookup.
check("who do I know at Lloyds Banking Group?", ["lloyds banking group", "contacts at"]);
check("who do I know at Accenture?", ["accenture", "contacts at"]);
// C-suite scoped by a funnel qualifier in the same question → apply it ("...actually met" → met only).
check("Which C-suite people have I actually met?", ["met", "decision-maker", "senior"]);

// Follow-up superlatives that depend on the PRIOR turn (context-carry) — must stay deterministic + consistent
// with the table just shown, not hand the model a chance to pick a different metric.
check("which of those is most at risk?", ["at risk", "early stage"]); // "at risk" ⇒ deals, no keyword needed
check("which is the highest value one?", ["engagements by value", "no engagements"], "how many engagements do I have");
check("which is the highest value one?", ["biggest open", "no open"], "what are my biggest open opportunities?");
check("and the biggest?", ["biggest open", "no open"], "show my open opportunities");
check("which is the highest value one?", null); // no prior context ⇒ defer to model (don't guess the entity)

// Pipeline MATHS → computed deterministically (a small model fabricated a single-deal total here).
check("what's the average value of my open opportunities?", ["average", "no open"]);
check("if you weight each by its probability, what's the total worth?", ["weighted", "no open"]);
check("how big is the gap between the raw and the weighted number?", ["gap", "no open"]);
check("what's my average deal size?", ["average", "no open"]);
check("what's my biggest deal by value?", ["biggest", "no open"]); // still a RANKING, not aggregation

// ── WS1 relational/aggregate tools + hardened extraction (compute-or-decline, never mis-parse) ──────
// Recognised-revenue MATHS over engagements → computed, never a re-listing of the engagements table.
check("how much revenue have I recognised across my engagements?", ["recognised", "no engagements"]);
check("what's the average recognised per engagement?", ["average", "per engagement", "no engagements"]);
check("total recognised revenue", ["recognised", "no engagements"]);
// Count-THRESHOLD on meetings → a subset of "met", not the whole met set.
check("who have I met more than once?", ["more than once", "met just the once"]);
check("anyone I've met three or more times?", ["at least 3", "met just the once", "more than once"]);
check("who have I met at least twice?", ["more than once", "met just the once"]);
// ANTI-JOIN: open opps with no meeting → the tool, NOT a mis-parsed "…at all" company table.
check("which of my open deals have no meeting logged against them at all?", ["no meeting", "every open opportunity", "no open opportunities right now"]);
check("open opportunities without a meeting", ["no meeting", "every open opportunity", "no open opportunities right now"]);
// JOIN+count: companies with an open opp AND ≥N contacts.
check("which companies do I have both an open opportunity and at least two contacts at?", ["expansion footholds", "both an open opportunity"]);
check("companies where I have an open deal and multiple contacts", ["expansion footholds", "both an open opportunity"]);
// Hardened company extraction — filler ("at all", "at least two contacts at") must NEVER become a bogus
// company. These MUST route to the right relational tool, never to "No open opportunities at all".
check("open deals with no meeting logged against them at all?", ["no meeting", "every open opportunity", "no open opportunities right now"]);
// Regression: a REAL company still resolves, and value filters still work.
check("who do I know at JPMorgan?", ["jpmorgan"]);
check("open deals over 100000", ["opportunit", "no open"]);
// "average per engagement" follow-up (no "revenue" word) → the aggregate, not the engagements list.
check("so what's the average per engagement?", ["average", "per engagement"], "how much revenue have I recognised across my engagements?");
check("average recognised per engagement", ["average", "per engagement"]);
// A PRONOUN "brief me on her" must NOT be resolved as a literal name → defer to the model (null).
check("just brief me on her and what I'd open with", null);
check("tell me about them", null);

// ── WS3 confidentiality → answered deterministically by privacyResponse (tested in compute-tools.test) ──
// (privacyResponse is a separate entry point, not computeForQuery — covered by its own unit test.)

// Open-ended / chit-chat → must fall through to the model (null)
check("are you funny", null);
check("tell me a joke", null);
check("what's the weather like", null);
check("thanks, that's helpful", null);
check("who are you", null);

console.log(`\n${fail === 0 ? "✓" : "✗"} router coverage: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
