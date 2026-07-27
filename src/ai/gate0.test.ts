// ── GATE-0 REGRESSION SUITE ──────────────────────────────────────────────────────────────────────
// Every failure found in the 2026-07-23 manual 50-question test (Lafayette session) becomes a permanent
// assertion here, so no found bug can ever be re-found. Question numbers (#N) refer to
// /Users/unplannedphilbland/Heirloom/GATE0-COPILOT-TRIAGE.md. Deterministic layer only — narration/router
// behaviour is exercised by the eval harness; THIS file asserts the compute/keyword layer's contracts:
//   1. CONSTRAINT PRESERVATION — a window/predicate/filter is applied or explicitly surrendered, never dropped.
//   2. Honest zero-cases — no vacuous "good news"; empty results state the checked truth.
//   3. Deixis defers to context — a pronoun never fires a context-blind keyword table.
//   4. Exact record names win routing regardless of store vocabulary.
//   5. Counts are scalar answers, never display caps masquerading as totals.
import { describe, it, expect } from "vitest";
import {
  computeForQuery, computeExact, findContacts, openOppsWithoutMeeting, oppsWithRecentMeeting,
  meetingsCount, exactRecordLookup, compareEntities, destructiveAskResponse,
  deicticWithoutEntity, contactBrief, rankOpportunities, capabilitiesResult, stageBreakdown,
  frontDoorBrief, questionBlocksAction, noteOnContact, cancelIntent, bookShapedText, revenueVocabOk, scanEntities,
  deicticRecordRef, resolveCompareDeixis, windowMonth, calendarMeetings, compoundContactsWarm,
  isReasoningRequest as reasonRq, warmNoDeal, meetingContent, namesakeSuperlative, companyZeroLine,
  changeCardIntent, contactsMetAtLeast, findOpportunities, newsShaped, reminderSubject,
} from "./compute";
import { searchBook } from "./grounding";
import { normalizeRoute } from "./prompts";
import type { BookData } from "./bookContext";
import type { Contact } from "../data/contacts";
import type { MeetingRow } from "../data/meetings";
import type { Opportunity } from "../storage/opportunities";

const TODAY = "2026-07-23";

function contact(over: Partial<Contact> = {}): Contact {
  return {
    first: "Jane", last: "Doe", organisation: "Acme", position: "Manager",
    sector_detail: "", sector_group: "Financial Services", sub_group: "Financial Services",
    seniority: "Manager", function: "Finance & Accounting",
    messaged: false, responded: false, two_way: false, agreed_to_meet: false, met: false,
    url: "https://www.linkedin.com/in/jane", phone: "",
    ...over,
  } as Contact;
}
function meeting(over: Partial<MeetingRow> = {}): MeetingRow {
  return {
    id: `m-${Math.abs(JSON.stringify(over).split("").reduce((s, c) => s + c.charCodeAt(0), 0))}`,
    contact_url: "https://www.linkedin.com/in/jane",
    meeting_no: 1, meeting_stage: "Held", date_agreed: "2026-05-01", date_held: "2026-06-01",
    sentiment: "Positive", contactInfo: { name: "Jane Doe", organisation: "Acme", seniority: "", function: "", sector_group: "", phone: "" },
    ...over,
  } as unknown as MeetingRow;
}
function opp(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: `o-${JSON.stringify(over).length}-${(over.organisation || "x")}-${over.est_value || 0}`,
    opportunity_name: "Acme — Strategy engagement", organisation: "Acme", primary_contact: "Jane Doe",
    service_line: "Strategy", current_step: "scoping", est_value: 100_000, probability: 0.5, lost: false,
    contact_url: "https://www.linkedin.com/in/jane",
    ...over,
  } as unknown as Opportunity;
}
function book(over: Partial<BookData> = {}): BookData {
  return { contacts: [], meetingRows: [], opps: [], sows: [], ...over };
}

// A demo-shaped fixture: met + never-met contacts, a company with no person-name collision, open opps
// with/without upcoming meetings, and a KPMG opp whose name contains the SoW word "engagement".
const KAREN = contact({ first: "Karen", last: "OConnor", organisation: "ExxonMobil", met: true, messaged: true, url: "https://www.linkedin.com/in/karen" });
const DANIEL = contact({ first: "Daniel", last: "Garcia", organisation: "Confluent", met: true, messaged: true, url: "https://www.linkedin.com/in/daniel-garcia" });
const COLD1 = contact({ first: "Emma", last: "Reed", organisation: "ExxonMobil", url: "https://www.linkedin.com/in/emma-reed" });
const COLD2 = contact({ first: "Thomas", last: "Hunt", organisation: "ExxonMobil", url: "https://www.linkedin.com/in/thomas-hunt" });
const D = book({
  contacts: [KAREN, DANIEL, COLD1, COLD2],
  meetingRows: [
    meeting({ contact_url: KAREN.url, contactInfo: { name: "Karen OConnor", organisation: "ExxonMobil", seniority: "", function: "", sector_group: "", phone: "" }, date_held: "2026-06-04", sentiment: "Neutral" }),
    meeting({ contact_url: DANIEL.url, contactInfo: { name: "Daniel Garcia", organisation: "Confluent", seniority: "", function: "", sector_group: "", phone: "" }, date_held: "2026-06-30", sentiment: "Neutral" }),
  ],
  opps: [
    opp({ organisation: "KPMG", opportunity_name: "KPMG — Strategy engagement", current_step: "proposal_delivery", est_value: 75_000, contact_url: "https://www.linkedin.com/in/tom-kpmg", id: "o-kpmg" }),
    opp({ organisation: "Google", opportunity_name: "Google — Operations engagement", current_step: "scoping", est_value: 800_000, contact_url: "https://www.linkedin.com/in/g1", id: "o-goog" }),
    opp({ organisation: "Pfizer", opportunity_name: "Pfizer — People & Change engagement", current_step: "proposal_delivery", est_value: 250_000, lost: true, contact_url: "https://www.linkedin.com/in/p1", id: "o-pfz" }),
  ],
});

// #5 — "in total" must never be answered with a windowed count.
describe("Gate-0 #5: total-count questions are unwindowed scalars", () => {
  it("meetings 'in total' returns the all-time held count, not a window", () => {
    const r = computeForQuery("How many meetings do I have logged in total?", D, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/held 2 meetings all time/i);
    expect(r!.rows.length).toBe(0); // scalar, not a dump
  });
  it("meetingsCount honours an explicit window and still shows the all-time total", () => {
    const r = meetingsCount(D, TODAY, "how many meetings in the last 30 days");
    expect(r.intro).toMatch(/last 30 days/);
    expect(r.intro).toMatch(/2 all time/);
  });
});

// #1 — count-shaped contact questions get a scalar with breakdown, never a 40-row dump.
describe("Gate-0 #1: scalar counts", () => {
  it("'how many contacts' is a scalar with a stage breakdown", () => {
    const r = computeForQuery("How many contacts are in my book?", D, TODAY);
    expect(r).not.toBeNull();
    expect(r!.rows.length).toBe(0);
    expect(r!.intro).toMatch(/4 contacts/);
    expect(r!.intro).toMatch(/2.*met/i);
    expect(r!.more?.count).toBe(4);
  });
  it("'how many open opportunities' is a scalar", () => {
    const r = computeForQuery("How many open opportunities do I have?", D, TODAY);
    expect(r).not.toBeNull();
    expect(r!.rows.length).toBe(0);
    expect(r!.intro).toMatch(/2 open/);
  });
});

// #7 — "never met" keeps its negation: the anti-join, not the whole book.
describe("Gate-0 #7: never-met anti-join", () => {
  it("returns only not-met contacts", () => {
    const r = computeForQuery("How many contacts have I never had a meeting with?", D, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/never met|haven't met/i);
    expect(r!.intro).toMatch(/\b2\b/); // COLD1 + COLD2, not all 4
  });
  it("findContacts not_met stage filters correctly", () => {
    const r = findContacts(D, { stage: "not_met" });
    expect(r.rows.length).toBe(2);
    expect(r.rows.map((x) => x.cells[0])).not.toContain("Karen OConnor");
  });
});

// #14 — opps-without-meeting means NO NEXT MEETING BOOKED; the zero-case is informative, never vacuous.
describe("Gate-0 #14: opps-without-meeting semantics", () => {
  it("all open opps with nothing booked → the full follow-up-debt list, not 'good news'", () => {
    const r = openOppsWithoutMeeting(D, TODAY);
    expect(r.intro).toMatch(/NO next meeting booked/i);
    expect(r.intro).toMatch(/2 of 2 open/);
    expect(r.intro).not.toMatch(/good news/i);
  });
  it("a booked next meeting removes the opp from the list", () => {
    const withBooked = book({ ...D, meetingRows: [...D.meetingRows, meeting({ contact_url: "https://www.linkedin.com/in/g1", contactInfo: { name: "G One", organisation: "Google", seniority: "", function: "", sector_group: "", phone: "" }, meeting_stage: "Scheduled", date_held: undefined, date_scheduled: "2026-08-01" } as Partial<MeetingRow>)] });
    const r = openOppsWithoutMeeting(withBooked, TODAY);
    expect(r.intro).toMatch(/1 of 2 open/);
  });
});

// #18 — the opp-AND-recent-meeting join keeps BOTH conditions; honest zero states the composite truth.
describe("Gate-0 #18: opp AND meeting join", () => {
  it("returns none when no open-opp contact met recently — and says so", () => {
    const r = computeForQuery("List clients with an open opportunity AND a meeting in the last month.", D, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/none of your 2 open/i);
  });
  it("finds the join when a real overlap exists", () => {
    const joined = book({ ...D, meetingRows: [...D.meetingRows, meeting({ contact_url: "https://www.linkedin.com/in/g1", contactInfo: { name: "G One", organisation: "Google", seniority: "", function: "", sector_group: "", phone: "" }, date_held: "2026-07-10" })] });
    const r = oppsWithRecentMeeting(joined, TODAY, "meeting in the last month");
    expect(r.intro).toMatch(/1 of 2 open/);
    expect(r.rows[0].cells[0]).toMatch(/Operations engagement/);
  });
});

// #10/#13 — a date qualifier on a tool that can't filter by date is SURRENDERED, never silently dropped.
describe("Gate-0 #10/#13: constraint surrender on undated tools", () => {
  it("pipeline 'last 3 months' carries the surrender note", () => {
    const r = computeForQuery("What's in my pipeline from the last 3 months?", D, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/can't date .* precisely|first recorded activity|No pipeline activity/i);
  });
  it("'opportunities created this month' carries the surrender note", () => {
    const r = computeForQuery("Show me opportunities created this month.", D, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/can't date|first recorded activity|No opportunities with activity/i);
  });
  it("an undated pipeline ask has NO surrender noise", () => {
    const r = computeForQuery("How's my pipeline looking?", D, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).not.toMatch(/can't date|isn't applied/i);
  });
});

// #16/#30 — deixis never fires a context-blind keyword table.
describe("Gate-0 #16/#30: deixis gate", () => {
  it("'when did I last meet them?' defers (null) to the context-carrying paths", () => {
    expect(computeForQuery("When did I last meet them?", D, TODAY)).toBeNull();
    expect(computeExact("When did I last meet them?", D, TODAY)).toBeNull();
  });
  it("an explicit name still routes normally", () => {
    const r = computeForQuery("What's my relationship history with Karen OConnor?", D, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/Karen OConnor/);
  });
  it("a lowercase-typed known name is treated as an entity, not deixis", () => {
    expect(deicticWithoutEntity("compare karen oconnor with them", D)).toBe(false);
  });
  it("#16: 'met more than once but never created an opportunity for' is NOT the recency zero-case", () => {
    const r = computeForQuery("Who have I met more than once but never created an opportunity for?", D, TODAY);
    // Routes to the met-without-opp anti-join family — never the meetings window.
    if (r) expect(r.intro).not.toMatch(/no meetings held in the last/i);
  });
});

// #23 — entity-type sweep before any "not in your book" verdict.
describe("Gate-0 #23: company falls through before a false negative", () => {
  it("'history with Confluent' returns the account footprint, not a denial", () => {
    const r = computeForQuery("What's my history with Confluent?", D, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/Confluent/);
    expect(r!.intro).not.toMatch(/no "confluent"/i);
  });
  it("a genuinely absent name still gets the honest not-found (original casing)", () => {
    const r = contactBrief(D, "Zebediah Konstantinou", TODAY);
    expect(r.intro).toMatch(/no "Zebediah Konstantinou"/);
  });
});

// #38-verify — exact record name beats store vocabulary.
describe("Gate-0 #38: exact-record-name match wins", () => {
  it("'the KPMG Strategy engagement' resolves to the OPPORTUNITY despite the SoW word", () => {
    const r = computeForQuery("What's the est. value of the KPMG Strategy engagement?", D, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/[£$]75k/);
    expect(r!.intro).toMatch(/Open/);
  });
  it("exactRecordLookup returns null for text without a record name", () => {
    expect(exactRecordLookup("show me my pipeline", D)).toBeNull();
  });
});

// #17 — value filter survives on the gone-quiet ranking.
describe("Gate-0 #17: value-filtered risk ranking", () => {
  it("'over £20k gone quiet' routes to risk with the min-value applied", () => {
    const r = computeForQuery("Which opportunities over £200k have gone quiet?", D, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/[£$]200k/);
  });
});

// #31 — compare resolves BOTH entities.
describe("Gate-0 #31: compare", () => {
  it("compare of two known people returns both profiles", () => {
    const r = compareEntities("Compare Karen OConnor with Daniel Garcia", D, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/Karen OConnor/);
    expect(r!.intro).toMatch(/Daniel Garcia/);
  });
  it("compare with a pronoun side defers to context", () => {
    expect(compareEntities("Compare them to Daniel Garcia", D, TODAY)).toBeNull();
  });
});

// #46 — destructive asks are acknowledged, never menu'd, never actioned.
describe("Gate-0 #46: destructive-ask floor", () => {
  it("delete-my-book gets the deliberate refusal with directions", () => {
    const r = destructiveAskResponse("Delete my entire book");
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/can't delete your book from chat/i);
  });
  it("the capabilities fallback acknowledges an unroutable ask", () => {
    const r = capabilitiesResult("teleport me to mars");
    expect(r.intro).toMatch(/don't have a way to do that/i);
  });
  it("a genuine capability question still gets the friendly menu", () => {
    const r = capabilitiesResult("what can you do?");
    expect(r.intro).not.toMatch(/don't have a way/i);
  });
});

// #27/#28/#31 — related opportunities carry status.
describe("Gate-0 #14-item: status-labelled related opps", () => {
  it("a contact whose company has only lost opps sees them labelled as past, not 'related'", () => {
    const withPfz = book({ ...D, contacts: [...D.contacts, contact({ first: "Rachel", last: "Jones", organisation: "Pfizer", met: true, url: "https://www.linkedin.com/in/rjones" })] });
    const r = contactBrief(withPfz, "Rachel Jones", TODAY);
    expect(r.intro).toMatch(/1 lost/);
    expect(r.intro).not.toMatch(/1 related opportunit/i);
  });
});

// Counts never impersonated by display caps (#32) — rank tools state their basis.
describe("Gate-0 #32: rank slices are not counts", () => {
  it("rankOpportunities value intro includes top-N-of-M when capped", () => {
    const many = book({ ...D, opps: Array.from({ length: 14 }, (_, i) => opp({ organisation: `Org${i}`, opportunity_name: `Org${i} — Deal`, est_value: (i + 1) * 10_000, id: `o-${i}`, contact_url: `https://x/${i}` })) });
    const r = rankOpportunities(many, "value");
    expect(r.intro).toMatch(/top 10 of 14/);
  });
});

// ── PHASE B: action-extraction hardening ─────────────────────────────────────────────────────────
import { SPECS, extractSubjectSpan, relativeDate, type ActionCtx } from "./actions/actionSpecs";

const MARY = contact({ first: "Mary", last: "Andersson", organisation: "ExxonMobil", met: true, url: "https://www.linkedin.com/in/mary-a" });
const TRAP = contact({ first: "Lars", last: "Berg", organisation: "Andersson & Partners", url: "https://www.linkedin.com/in/lars-b" });
const actionBook = book({ contacts: [MARY, TRAP], opps: [
  opp({ organisation: "KPMG", opportunity_name: "KPMG — Strategy engagement", current_step: "proposal_delivery", est_value: 75_000, id: "o-kpmg2", contact_url: "https://x/k" }),
  opp({ organisation: "ExxonMobil", opportunity_name: "Website Rebuild", current_step: "meeting", est_value: 25_000, id: "o-web", contact_url: MARY.url }),
] });
const actx = (over: Partial<ActionCtx>): ActionCtx => ({
  op: "create", text: "", today: TODAY, contacts: actionBook.contacts, meetingRows: actionBook.meetingRows,
  opps: actionBook.opps, sows: actionBook.sows, skipModel: true, ...over,
});

describe("Gate-0 #15: relative meeting dates, local-calendar-safe", () => {
  it("parses yesterday / N days ago / last weekday", () => {
    expect(relativeDate(TODAY, "log a meeting for yesterday")).toBe("2026-07-22");
    expect(relativeDate(TODAY, "we met 3 days ago")).toBe("2026-07-20");
    expect(relativeDate(TODAY, "met them last tuesday")).toBe("2026-07-21"); // 23rd is a Thursday
    expect(relativeDate(TODAY, "no date words here")).toBe("");
  });
  it("meeting extract uses the relative date, not today", async () => {
    const v = await SPECS.meeting.extract(actx({ subjectUrl: MARY.url, text: "Log a meeting with Mary Andersson for yesterday, we discussed the Q3 renewal." }));
    expect(v.date_held).toBe("2026-07-22");
  });
});

describe("Gate-0 #22: deterministic subject span", () => {
  it("note bodies never reach the name matcher", () => {
    expect(extractSubjectSpan("Add a note to Karen OConnor: she's moving to Berlin in September")).toBe("Karen OConnor");
    expect(extractSubjectSpan("Add a note to Karen OConnor that she is moving to Berlin in September")).toBe("Karen OConnor");
  });
  it("schedule words are trimmed off the span", () => {
    expect(extractSubjectSpan("Log a meeting with Mary Andersson for yesterday, we discussed the Q3 renewal.")).toBe("Mary Andersson");
  });
  it("a pronoun span survives for the carry logic", () => {
    expect(extractSubjectSpan("Create an opportunity for them for £15k")).toBe("them");
  });
});

describe("Gate-0 #34/#16-item: org hygiene on opportunity extraction", () => {
  it("a resolved subject's employer beats a surname-matched firm", async () => {
    const v = await SPECS.opportunity.extract(actx({ subjectUrl: MARY.url, text: "Create an opportunity: Mary Andersson, website rebuild, £25k." }));
    expect(v.organisation).toBe("ExxonMobil"); // NOT "Andersson & Partners"
    expect(v.primary_contact).toBe("Mary Andersson");
    expect(v.est_value).toBe("25000");
  });
  it("a bare first name never becomes the organisation", async () => {
    const v = await SPECS.opportunity.extract(actx({ text: "Create an opportunity for Daniel for £10k" }));
    expect(v.organisation || "").not.toBe("Daniel");
  });
});

describe("Gate-0 #38: compound won-and-log money never overwrites est_value", () => {
  it("'mark as won and log £120k' keeps the existing estimate", async () => {
    const v = await SPECS.opportunity.extract(actx({ op: "update", targetId: "o-kpmg2", text: "Mark the KPMG Strategy engagement as won and log £120k" }));
    expect(v.est_value).toBe("75000");
    expect(v.outcome).toBe("Won");
  });
  it("an explicit value-framed update still applies ('to £30k')", async () => {
    const v = await SPECS.opportunity.extract(actx({ op: "update", targetId: "o-web", text: "Update the Website Rebuild opportunity to £30k" }));
    expect(v.est_value).toBe("30000");
  });
});

// ── PHASE E: tier-aware meta answers ─────────────────────────────────────────────────────────────
import { modelResponse, privacyResponse } from "./compute";

describe("Gate-0 #47/#48: tier-aware meta answers", () => {
  it("which-model answers from the live backend", () => {
    const r = modelResponse("What AI model are you running on right now?", { backend: "ollama", model: "qwen2.5:14b" });
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/qwen2.5:14b/);
    expect(r!.intro).toMatch(/your own machine/i);
  });
  it("privacy answer describes the ACTIVE backend — a stored key can't flip a local user to cloud copy", () => {
    const r = privacyResponse("Where does my data go when I ask you questions?", { backend: "ollama", byok: true });
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/never leave the machine|stays on this device/i);
    expect(r!.intro).not.toMatch(/your own API key/i);
  });
  it("the demo tier answers honestly", () => {
    const r = privacyResponse("Is my data private?", { backend: "democloud" });
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/hosted demo/i);
  });
});

// ── PHASE F: router context is O(1) in thread length (the long-thread degradation fix) ───────────
import { routerPrompt, companionPrompt } from "./prompts";

describe("Gate-0 #17: router prompt bounded regardless of thread length", () => {
  const hugeTable = Array.from({ length: 40 }, (_, i) => `| Row ${i} | Company ${i} | Stage | £${i}00k |`).join("\n");
  const longHistory = Array.from({ length: 60 }, (_, i) => ({ role: (i % 2 ? "ai" : "you") as "ai" | "you", text: i % 2 ? `Here are your results:\n${hugeTable}` : `question number ${i} about my pipeline and meetings` }));
  it("routerPrompt history digest is capped and table-stripped", () => {
    const p = routerPrompt("which deals are at risk?", longHistory);
    expect(p.prompt.length).toBeLessThan(1600); // message + bounded digest — not 60 turns of tables
    expect(p.prompt).not.toMatch(/\| Row 3 \|/); // table rows stripped
  });
  it("companionPrompt history is bounded too", () => {
    const p = companionPrompt("how are you?", longHistory, "small");
    expect(p.prompt.length).toBeLessThan(4000);
  });
});

// ── RETEST #2: "by stage" is a real dimension — never silently swapped for sector ────────────────
describe("Retest #2: breakdown dimensions are applied or surrendered, never swapped", () => {
  const STAGED = book({ contacts: [
    contact({ url: "https://l/1", messaged: true, responded: true, two_way: true, met: true }),
    contact({ url: "https://l/2", messaged: true, responded: true, two_way: true }),
    contact({ url: "https://l/3", messaged: true, responded: true }),
    contact({ url: "https://l/4", messaged: true }),
    contact({ url: "https://l/5" }),
  ] });
  it("headcount by stage → the funnel-stage table (not sector)", () => {
    const r = computeForQuery("Give me a headcount of my contacts by stage.", STAGED, TODAY);
    expect(r).toBeTruthy();
    expect(r!.intro).toMatch(/funnel stage/i);
    expect(r!.rows.map((x) => x.cells[0])).toEqual(["Met", "Two-way conversation", "Responded", "Messaged", "Not yet messaged"]);
    expect(r!.rows.map((x) => x.cells[1])).toEqual(["1", "1", "1", "1", "1"]);
  });
  it("stageBreakdown classifies by FURTHEST stage (mutually exclusive)", () => {
    const r = stageBreakdown(STAGED);
    const total = r.rows.reduce((s, x) => s + Number(x.cells[1]), 0);
    expect(total).toBe(5); // every contact in exactly one bucket
  });
  it("network by industry still → sector breakdown", () => {
    const r = computeForQuery("Show my network broken down by industry.", STAGED, TODAY);
    expect(r).toBeTruthy();
    expect(r!.intro).toMatch(/by sector/i);
  });
  it("unknown dimension → honest surrender listing what IS supported", () => {
    const r = computeForQuery("Give me my contacts broken down by shoe size.", STAGED, TODAY);
    expect(r).toBeTruthy();
    expect(r!.intro).toMatch(/sector, function, seniority, or funnel stage/i);
    expect(r!.rows.length).toBe(0);
  });
});

// ── BATCH 2 · Phase A: the front door ─────────────────────────────────────────────────────────────
describe("Batch2-A: interrogative guard — questions never open action cards", () => {
  const blocked = [
    "Anyone I've seen twice or more without ever opening an opportunity?",
    "What was our last meeting about?",
    "Anything in the news about JPMorgan lately?",
    "Have I ever crossed paths with anyone from Rolls-Royce?",
    "Which deals started in the past 2 months?",
  ];
  for (const t of blocked) it(`blocks: ${t.slice(0, 40)}`, () => expect(questionBlocksAction(t)).toBe(true));
  const allowed = [
    "Log that I bumped into Karen OConnor at a conference this morning.",
    "Can you log a meeting with Tom?",
    "Mark the Google deal as lost.",
    "New opportunity — Karen OConnor, worth £40k.",
  ];
  for (const t of allowed) it(`allows: ${t.slice(0, 40)}`, () => expect(questionBlocksAction(t)).toBe(false));
});

describe("Batch2-A: front-door brief resolver", () => {
  const FREYA1 = contact({ first: "Freya", last: "Murphy", organisation: "Verizon", position: "Head of Technology", met: true, messaged: true, url: "https://l/fm1" });
  const FREYA2 = contact({ first: "Freya", last: "Murphy", organisation: "Vantage Solutions", position: "Financial Analyst", url: "https://l/fm2" });
  const SARAH1 = contact({ first: "Sarah", last: "Singh", organisation: "ExxonMobil", url: "https://l/ss1" });
  const SARAH2 = contact({ first: "Sarah", last: "Evans", organisation: "Walmart", url: "https://l/se1" });
  const BOOK = book({ contacts: [FREYA1, FREYA2, SARAH1, SARAH2, KAREN, DANIEL] });
  it("'Give me the picture on Freya Murphy.' → resolves (two Freyas → a real result, not a deflection)", () => {
    const r = frontDoorBrief("Give me the picture on Freya Murphy.", BOOK, TODAY);
    expect(r).toBeTruthy();
  });
  it("'Pull up everything on Karen OConnor' → her brief", () => {
    const r = frontDoorBrief("Pull up everything on Karen OConnor", BOOK, TODAY);
    expect(r).toBeTruthy();
    expect(r!.intro).toMatch(/Karen OConnor/);
  });
  it("'Look at Daniel Garcia' → his brief, not a null turn", () => {
    const r = frontDoorBrief("Look at Daniel Garcia", BOOK, TODAY);
    expect(r).toBeTruthy();
    expect(r!.intro).toMatch(/Daniel Garcia/);
  });
  it("'Who's Sarah again?' → the which-one disambiguation, never a fabricated person", () => {
    const r = frontDoorBrief("Who's Sarah again?", BOOK, TODAY);
    expect(r).toBeTruthy();
    expect(r!.intro).toMatch(/which one did you mean/i);
    expect(r!.rows.length).toBe(2);
  });
  it("'Brief me on Bartholomew Quixote-Fernsby.' → honest not-found WITHOUT the trailing full stop", () => {
    const r = frontDoorBrief("Brief me on Bartholomew Quixote-Fernsby.", BOOK, TODAY);
    expect(r).toBeTruthy();
    expect(r!.intro).toMatch(/no "Bartholomew Quixote-Fernsby" in your book/);
  });
  it("does NOT hijack list/self asks", () => {
    expect(frontDoorBrief("Show me everyone at EY", BOOK, TODAY)).toBeNull();
    expect(frontDoorBrief("Tell me about my pipeline", BOOK, TODAY)).toBeNull();
    expect(frontDoorBrief("tell me about myself", BOOK, TODAY)).toBeNull();
  });
});

describe("Batch2-A: note-on-contact + cancel + book-shape + revenue guard", () => {
  const BOOK = book({ contacts: [DANIEL, KAREN] });
  it("'Note on Daniel Garcia: he's switching to the Madrid office in October.' → CONTACT update", () => {
    const n = noteOnContact("Note on Daniel Garcia: he's switching to the Madrid office in October.", BOOK, TODAY);
    expect(n).toBeTruthy();
    expect(n!.name).toBe("Daniel Garcia");
    expect(n!.note).toMatch(/Madrid/);
  });
  it("no contact match → null (falls through, never a wrong-entity card)", () => {
    expect(noteOnContact("Note on Zebedee Quark: hello", BOOK, TODAY)).toBeNull();
  });
  it("cancel intent matches the card-killers and nothing else", () => {
    expect(cancelIntent("Cancel that.")).toBe(true);
    expect(cancelIntent("never mind")).toBe(true);
    expect(cancelIntent("Cancel the meeting with Tom")).toBe(false);
  });
  it("book-shaped text detection (the companion fabrication gate)", () => {
    expect(bookShapedText("How many contacts do I have, and how many of those are keen?", BOOK)).toBe(true);
    expect(bookShapedText("What did Daniel Garcia and I talk about?", BOOK)).toBe(true);
    expect(bookShapedText("how are you today?", BOOK)).toBe(false);
  });
  it("revenue vocab guard: #3/#5 phrasings fail it, #6 passes", () => {
    expect(revenueVocabOk("What's the combined value of everything open right now?")).toBe(false);
    expect(revenueVocabOk("Total up every meeting I've ever logged.")).toBe(false);
    expect(revenueVocabOk("How much revenue have I actually banked across all engagements?")).toBe(true);
  });
  it("entity scan finds exact contacts and orgs", () => {
    const scan = scanEntities("I met Karen OConnor from ExxonMobil", BOOK);
    expect(scan.contacts.map((c) => c.last)).toContain("OConnor");
    expect(scan.orgs).toContain("ExxonMobil");
  });
});

describe("Batch2-A: schema-tolerant router parsing (shapes from the LM Studio logs, verbatim)", () => {
  it('{"route":"findOpportunities","args":{...}} → tool route', () => {
    const r = normalizeRoute({ route: "findOpportunities", args: { status: "Open" } });
    expect(r).toEqual(expect.objectContaining({ route: "tool", tool: "findOpportunities" }));
  });
  it('{"route":"contactBrief","name":"Olivia Thomas"} → tool + lifted arg', () => {
    const r = normalizeRoute({ route: "contactBrief", name: "Olivia Thomas" }) as { route: string; tool?: string; args?: Record<string, unknown> };
    expect(r?.tool).toBe("contactBrief");
    expect(r?.args?.name).toBe("Olivia Thomas");
  });
  it('{"route":"accountSummary","company":"AlixPartners"} → tool + lifted arg', () => {
    const r = normalizeRoute({ route: "accountSummary", company: "AlixPartners" }) as { route: string; tool?: string; args?: Record<string, unknown> };
    expect(r?.tool).toBe("accountSummary");
    expect(r?.args?.company).toBe("AlixPartners");
  });
  it("garbage still fails safely", () => {
    expect(normalizeRoute({})).toBeNull();
    expect(normalizeRoute({ route: "tool" })).toBeNull();
    expect(normalizeRoute(null)).toBeNull();
  });
});

// ── BATCH 2 · Phase B: referent ledger primitives + compare ──────────────────────────────────────
describe("Batch2-B: deictic-only record references (ledger-or-ask, never fuzzy)", () => {
  const deictic = ["Bump that one up to £55k.", "Flag it as won.", "Mark this as lost", "move it to proposal build"];
  for (const t of deictic) it(`deictic: ${t}`, () => expect(deicticRecordRef(t)).toBe(true));
  const named = ["We lost the Google Operations deal — mark it", "Bump the JPMorgan proposal to £55k", "Update the Chevron Strategy deal"];
  for (const t of named) it(`named: ${t}`, () => expect(deicticRecordRef(t)).toBe(false));
});

describe("Batch2-B: compare with thread referents", () => {
  const ROBERT = contact({ first: "Robert", last: "Schmidt", organisation: "Salesforce", met: true, messaged: true, url: "https://l/rs" });
  const OLIVIA = contact({ first: "Olivia", last: "Thomas", organisation: "HSBC", met: true, messaged: true, url: "https://l/ot" });
  const BOOK = book({ contacts: [ROBERT, OLIVIA] });
  it("'How does he compare to Olivia?' with he→Robert substituted → BOTH profiles, side by side", () => {
    const t = resolveCompareDeixis("How does he compare to Olivia?", "Robert Schmidt");
    const r = compareEntities(t, BOOK, TODAY);
    expect(r).toBeTruthy();
    expect(r!.intro).toMatch(/Robert Schmidt/);
    expect(r!.intro).toMatch(/Olivia Thomas/);
    expect(r!.intro).toMatch(/Side by side/i);
  });
  it("'Robert Schmidt vs Olivia Thomas' → side by side", () => {
    const r = compareEntities("Robert Schmidt vs Olivia Thomas", BOOK, TODAY);
    expect(r).toBeTruthy();
    expect(r!.intro).toMatch(/Side by side/i);
  });
  it("unresolvable pronoun (no referent) → null, not a solo brief", () => {
    expect(compareEntities("How does he compare to Olivia?", BOOK, TODAY)).toBeNull();
  });
  it("contactBrief carries its subject for the ledger", () => {
    const r = contactBrief(BOOK, "Robert Schmidt", TODAY);
    expect(r.subject).toEqual(expect.objectContaining({ kind: "contact", label: "Robert Schmidt" }));
  });
});

// ── BATCH 2 · Phase C: vocab routes, calendar windows, compound exemption ────────────────────────
describe("Batch2-C: calendar-month windows (retest #11)", () => {
  // TODAY = 2026-07-23 in this suite → "last month" = June 2026.
  it("windowMonth parses last/this/named months", () => {
    expect(windowMonth("who was my final meeting of last month with?", TODAY)).toEqual(expect.objectContaining({ start: "2026-06-01", end: "2026-06-30" }));
    expect(windowMonth("meetings this month", TODAY)).toEqual(expect.objectContaining({ start: "2026-07-01" }));
    expect(windowMonth("meetings in june", TODAY)).toEqual(expect.objectContaining({ start: "2026-06-01" }));
    expect(windowMonth("meetings in the past 10 days", TODAY)).toBeNull();
  });
  const JUNE_A = meeting({ id: "jm1", contact_url: KAREN.url, date_held: "2026-06-24", contactInfo: { name: "Karen OConnor", organisation: "ExxonMobil", seniority: "", function: "", sector_group: "", phone: "" } });
  const JUNE_B = meeting({ id: "jm2", contact_url: DANIEL.url, date_held: "2026-06-29", sentiment: "Very Positive", contactInfo: { name: "Susan Evans", organisation: "Herbert Smith Freehills", seniority: "", function: "", sector_group: "", phone: "" } });
  const JULY = meeting({ id: "jm3", contact_url: DANIEL.url, date_held: "2026-07-20", contactInfo: { name: "Daniel Garcia", organisation: "Confluent", seniority: "", function: "", sector_group: "", phone: "" } });
  const D2 = book({ contacts: [KAREN, DANIEL], meetingRows: [JUNE_A, JUNE_B, JULY] });
  it("'Who was my final meeting of last month with?' → the SINGLE June record (not latest overall)", () => {
    const r = computeForQuery("Who was my final meeting of last month with?", D2, TODAY);
    expect(r).toBeTruthy();
    expect(r!.intro).toMatch(/final meeting of last month/i);
    expect(r!.intro).toMatch(/Susan Evans/);
    expect(r!.intro).not.toMatch(/Daniel Garcia/);
  });
  it("'meetings last month' → the June list only", () => {
    const r = calendarMeetings("what meetings did I hold last month?", D2, TODAY);
    expect(r).toBeTruthy();
    expect(r!.rows.length).toBe(2);
  });
});

describe("Batch2-C: compound-count exemption + route (retest #38)", () => {
  it("the compound is NOT a reasoning request (intra-sentence 'of those')", () => {
    expect(reasonRq("How many contacts do I have, and how many of those are keen?")).toBe(false);
    expect(reasonRq("Of those FS contacts, how many have I met?")).toBe(true); // genuine prior-list scope stays gated
  });
  it("the compound answers BOTH halves, computed", () => {
    const warm = contact({ first: "W", last: "One", url: "https://l/w1", messaged: true });
    (warm as unknown as Record<string, unknown>).relationship_strength = "Warm";
    const D3 = book({ contacts: [warm, KAREN, DANIEL] });
    const r = compoundContactsWarm("how many contacts do i have, and how many of those are keen?", D3);
    expect(r).toBeTruthy();
    expect(r!.intro).toMatch(/3 contacts/);
    expect(r!.intro).toMatch(/1 of them rate/);
  });
});

describe("Batch2-C: vocab routes (retest #7/#13/#15/#16/#17/#22)", () => {
  const NOOPP = contact({ first: "Twice", last: "Met", organisation: "NoDealCo", met: true, messaged: true, url: "https://l/tm" });
  const M1 = meeting({ id: "t1", contact_url: NOOPP.url, date_held: "2026-06-01" });
  const M2 = meeting({ id: "t2", contact_url: NOOPP.url, date_held: "2026-07-01" });
  const D4 = book({ contacts: [NOOPP, KAREN], meetingRows: [M1, M2], opps: [opp({ organisation: "ExxonMobil", contact_url: KAREN.url })] });
  it("'Anyone I've seen twice or more without ever opening an opportunity?' → the anti-join list", () => {
    const r = computeForQuery("Anyone I've seen twice or more without ever opening an opportunity?", D4, TODAY);
    expect(r).toBeTruthy();
    expect(r!.intro).toMatch(/no opportunity ever opened/i);
    expect(r!.rows.map((x) => x.cells[0])).toEqual(["Twice Met"]);
  });
  it("'Which deals started in the past 2 months?' → the dated opps route (no stall path)", () => {
    const dOpp = opp({ organisation: "ExxonMobil", contact_url: KAREN.url });
    const mSrc = meeting({ id: "src1", contact_url: KAREN.url, date_held: "2026-07-01" });
    const D5 = book({ contacts: [KAREN], meetingRows: [mSrc], opps: [dOpp] });
    const r = computeForQuery("Which deals started in the past 2 months?", D5, TODAY);
    expect(r).toBeTruthy();
    expect(r!.intro).toMatch(/first recorded activity|No opportunities with activity/i);
  });
  it("'Name my keen contacts where no deal exists yet.' → warmNoDeal, never a which-deal card", () => {
    const keen = contact({ first: "Keen", last: "Person", organisation: "FreshCo", messaged: true, url: "https://l/kp" });
    (keen as unknown as Record<string, unknown>).relationship_strength = "Keen";
    const D6 = book({ contacts: [keen, KAREN], opps: [opp({ organisation: "ExxonMobil", contact_url: KAREN.url })] });
    const r = computeForQuery("Name my keen contacts where no deal exists yet.", D6, TODAY);
    expect(r).toBeTruthy();
    expect(r!.intro).toMatch(/Warm contacts with no open deal/i);
    expect(r!.rows.map((x) => x.cells[0])).toEqual(["Keen Person"]);
  });
  it("'Of my deals above £100k, which have gone silent?' → risk rank WITH the threshold", () => {
    const big = opp({ organisation: "BigCo", est_value: 150_000, current_step: "qualify" });
    const small = opp({ organisation: "SmallCo", est_value: 50_000, current_step: "qualify" });
    const D7 = book({ opps: [big, small] });
    const r = computeForQuery("Of my deals above £100k, which have gone silent?", D7, TODAY);
    expect(r).toBeTruthy();
    expect(r!.intro).toMatch(/At risk of stalling/i);
    expect(r!.rows.map((x) => x.cells[1])).toEqual(["BigCo"]);
  });
  it("'Have I ever crossed paths with anyone from Rolls-Royce?' → instant honest zero", () => {
    const r = computeForQuery("Have I ever crossed paths with anyone from Rolls-Royce?", book({ contacts: [KAREN] }), TODAY);
    expect(r).toBeTruthy();
    expect(r!.intro).toMatch(/no one from Rolls-Royce/i);
  });
  it("'How many people in my book have I still not sat down with?' → SCALAR, not a dump", () => {
    const r = computeForQuery("How many people in my book have I still not sat down with?", book({ contacts: [KAREN, DANIEL, COLD1] }), TODAY);
    expect(r).toBeTruthy();
    expect(r!.rows.length).toBe(0);
    expect(r!.intro).toMatch(/1 of your 3 contacts/);
  });
  it("warmNoDeal empty book → honest zero", () => {
    expect(warmNoDeal(book({}), TODAY).intro).toMatch(/No warm contacts without a deal/i);
  });
});

describe("Batch2-C: owner-edit warmth precedence (retest #19)", () => {
  it("the user's rating leads; the derived tone is a labelled parenthetical", () => {
    const c = contact({ first: "Priya", last: "OConnor", organisation: "ExxonMobil", messaged: true, url: "https://l/po" });
    (c as unknown as Record<string, unknown>).relationship_strength = "Warm";
    (c as unknown as Record<string, unknown>).warmthSentiment = { score: 4 };
    const r = contactBrief(book({ contacts: [c] }), "Priya OConnor", TODAY);
    expect(r.intro).toMatch(/Relationship: Warm \(your rating; the message tone reads/);
  });
});

describe("Re-verify: meeting-content route (items 4/#32/#36)", () => {
  const RS = contact({ first: "Robert", last: "Schmidt", organisation: "Salesforce", met: true, messaged: true, url: "https://l/rs2" });
  const M = meeting({ id: "rsm1", contact_url: RS.url, date_held: "2026-07-16", sentiment: "Very Positive", contactInfo: { name: "Robert Schmidt", organisation: "Salesforce", seniority: "", function: "", sector_group: "", phone: "" } });
  (M as unknown as Record<string, unknown>).notes = "Good conversation with Robert Schmidt. Discussed cost pressure on the operating model.";
  const D = book({ contacts: [RS], meetingRows: [M] });
  it("'What did Robert Schmidt and I talk about?' → the notes, deterministically", () => {
    const r = meetingContent("What did Robert Schmidt and I talk about?", D, TODAY);
    expect(r).toBeTruthy();
    expect(r!.intro).toMatch(/cost pressure on the operating model/);
  });
  it("'What was our last meeting about?' + thread referent → scoped to Robert", () => {
    const r = meetingContent("What was our last meeting about?", D, TODAY, "Robert Schmidt");
    expect(r).toBeTruthy();
    expect(r!.intro).toMatch(/Robert Schmidt/);
    expect(r!.intro).toMatch(/cost pressure/);
  });
  it("subjectless in a fresh thread → the most recent held meeting overall", () => {
    const r = meetingContent("What was my last meeting about?", D, TODAY);
    expect(r).toBeTruthy();
    expect(r!.intro).toMatch(/cost pressure/);
  });
  it("does not hijack plain meeting lists", () => {
    expect(meetingContent("Any meetings held in the past 10 days?", D, TODAY)).toBeNull();
  });
});

// ── AUDIT SWEEP (2026-07-25): planned-but-unimplemented items from the two fix plans ──────────────
describe("Audit: count/aggregate vocab (re-verify items 1–2)", () => {
  it("'Total up every meeting I've ever logged' is the all-time meetings count", () => {
    const r = computeForQuery("Total up every meeting I've ever logged.", D, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/held 2 meetings all time/i);
  });
  it("'combined value of everything open' is the open-pipeline total, not revenue", () => {
    const r = computeForQuery("What's the combined value of everything open right now?", D, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/[£$]875k|875,000/);
    expect(r!.intro).not.toMatch(/revenue|recognised/i);
  });
});

describe("Audit: namesake superlative (Batch2 vocab row 'which <Name> did I meet most recently')", () => {
  const SARAH1 = contact({ first: "Sarah", last: "Lee", organisation: "HSBC", met: true, url: "https://www.linkedin.com/in/sarah-lee" });
  const SARAH2 = contact({ first: "Sarah", last: "Kim", organisation: "Google", met: true, url: "https://www.linkedin.com/in/sarah-kim" });
  const DS = book({
    contacts: [SARAH1, SARAH2],
    meetingRows: [
      meeting({ contact_url: SARAH1.url, contactInfo: { name: "Sarah Lee", organisation: "HSBC", seniority: "", function: "", sector_group: "", phone: "" }, date_held: "2026-06-01" }),
      meeting({ contact_url: SARAH2.url, contactInfo: { name: "Sarah Kim", organisation: "Google", seniority: "", function: "", sector_group: "", phone: "" }, date_held: "2026-07-10" }),
    ],
  });
  it("ranks namesakes by most recent held meeting", () => {
    const r = namesakeSuperlative("Which Sarah did I meet most recently?", DS, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/Sarah Kim/);
    expect(r!.intro).toMatch(/2026-07-10/);
  });
  it("honest when no namesake has been met", () => {
    const DN = book({ contacts: [SARAH1] });
    const r = namesakeSuperlative("Which Sarah did I see last?", DN, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/haven't met any/i);
  });
  it("does not fire without the superlative", () => {
    expect(namesakeSuperlative("Which Sarah works at HSBC?", DS, TODAY)).toBeNull();
  });
});

describe("Audit: company zero-answers get canonical casing + the warm door (Batch2 plan)", () => {
  it("zero opps at a company you HAVE met someone at names the door", () => {
    const r = findOpportunities(D, { company: "exxonmobil", status: "Open" });
    expect(r.rows.length).toBe(0);
    expect(r.intro).toMatch(/ExxonMobil/);          // canonical casing, not the user's echo
    expect(r.intro).toMatch(/Karen OConnor/);        // the relationship you DO have
    expect(r.intro).toMatch(/warm door/i);
  });
  it("companyZeroLine is honest when no one there has been met", () => {
    const z = companyZeroLine(book({ contacts: [contact({ organisation: "Rolls-Royce", url: "u9" })] }), "rolls-royce", TODAY);
    expect(z.org).toBe("Rolls-Royce");
    expect(z.door).toMatch(/1 person there, though none met/i);
  });
});

describe("Audit: met-twice VACUOUS-TRUTH guard (re-verify item 3)", () => {
  it("empty base says nobody has been met twice — not a filtered-empty message", () => {
    const r = contactsMetAtLeast(D, 2);
    expect(r.rows.length).toBe(0);
    expect(r.intro).toMatch(/haven't met anyone twice/i);
  });
});

describe("Audit: exact-match-first in the related ranker (retest #34, the Thomas Thomas bug)", () => {
  const TT = contact({ first: "Thomas", last: "Thomas", organisation: "Barclays", url: "u-tt" });
  const OT = contact({ first: "Olivia", last: "Thomas", organisation: "Verizon", url: "u-ot" });
  it("the contiguous full-name match ranks above the token-set namesake", () => {
    const g = searchBook("Pull up everything on Olivia Thomas", book({ contacts: [TT, OT] }));
    expect(g).not.toBeNull();
    expect(g!.people[0].main).toBe("Olivia Thomas");
  });
});

describe("Audit: 'change X to Y' with a draft open is a card edit, never a new action", () => {
  it("recognises card-edit phrasings", () => {
    expect(changeCardIntent("Change the value to £55k")).toBe(true);
    expect(changeCardIntent("fix the date, it was yesterday")).toBe(true);
  });
  it("never hijacks real action starters", () => {
    expect(changeCardIntent("Note on Daniel Garcia: he moved to Madrid")).toBe(false);
    expect(changeCardIntent("Log that I met Karen this morning")).toBe(false);
    expect(changeCardIntent("Move the Google deal to Proposal Build")).toBe(false);
  });
});

describe("Audit-2: the formerly-deferred items", () => {
  it("scanEntities finds exactly the named contact and no org for a person-only message", () => {
    // The entity-type dispatch guard's precondition: one contact, zero orgs → accountSummary is a misdial.
    const scan = scanEntities("Look at Karen OConnor", D);
    expect(scan.contacts.length).toBe(1);
    expect(scan.contacts[0].last).toBe("OConnor");
    expect(scan.orgs.length).toBe(0);
  });
  it("scanEntities keeps the org when the message names a company", () => {
    const scan = scanEntities("What's my footprint at ExxonMobil?", D);
    expect(scan.orgs).toContain("ExxonMobil");
  });
});

describe("Re-verify item 5: news-shaped questions", () => {
  it("recognises news asks", () => {
    expect(newsShaped("Anything in the news about JPMorgan lately?")).toBe(true);
    expect(newsShaped("Any headlines on Salesforce?")).toBe(true);
    expect(newsShaped("Has HSBC been in the press this month?")).toBe(true);
  });
  it("deal-status phrasings stay book questions", () => {
    expect(newsShaped("Any news on the JPMorgan deal?")).toBe(false);
    expect(newsShaped("News on my pipeline?")).toBe(false);
    expect(newsShaped("Any news from the Google meeting?")).toBe(false);
  });
});

describe("Re-verify item 7: cancel survives stray punctuation", () => {
  it("wrapping quotes and trailing junk don't defeat the matcher", () => {
    expect(cancelIntent('Cancel that."')).toBe(true);
    expect(cancelIntent('"Cancel that"')).toBe(true);
    expect(cancelIntent("Cancel that.\u201D")).toBe(true);
    expect(cancelIntent("never mind!!")).toBe(true);
  });
  it("real sentences still aren't cancels", () => {
    expect(cancelIntent("Cancel the JPMorgan meeting on Friday")).toBe(false);
    expect(cancelIntent("Close the Chevron deal as won")).toBe(false);
  });
});

describe("Re-verify item 14: compare binds bare first names through the ledger", () => {
  const OLIVIA = contact({ first: "Olivia", last: "Thomas", organisation: "HSBC", met: true, url: "u-oth" });
  const OLIVIA2 = contact({ first: "Olivia", last: "Reed", organisation: "Citi", url: "u-ore" });
  const ROBERT = contact({ first: "Robert", last: "Schmidt", organisation: "Salesforce", met: true, url: "u-rs" });
  const DC = book({ contacts: [OLIVIA, OLIVIA2, ROBERT] });
  it("a bare shared first name resolves to the recent referent, both profiles render", () => {
    const r = compareEntities("How does Robert Schmidt compare to Olivia?", DC, TODAY, ["Olivia Thomas"]);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/Side by side/);
    expect(r!.intro).toMatch(/Robert Schmidt/);
    expect(r!.intro).toMatch(/Olivia Thomas/);
    expect(r!.intro).not.toMatch(/which one did you mean/i);
  });
  it("without a ledger match the ambiguous side still disambiguates", () => {
    const r = compareEntities("How does Robert Schmidt compare to Olivia?", DC, TODAY, []);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/which one did you mean/i);
  });
});

describe("Re-verify item 15: work-at phrasings reach the deterministic brief", () => {
  it("'Which company does Karen work at?' resolves the unique contact", () => {
    const r = frontDoorBrief("Which company does Karen work at?", D, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/Karen OConnor/);
    expect(r!.intro).toMatch(/ExxonMobil/);
  });
  it("a SHARED bare first name gets the complete which-one list, not a model composition", () => {
    const S1 = contact({ first: "Rachel", last: "Schmidt", organisation: "Pfizer", url: "r1" });
    const S2 = contact({ first: "Rachel", last: "Lee", organisation: "UBS", url: "r2" });
    const S3 = contact({ first: "Rachel", last: "Novak", organisation: "Citi", url: "r3" });
    const r = frontDoorBrief("Which company does Rachel work at?", book({ contacts: [S1, S2, S3] }), TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/3 people called Rachel/);
    expect(r!.rows.length).toBe(3);
  });
  it("'where does Daniel Garcia work' briefs him", () => {
    const r = frontDoorBrief("Where does Daniel Garcia work?", D, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/Daniel Garcia/);
  });
});

describe("Re-verify item 28: reminders resolve their subject to a meeting-holder", () => {
  const JPM_OPP = opp({ organisation: "JPMorgan Chase", opportunity_name: "JPMorgan Chase — Finance engagement", current_step: "proposal_build", contact_url: "https://www.linkedin.com/in/rt", id: "o-jpm" });
  const RT = contact({ first: "Rachel", last: "Taylor", organisation: "JPMorgan Chase", met: true, url: "https://www.linkedin.com/in/rt" });
  const DJ = book({ contacts: [RT, KAREN], opps: [JPM_OPP], meetingRows: [
    meeting({ contact_url: RT.url, contactInfo: { name: "Rachel Taylor", organisation: "JPMorgan Chase", seniority: "", function: "", sector_group: "", phone: "" }, date_held: "2026-07-10" }),
  ] });
  it("'the JPMorgan proposal' resolves via the opp's primary contact", () => {
    const c = reminderSubject("Remind me to chase the JPMorgan proposal next Friday.", DJ, TODAY);
    expect(c?.last).toBe("Taylor");
  });
  it("'next Friday' must NOT make the retailer Next a candidate (live-run miss)", () => {
    const NEXTC = contact({ first: "Poppy", last: "Hale", organisation: "Next", url: "u-next" });
    const DN = book({ ...DJ, contacts: [...DJ.contacts, NEXTC] });
    const c = reminderSubject("Remind me to chase the JPMorgan proposal next Friday.", DN, TODAY);
    expect(c?.last).toBe("Taylor");
  });
  it("all-lowercase typing still resolves via deal-context narrowing", () => {
    const NEXTC = contact({ first: "Poppy", last: "Hale", organisation: "Next", url: "u-next" });
    const DN = book({ ...DJ, contacts: [...DJ.contacts, NEXTC] });
    const c = reminderSubject("remind me to chase the jpmorgan proposal next friday", DN, TODAY);
    expect(c?.last).toBe("Taylor");
  });
  it("a named contact resolves directly", () => {
    const c = reminderSubject("Remind me to call Karen OConnor tomorrow", DJ, TODAY);
    expect(c?.last).toBe("OConnor");
  });
  it("no org/contact reference → null (legacy contact card handles it)", () => {
    expect(reminderSubject("Remind me to review the deck on Monday", DJ, TODAY)).toBeNull();
  });
  it("meeting update extract fills followup + parsed date from the reminder", async () => {
    const { SPECS } = await import("./actions/actionSpecs");
    const v = await SPECS.meeting.extract({
      op: "update", text: "Remind me to chase the JPMorgan proposal next Friday.", targetId: "m1",
      subjectUrl: RT.url, today: TODAY, contacts: DJ.contacts, meetingRows: DJ.meetingRows, opps: DJ.opps, sows: [], skipModel: true,
    } as never);
    expect(v.followup).toMatch(/chase the JPMorgan proposal/i);
    expect(v.followup).not.toMatch(/next friday/i);
    expect(v.followup_date).toBe("2026-07-24"); // TODAY is Thu 2026-07-23; "next Friday" = next occurrence
  });
});

describe("orgMatches word-boundary (live run: 'at EY' matched StanlEY/DisnEY/KEYCorp…)", () => {
  const DE = book({ contacts: [
    contact({ first: "Omar", last: "Singh", organisation: "EY", url: "e1" }),
    contact({ first: "Camille", last: "Johnson", organisation: "Morgan Stanley", url: "e2" }),
    contact({ first: "John", last: "Johnson", organisation: "Disney", url: "e3" }),
    contact({ first: "David", last: "Moore", organisation: "KeyCorp", url: "e4" }),
    contact({ first: "Karen", last: "Muller", organisation: "McKinsey & Company", url: "e5" }),
    contact({ first: "Mary", last: "Cole", organisation: "JPMorgan Chase", url: "e6" }),
  ] });
  it("'EY' matches ONLY EY", () => {
    const r = findContacts(DE, { company: "EY" });
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].cells[0]).toBe("Omar Singh");
  });
  it("'JPMorgan' still matches JPMorgan Chase (boundary prefix)", () => {
    const r = findContacts(DE, { company: "JPMorgan" });
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].cells[0]).toBe("Mary Cole");
  });
  it("'McKinsey' matches McKinsey & Company, not EY", () => {
    const r = findContacts(DE, { company: "McKinsey" });
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].cells[0]).toBe("Karen Muller");
  });
});
