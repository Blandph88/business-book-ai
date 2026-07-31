// Phase-02 battery fixes (real-book findings, 2026-07-31): F3 aggregate labelling, F4 brand
// aliases, F5 engagement-first slices. Fixtures mirror the real-book shapes that exposed each bug.
import { describe, it, expect } from "vitest";
import { orgMatches, findContacts, accountSummary, sortByEngagement } from "./compute";
import type { BookData } from "./bookContext";
import type { Contact } from "../data/contacts";

const contact = (url: string, first: string, last: string, organisation: string, over: Partial<Contact> = {}): Contact =>
  ({ first, last, organisation, position: "", sector_detail: "", sector_group: "", sub_group: "", seniority: "",
     function: "", messaged: true, responded: false, two_way: false, agreed_to_meet: false, met: false, url, phone: "", ...over } as Contact);

const book = (over: Partial<BookData> = {}): BookData => ({ contacts: [], meetingRows: [], opps: [], sows: [], ...over });

describe("F4 — brand aliases in orgMatches", () => {
  it("'EY' reaches Ernst & Young variants (the 164 missed rows)", () => {
    expect(orgMatches("Ernst & Young", "EY")).toBe(true);
    expect(orgMatches("Ernst & Young Global Consulting Services", "ey")).toBe(true);
    expect(orgMatches("EY", "ey")).toBe(true);
    expect(orgMatches("EY-Parthenon", "ey")).toBe(true);
  });
  it("works in the reverse direction ('Ernst & Young' finds EY rows)", () => {
    expect(orgMatches("EY", "Ernst & Young")).toBe(true);
  });
  it("'PwC' reaches the long form", () => {
    expect(orgMatches("PricewaterhouseCoopers", "PwC")).toBe(true);
    expect(orgMatches("PwC UK", "pwc")).toBe(true);
  });
  it("does not loosen unrelated matching (the old EY-substring bug stays dead)", () => {
    expect(orgMatches("Morgan Stanley", "EY")).toBe(false);
    expect(orgMatches("McKinsey & Company", "ey")).toBe(false);
    expect(orgMatches("KEYCorp", "ey")).toBe(false);
  });
});

describe("F5 — engagement-first ordering", () => {
  // The Riyad Bank shape: engaged contacts buried at the bottom of book order.
  const cold = Array.from({ length: 45 }, (_, i) => contact(`u${i}`, "Cold", `C${i}`, "Riyad Bank"));
  const warm = contact("warm", "Saud", "Algazlan", "Riyad Bank",
    { two_way: true, responded: true, thread: { lastDate: "2026-06-01", lastFromOwner: true, inboundCount: 7, outboundCount: 8 } });
  const agreed = contact("agreed", "Mohammed", "Ahmed", "Riyad Bank", { two_way: true, responded: true, agreed_to_meet: true });

  it("sortByEngagement puts stage above book order, thread depth as tiebreak", () => {
    const sorted = sortByEngagement([...cold, warm, agreed]);
    expect(sorted[0].url).toBe("agreed"); // agreed_to_meet outranks two-way
    expect(sorted[1].url).toBe("warm");
  });

  it("findContacts' 40-row slice now contains the engaged contacts even from rows 41+", () => {
    const d = book({ contacts: [...cold, warm, agreed] }); // engaged sit at positions 46-47
    const res = findContacts(d, { company: "Riyad Bank" });
    const names = res.rows.map((r) => r.cells[0]);
    expect(res.rows.length).toBe(40);
    expect(names[0]).toBe("Mohammed Ahmed");
    expect(names[1]).toBe("Saud Algazlan");
    expect(res.intro).toContain("most engaged first");
  });

  it("accountSummary's 20-row slice leads with engaged contacts too", () => {
    const d = book({ contacts: [...cold, warm, agreed] });
    const res = accountSummary(d, "Riyad Bank");
    expect(res.rows[0].cells[0]).toBe("Mohammed Ahmed");
    expect(res.rows[1].cells[0]).toBe("Saud Algazlan");
  });
});

describe("F3 — multi-entity aggregates labelled by the query, not one member", () => {
  const d = book({ contacts: [
    contact("a1", "A", "One", "Al Rajhi Takaful"),
    contact("a2", "B", "Two", "alrajhi bank"),
    contact("a3", "C", "Three", "alrajhi bank"),
    contact("a4", "D", "Four", "Al Rajhi Capital"),
  ] });

  it("labels the aggregate with the query and lists the per-entity breakdown", () => {
    const res = accountSummary(d, "Al Rajhi");
    expect(res.intro.startsWith("Al Rajhi: 4 contacts")).toBe(true);
    expect(res.intro).toContain("Across 3 entities:");
    expect(res.intro).toContain("alrajhi bank 2");
    // The wrong old behaviour: first row's entity named the whole group.
    expect(res.intro.startsWith("Al Rajhi Takaful:")).toBe(false);
  });

  it("a single-entity match keeps the canonical org casing (no behaviour change)", () => {
    const one = book({ contacts: [contact("k1", "K", "One", "KPMG UK"), contact("k2", "K", "Two", "KPMG UK")] });
    const res = accountSummary(one, "kpmg uk");
    expect(res.intro.startsWith("KPMG UK: 2 contacts")).toBe(true);
    expect(res.intro).not.toContain("Across");
  });
});
