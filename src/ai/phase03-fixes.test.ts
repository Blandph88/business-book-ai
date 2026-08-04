// Phase-03 fix batch (DeepSeek-run findings). Seniority/access ranking (P3-7/P3-10/P3-31), first-name
// count (P3-19), two-way×not-met (P3-14), sectorContacts intro (P3-18).
import { describe, it, expect } from "vitest";
import { topBySeniority, firstNameCount, talkedNotMet, sectorContacts, capabilitiesResponse, computeExact, computeForQuery } from "./compute";
import type { BookData } from "./bookContext";
import type { Contact } from "../data/contacts";

const TODAY = "2026-08-02";
const contact = (url: string, first: string, last: string, organisation: string, over: Partial<Contact> = {}): Contact =>
  ({ first, last, organisation, position: "", sector_detail: "", sector_group: "", sub_group: "", seniority: "",
     function: "", messaged: true, responded: false, two_way: false, agreed_to_meet: false, met: false, url, phone: "", ...over } as Contact);
const book = (over: Partial<BookData> = {}): BookData => ({ contacts: [], meetingRows: [], opps: [], sows: [], ...over });
const route = (q: string, d: BookData) => computeExact(q, d, TODAY) ?? computeForQuery(q, d, TODAY);

describe("P3-7/P3-10/P3-31: seniority & access rank by SENIORITY, not warmth", () => {
  const d = book({ contacts: [
    contact("cso", "Abid", "Shakeel", "alrajhi bank", { seniority: "Executive Leadership", position: "Group Chief Strategy Officer" }), // in=0, cold on LinkedIn
    contact("rm", "Nasser", "Junior", "alrajhi bank", { seniority: "Associate / Analyst", two_way: true, responded: true, thread: { lastDate: "2026-06-01", lastFromOwner: false, inboundCount: 7, outboundCount: 5 } }),
    contact("x", "Someone", "Else", "Acme", { seniority: "Head of / Director" }),
  ] });
  it("topBySeniority puts the Group CSO first despite zero LinkedIn engagement", () => {
    const r = topBySeniority(d, "Al Rajhi", TODAY);
    expect(r.rows[0].cells[0]).toBe("Abid Shakeel");
    expect(r.intro).toMatch(/most senior/i);
  });
  it("'who's the most senior person at Al Rajhi' routes to seniority (CSO first)", () => {
    const r = route("who's the most senior person I know at Al Rajhi?", d);
    expect(r).not.toBeNull();
    expect(r!.rows[0].cells[0]).toBe("Abid Shakeel");
  });
  it("'any way into Al Rajhi' → seniority-first access, not warmth", () => {
    const r = route("any way into Al Rajhi?", d);
    expect(r).not.toBeNull();
    expect(r!.rows[0].cells[0]).toBe("Abid Shakeel");
  });
  it("'most important people I know' → seniority, not the warmth default", () => {
    const r = route("who are the most important people I know?", d);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/most senior/i);
  });
  it("'richest person I know' → honest 'don't track wealth' + seniority proxy", () => {
    const r = route("who's the richest person I know?", d);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/don't track wealth/i);
    expect(r!.intro).toMatch(/proxy/i);
  });
});

describe("P3-19: first-name count", () => {
  const d = book({ contacts: [
    contact("d1", "David", "One", "A"), contact("d2", "David", "Two", "B"), contact("d3", "David", "Three", "C"),
    contact("j1", "James", "One", "D"),
  ] });
  it("firstNameCount returns the count, not the whole book", () => {
    const r = firstNameCount(d, "David");
    expect(r.intro).toMatch(/3 people called David/);
    expect(r.rows.length).toBe(3);
  });
  it("'how many Davids do I know?' routes to the count (not all 4 contacts)", () => {
    const r = route("how many Davids do I know?", d);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/3 people called David/);
  });
});

describe("P3-14: two-way × not-met anti-join", () => {
  const d = book({ contacts: [
    contact("t1", "Talked", "NotMet", "A", { two_way: true, responded: true, met: false }),
    contact("t2", "Talked", "Met", "B", { two_way: true, responded: true, met: true }),
    contact("t3", "Cold", "NeverReplied", "C", { messaged: true, met: false }),
  ] });
  it("talkedNotMet = replied AND not met (excludes never-replied and already-met)", () => {
    const r = talkedNotMet(d);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].cells[0]).toBe("Talked NotMet");
  });
  it("'people I've been talking to but never met' routes correctly (not the whole never-met book)", () => {
    const r = route("show me people I've been talking to but never actually met", d);
    expect(r).not.toBeNull();
    expect(r!.rows.length).toBe(1);
    expect(r!.rows[0].cells[0]).toBe("Talked NotMet");
  });
});

describe("P3-1: casual capability phrasings reach the menu (no 'I can't do that' preamble)", () => {
  it("'what can this thing actually do?' is recognised as a capability question", () => {
    const r = capabilitiesResponse("what can this thing actually do?", false);
    expect(r).not.toBeNull();
    expect(r!.intro).not.toMatch(/don't have a way to do that/i);
    expect(r!.intro).toMatch(/Find & summarise/);
  });
  it("'what can you do' still works", () => {
    expect(capabilitiesResponse("what can you do?", false)).not.toBeNull();
  });
});

describe("P3-18: sectorContacts intro no longer implies all are senior", () => {
  it("intro reads 'X contacts, most senior first', not 'most senior contacts'", () => {
    const d = book({ contacts: [
      contact("a", "A", "One", "EY", { function: "Finance & Accounting", seniority: "Manager" }),
      contact("b", "B", "Two", "PwC", { function: "Finance & Accounting", seniority: "Associate / Analyst" }),
    ] });
    const r = sectorContacts(d, "function", "Finance & Accounting");
    expect(r.intro).toMatch(/contacts, most senior first/i);
    expect(r.intro).not.toMatch(/most senior contacts/i);
  });
});
