// WS2 regression tests — the constraint-under-application theme (findings #7/#9/#10/#12 + #6 partial).
// Each test pins a live-battery failure: explicit windows ("since April"), met-without-opp qualifiers
// ("more than once", "warm"), company-scoped meeting recall, and meeting-staleness in the risk ranking.
import { describe, it, expect } from "vitest";
import {
  windowSince, findMeetings, meetingsCount, meetingsWithoutOpp, rankOpportunities, meetingContent, runTool,
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
