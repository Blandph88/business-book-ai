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
  deicticWithoutEntity, contactBrief, rankOpportunities, capabilitiesResult,
} from "./compute";
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
    expect(r!.intro).toMatch(/can't filter .* by date yet/i);
  });
  it("'opportunities created this month' carries the surrender note", () => {
    const r = computeForQuery("Show me opportunities created this month.", D, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/can't filter/i);
  });
  it("an undated pipeline ask has NO surrender noise", () => {
    const r = computeForQuery("How's my pipeline looking?", D, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).not.toMatch(/can't filter/i);
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
    expect(r!.intro).toMatch(/£75k/);
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
    expect(r!.intro).toMatch(/£200k/);
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
    expect(r.intro).toMatch(/past \(won or lost\)|past — won or lost/i);
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
