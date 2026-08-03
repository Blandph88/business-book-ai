// WS2 regression tests — the constraint-under-application theme (findings #7/#9/#10/#12 + #6 partial).
// Each test pins a live-battery failure: explicit windows ("since April"), met-without-opp qualifiers
// ("more than once", "warm"), company-scoped meeting recall, and meeting-staleness in the risk ranking.
import { describe, it, expect } from "vitest";
import {
  windowSince, findMeetings, meetingsCount, meetingsWithoutOpp, rankOpportunities, meetingContent, runTool, lastMetQuery, compareEntities,
} from "./compute";
import type { BookData } from "./bookContext";
import type { Contact } from "../data/contacts";
import type { MeetingRow } from "../data/meetings";
import type { Opportunity } from "../storage/opportunities";

const TODAY = "2026-07-29";

const contact = (url: string, first: string, last: string, organisation: string, over: Partial<Contact> = {}): Contact =>
  ({ first, last, organisation, position: "", sector_detail: "", sector_group: "", sub_group: "", seniority: "",
     function: "", messaged: true, responded: true, two_way: true, agreed_to_meet: true, met: true, url, phone: "", ...over } as Contact);

const meeting = (contact_url: string, name: string, organisation: string, date_held: string, no = 1, over: Partial<MeetingRow> = {}): MeetingRow =>
  ({ id: `${contact_url}#${no}`, contact_url, meeting_no: no, meeting_stage: "Held", date_held,
     contactInfo: { name, organisation, position: "", function: "", sector_group: "", phone: "" }, isSeed: false, ...over } as MeetingRow);

const opp = (id: string, organisation: string, contact_url: string | undefined, est_value: number, current_step = "scoping", over: Partial<Opportunity> = {}): Opportunity =>
  ({ id, opportunity_name: `${organisation} — Strategy engagement`, organisation, primary_contact: "", service_line: "Strategy",
     current_step, est_value, probability: 0.25, contact_url, ...over } as Opportunity);

const book = (over: Partial<BookData> = {}): BookData => ({ contacts: [], meetingRows: [], opps: [], sows: [], ...over });

describe("#7 — explicit date boundaries (windowSince)", () => {
  it("parses 'since April' to the 1st of April this year", () => {
    expect(windowSince("meetings since april?", TODAY)).toEqual({ start: "2026-04-01", label: "since April" });
  });
  it("a future month without a year means LAST year's", () => {
    expect(windowSince("meetings since november", TODAY)?.start).toBe("2025-11-01");
  });
  it("parses an explicit day — 'since 15 May'", () => {
    expect(windowSince("since 15 may", TODAY)?.start).toBe("2026-05-15");
  });
  it("returns null when no boundary is named (rolling windows keep their own parse)", () => {
    expect(windowSince("meetings in the last 3 months", TODAY)).toBeNull();
  });
  it("findMeetings applies the boundary and SAYS so — no silent rolling default", () => {
    const d = book({ meetingRows: [
      meeting("u1", "Old Meeting", "OldCo", "2026-03-15"),
      meeting("u2", "In Window", "NewCo", "2026-05-10"),
    ]});
    const r = findMeetings(d, TODAY, "meetings since april?");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].cells[1]).toBe("In Window");
    expect(r.intro).toContain("since April");
    expect(r.intro).not.toContain("last two weeks");
  });
  it("meetingsCount windows on the boundary too", () => {
    const d = book({ meetingRows: [meeting("u1", "A", "X", "2026-03-15"), meeting("u2", "B", "Y", "2026-05-10")] });
    const r = meetingsCount(d, TODAY, "how many meetings since april?");
    expect(r.intro).toContain("1 meeting");
    expect(r.intro).toContain("since April");
  });
});

describe("#9 — met-without-opp honours its qualifiers", () => {
  const twice = [meeting("u1", "Daniel Garcia", "Confluent", "2026-07-28", 1), meeting("u1", "Daniel Garcia", "Confluent", "2026-07-29", 2)];
  const once = [meeting("u2", "Tom Ward", "Iberdrola", "2026-07-27", 1, { sentiment: "Very Positive" }), meeting("u3", "Lars Wright", "E.ON", "2026-07-13", 1, { sentiment: "Neutral" })];
  const d = book({
    contacts: [contact("u1", "Daniel", "Garcia", "Confluent"), contact("u2", "Tom", "Ward", "Iberdrola"), contact("u3", "Lars", "Wright", "E.ON")],
    meetingRows: [...twice, ...once],
  });
  it("'more than once' filters to genuinely repeat-met contacts and says so", () => {
    const r = meetingsWithoutOpp(d, "who have I met more than once but never opened a deal with?");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].cells[1]).toBe("Daniel Garcia");
    expect(r.intro).toContain("more than once");
  });
  it("'warm' filters on tone and says so", () => {
    const r = meetingsWithoutOpp(d, "warm contacts I haven't turned into opportunities?");
    const names = r.rows.map((x) => x.cells[1]);
    expect(names).toContain("Tom Ward");
    expect(names).not.toContain("Lars Wright"); // Neutral tone, no warmth score
    expect(r.intro).toContain("warm");
  });
  it("no qualifier keeps the broad list (unchanged behaviour)", () => {
    const r = meetingsWithoutOpp(d, "which meetings haven't turned into a deal yet?");
    expect(r.rows).toHaveLength(3);
  });
  it("an unsatisfiable qualifier gets an HONEST empty, not a mislabelled broad list", () => {
    const solo = book({ contacts: d.contacts, meetingRows: once });
    const r = meetingsWithoutOpp(solo, "met more than once but no deal");
    expect(r.rows).toHaveLength(0);
    expect(r.intro).toContain("No one fits");
  });
});

describe("#10 — meeting recall honours a company scope", () => {
  const d = book({
    contacts: [contact("u1", "Mary", "Andersson", "ExxonMobil"), contact("u2", "Daniel", "Garcia", "Confluent")],
    meetingRows: [
      meeting("u1", "Mary Andersson", "ExxonMobil", "2026-07-14", 1, { notes: "Cost pressure discussion" }),
      meeting("u2", "Daniel Garcia", "Confluent", "2026-07-28", 1, { notes: "Regulatory deadline" }),
    ],
  });
  it("'my last meeting with ExxonMobil' recalls the ExxonMobil meeting, not the global latest", () => {
    const r = meetingContent("what was my last meeting with ExxonMobil about?", d, TODAY);
    expect(r?.intro).toContain("Mary Andersson");
    expect(r?.intro).not.toContain("Daniel Garcia");
  });
  it("a company with no meetings gets the honest miss", () => {
    const d2 = book({ contacts: [contact("u9", "Priya", "OConnor", "Korn Ferry"), ...d.contacts], meetingRows: d.meetingRows });
    const r = meetingContent("what was my last meeting with Korn Ferry about?", d2, TODAY);
    expect(r?.intro).toContain("No meetings logged with anyone at Korn Ferry");
  });
});

describe("#12 — risk ranking includes meeting-staleness, excludes fresh momentum", () => {
  const d = book({
    contacts: [contact("k1", "Kay", "Png", "KPMG"), contact("x1", "Mary", "Andersson", "ExxonMobil")],
    meetingRows: [
      meeting("k1", "Kay Png", "KPMG", "2026-02-16"),        // 5+ months stale
      meeting("x1", "Mary Andersson", "ExxonMobil", "2026-07-20"), // met 9 days ago
    ],
    opps: [
      opp("o-kpmg", "KPMG", "k1", 75_000, "proposal_delivery"),      // small, late-stage, STALE — must appear
      opp("o-exxon", "ExxonMobil", "x1", 350_000, "procurement"),    // late-stage, freshly met, no quiet signal — must NOT
      opp("o-google", "Google", undefined, 800_000, "scoping"),      // big early-stage — appears
    ],
  });
  it("a stale-met deal below the value cut now surfaces; a freshly-met signal-less deal does not", () => {
    const r = rankOpportunities(d, "risk", undefined, TODAY);
    const companies = r.rows.map((x) => String(x.cells[1]));
    expect(companies).toContain("KPMG");
    expect(companies).not.toContain("ExxonMobil");
    expect(companies).toContain("Google");
    expect(r.columns).toContain("Last met");
    expect(r.rows.find((x) => x.cells[1] === "KPMG")?.cells[4]).toBe("2026-02-16"); // the staleness evidence
  });
  it("runTool redirects a quiet-worded findOpportunities call to the risk ranking (14a)", () => {
    const r = runTool({ tool: "findOpportunities", args: { minValue: 20000 } }, d, TODAY, "which deals over £20k have gone quiet?");
    expect(r?.intro).toContain("At risk of stalling");
  });
});

describe("#30/#1 — referent carry: consume pronouns, never override typed entities", () => {
  const d = book({
    contacts: [contact("p1", "Priya", "OConnor", "ExxonMobil"), contact("m1", "Mary", "Andersson", "ExxonMobil")],
    meetingRows: [meeting("p1", "Priya OConnor", "ExxonMobil", "2026-07-29", 1, { sentiment: "Neutral" })],
  });
  it("'when did I last meet them?' answers from the carried referent (#30)", () => {
    const r = lastMetQuery("When did I last meet them?", d, TODAY, "Priya OConnor");
    expect(r?.intro).toContain("You last met Priya OConnor");
    expect(r?.intro).toContain("2026-07-29");
  });
  it("a NAMED contact in the text beats the referent", () => {
    const r = lastMetQuery("When did I last meet Mary Andersson?", d, TODAY, "Priya OConnor");
    expect(r?.intro).toContain("Mary Andersson");
    expect(r?.intro).toContain("haven't met");
  });
  it("an unanchored pronoun falls through (null) — no guessing", () => {
    expect(lastMetQuery("When did I last meet them?", d, TODAY, undefined)).toBeNull();
  });
  it("a non-recency question falls through", () => {
    expect(lastMetQuery("Who do I know at ExxonMobil?", d, TODAY, "Priya OConnor")).toBeNull();
  });
  it("runTool contactBrief over-carry guard: a routed stale name yields to the org the user actually typed (#1)", () => {
    const r = runTool({ tool: "contactBrief", args: { name: "Priya OConnor" } }, d, TODAY, "what's my history with ExxonMobil?");
    // The user's text names ExxonMobil (an org, no contact) → account footprint, not Priya's brief.
    expect(r?.intro).toContain("ExxonMobil");
    expect(r?.intro).not.toContain("Priya OConnor —");
  });
  it("runTool contactBrief with the name genuinely in the text stays a brief", () => {
    const r = runTool({ tool: "contactBrief", args: { name: "Priya OConnor" } }, d, TODAY, "look at Priya OConnor");
    expect(r?.intro).toContain("Priya OConnor");
  });
});

describe("#29 — comparative first-name ambiguity asks instead of silently picking", () => {
  const d = book({ contacts: [
    contact("pm1", "Priya", "OConnor", "ExxonMobil"),
    contact("pm2", "Priya", "Miller", "City National Bank"),
    contact("pat", "Patricia", "Miller", "ExxonMobil"),
  ]});
  it("'who's the stronger relationship, Priya or Patricia Miller?' → the which-Priya picker", () => {
    const r = compareEntities("Who's the stronger relationship, Priya or Patricia Miller?", d, TODAY);
    expect(r?.intro.toLowerCase()).toContain("which one");
  });
  it("full names on both sides compare in a side-by-side table", () => {
    const r = compareEntities("Compare Priya OConnor and Patricia Miller", d, TODAY);
    expect(r?.intro).toContain("Comparing");
    expect(r?.columns).toContain("Priya OConnor");
    expect(r?.columns).toContain("Patricia Miller");
    expect(r?.rows.length).toBeGreaterThan(0);
  });
  // P3-6 regression: a 3-way compare must include ALL THREE entities, never silently drop the tail.
  it("three-way org compare includes every entity as a column", () => {
    const d3 = book({ contacts: [
      contact("a1", "A", "One", "KPMG"), contact("a2", "A", "Two", "KPMG"),
      contact("b1", "B", "One", "PwC"),
      contact("c1", "C", "One", "Deloitte"),
    ]});
    const r = compareEntities("compare KPMG vs PwC vs Deloitte", d3, TODAY);
    expect(r).not.toBeNull();
    expect(r!.columns).toContain("KPMG");
    expect(r!.columns).toContain("PwC");
    expect(r!.columns).toContain("Deloitte");
    // KPMG row shows 2 contacts, others 1 — the numbers are real, not dropped.
    const contactsRow = r!.rows.find((x) => String(x.cells[0]) === "Contacts");
    expect(contactsRow).toBeTruthy();
  });
});

describe("regression residuals (2026-07-30 battery re-run)", () => {
  it("R2: runTool findMeetings lets the user's 'since <month>' beat router-computed day args", () => {
    const d = book({ meetingRows: [meeting("u1", "Old", "OldCo", "2026-03-15"), meeting("u2", "New", "NewCo", "2026-05-10")] });
    const r = runTool({ tool: "findMeetings", args: { direction: "past", windowDays: 180 } }, d, TODAY, "meetings since april?");
    expect(r?.intro).toContain("since April");
    expect(r?.rows).toHaveLength(1);
  });
  it("S3: within a signal tier the STALEST deal outranks a bigger fresher one", () => {
    const d = book({
      contacts: [contact("k1", "Kay", "Png", "KPMG"), contact("j1", "Jo", "Pm", "JPMorgan Chase")],
      meetingRows: [meeting("k1", "Kay Png", "KPMG", "2026-02-16"), meeting("j1", "Jo Pm", "JPMorgan Chase", "2026-06-01")],
      opps: [
        opp("o-j", "JPMorgan Chase", "j1", 200_000, "clearance"),
        opp("o-k", "KPMG", "k1", 75_000, "proposal_delivery"),
      ],
    });
    const r = rankOpportunities(d, "risk", undefined, TODAY);
    const companies = r.rows.map((x) => String(x.cells[1]));
    expect(companies.indexOf("KPMG")).toBeLessThan(companies.indexOf("JPMorgan Chase"));
  });
  it("R16: the compare-ambiguity picker caps at 6 with a type-the-full-name invite", () => {
    const many = Array.from({ length: 9 }, (_, i) => contact(`p${i}`, "Priya", `Surname${i}`, `Org${i}`));
    const d = book({ contacts: [...many, contact("pat", "Patricia", "Miller", "ExxonMobil")] });
    const r = compareEntities("Who's the stronger relationship, Priya or Patricia Miller?", d, TODAY);
    expect(r?.rows.length).toBeLessThanOrEqual(6);
    expect(r?.intro).toContain("full name");
  });
});
