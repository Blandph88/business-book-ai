// Phase-02 fix batch 2 (findings F8–F22 from the real-book frontier battery, 2026-07-31).
// Fixtures mirror the real-book shapes that exposed each finding.
import { describe, it, expect } from "vitest";
import {
  findContacts, contactBrief, meetingContent, lastMetQuery, awaitingTheirReply, owedReplies,
  rankOpportunities, computeExact, computeForQuery,
} from "./compute";
import { stripMeetingCommand } from "./actions/actionSpecs";
import type { BookData } from "./bookContext";
import type { Contact } from "../data/contacts";
import type { MeetingRow } from "../data/meetings";
import type { Opportunity } from "../storage/opportunities";

const TODAY = "2026-07-31";

const contact = (url: string, first: string, last: string, organisation: string, over: Partial<Contact> = {}): Contact =>
  ({ first, last, organisation, position: "", sector_detail: "", sector_group: "", sub_group: "", seniority: "",
     function: "", messaged: true, responded: false, two_way: false, agreed_to_meet: false, met: false, url, phone: "", ...over } as Contact);

const meeting = (contact_url: string, name: string, organisation: string, date_held: string, no = 1): MeetingRow =>
  ({ id: `${contact_url}#${no}`, contact_url, meeting_no: no, meeting_stage: "Held", date_held,
     contactInfo: { name, organisation, position: "", function: "", sector_group: "", seniority: "", phone: "" }, isSeed: false } as MeetingRow);

const book = (over: Partial<BookData> = {}): BookData => ({ contacts: [], meetingRows: [], opps: [], sows: [], ...over });

const thread = (lastDate: string, lastFromOwner: boolean, inbound = 1, outbound = 1) =>
  ({ lastDate, lastFromOwner, inboundCount: inbound, outboundCount: outbound });

describe("F9 — count route must not swallow 'at <org>'", () => {
  const d = book({ contacts: [
    contact("p1", "Anu", "Mishra", "PwC", { responded: true, two_way: true }),
    contact("p2", "Steven", "Heeps", "PwC"),
    contact("x1", "Someone", "Else", "Acme"),
  ] });
  it("'how many people do I know at PwC?' answers about PwC, not the whole book", () => {
    const r = computeExact("How many people do I know at PwC?", d, TODAY) ?? computeForQuery("How many people do I know at PwC?", d, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/PwC/i);
    expect(r!.intro).not.toMatch(/in your book|whole book/i);
  });
  it("the unscoped count still works", () => {
    const r = computeExact("How many contacts do I have?", d, TODAY) ?? computeForQuery("How many contacts do I have?", d, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/3/);
  });
});

describe("F14 — never-messaged cut exists and keeps the org scope", () => {
  const d = book({ contacts: [
    contact("e1", "Cold", "One", "EY", { messaged: false }),
    contact("e2", "Cold", "Two", "EY", { messaged: false }),
    contact("e3", "Warm", "Three", "EY", { messaged: true }),
    contact("a1", "Cold", "Acme", "Acme", { messaged: false }),
  ] });
  it("findContacts supports stage: not_messaged", () => {
    const r = findContacts(d, { stage: "not_messaged", company: "EY" });
    expect(r.rows.length).toBe(2);
    expect(r.intro).toMatch(/never messaged/i);
  });
  it("the phrasing routes with the org preserved", () => {
    const r = computeExact("Which of my EY contacts have I never actually messaged?", d, TODAY)
      ?? computeForQuery("Which of my EY contacts have I never actually messaged?", d, TODAY);
    expect(r).not.toBeNull();
    expect(r!.rows.length).toBe(2); // NOT all 3 EY contacts, and not the Acme one
  });
});

describe("F13 — explicit org beats a carried person referent", () => {
  const d = book({
    contacts: [contact("at1", "Ateeq", "Ali", "alrajhi bank", { two_way: true, responded: true })],
    meetingRows: [meeting("at1", "Ateeq Ali", "alrajhi bank", "2026-07-31")],
  });
  it("meetingContent: 'last meeting with EY' with an Ateeq referent answers about EY (honest miss)", () => {
    const r = meetingContent("What was my last meeting with EY about?", book({
      contacts: [...d.contacts, contact("ey1", "Some", "One", "EY")],
      meetingRows: d.meetingRows,
    }), TODAY, "Ateeq Ali");
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/EY/);
    expect(r!.intro).not.toMatch(/Ateeq/);
  });
  it("lastMetQuery answers for an org scope", () => {
    const d2 = book({
      contacts: [contact("ey1", "Some", "One", "EY")],
      meetingRows: [meeting("ey1", "Some One", "EY", "2026-06-01")],
    });
    const r = lastMetQuery("When did I last meet EY?", d2, TODAY, "Ateeq Ali");
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/EY .*2026-06-01|2026-06-01/);
  });
  it("the referent still fills in when nothing is named", () => {
    const r = lastMetQuery("When did we last meet?", d, TODAY, "Ateeq Ali");
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/Ateeq/);
  });
});

describe("F16 — 'when did we last speak' falls back to the message thread", () => {
  const d = book({ contacts: [
    contact("t1", "Taruna", "Bhagtani", "EY", { two_way: true, responded: true, thread: thread("2024-06-08", true, 5, 2) }),
  ] });
  it("no meetings + a real thread → the thread date is in the answer", () => {
    const r = lastMetQuery("When did we last speak?", d, TODAY, "Taruna Bhagtani");
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/2024-06-08/);
    expect(r!.intro).toMatch(/you wrote last/i);
  });
});

describe("F16/F8 — brief last-contact uses meetings and carries age", () => {
  it("a meeting NEWER than the thread wins the last-contact line", () => {
    const d = book({
      contacts: [contact("at1", "Ateeq", "Ali", "alrajhi bank", { two_way: true, responded: true, met: true, thread: thread("2025-01-12", true, 5, 9) })],
      meetingRows: [meeting("at1", "Ateeq Ali", "alrajhi bank", "2026-07-31")],
    });
    const r = contactBrief(d, "Ateeq Ali", TODAY);
    expect(r.intro).toMatch(/Last contact: your meeting on 2026-07-31/);
    expect(r.intro).not.toMatch(/Ball's in their court/);
  });
  it("an old unanswered message carries its age as a re-introduction note", () => {
    const d = book({ contacts: [contact("m1", "Mark", "Old", "HSBC", { thread: thread("2025-01-12", true, 0, 1) })] });
    const r = contactBrief(d, "Mark Old", TODAY);
    expect(r.intro).toMatch(/18 months ago/);
    expect(r.intro).toMatch(/re-introduction/i);
  });
});

describe("F12 — a shared FULL name asks instead of silently briefing", () => {
  const d = book({ contacts: [
    contact("m1", "Mark", "McLoughlin", "HSBC", { position: "Senior Legal Risk Manager" }),
    contact("m2", "Mark", "McLoughlin", "Gresham Executive", { position: "Partner" }),
  ] });
  it("two Mark McLoughlins → the which-one picker", () => {
    const r = contactBrief(d, "Mark McLoughlin", TODAY);
    expect(r.intro).toMatch(/2 people called Mark McLoughlin/i);
    expect(r.rows.length).toBe(2);
  });
  it("'at <org>' narrows to a single brief", () => {
    const r = contactBrief(d, "Mark McLoughlin at Gresham Executive", TODAY);
    expect(r.intro).toMatch(/Partner at Gresham Executive/);
  });
  it("a unique full name briefs directly (no regression)", () => {
    const solo = book({ contacts: [contact("s1", "Ateeq", "Ali", "alrajhi bank")] });
    expect(contactBrief(solo, "Ateeq Ali", TODAY).intro).toMatch(/Ateeq Ali —/);
  });
});

describe("F10 — awaitingTheirReply is the true mirror of owedReplies", () => {
  const d = book({ contacts: [
    contact("w1", "They", "OweMe", "Acme", { two_way: true, responded: true, thread: thread("2026-06-01", true, 2, 3) }),
    contact("w2", "I", "OweThem", "Acme", { two_way: true, responded: true, thread: thread("2026-06-10", false, 2, 3) }),
    contact("w3", "Never", "Replied", "Acme", { thread: thread("2026-05-01", true, 0, 1) }),
  ] });
  it("only two-way threads where the owner sent last", () => {
    const r = awaitingTheirReply(d);
    expect(r.rows.length).toBe(1);
    expect(String(r.rows[0].cells[0])).toMatch(/They OweMe/);
    expect(r.intro).toMatch(/Waiting on them/i);
  });
  it("owedReplies is unchanged in direction and labels its real sort", () => {
    const r = owedReplies(d, TODAY);
    expect(r.rows.length).toBe(1);
    expect(String(r.rows[0].cells[0])).toMatch(/I OweThem/);
    expect(r.intro).toMatch(/most promising first/);
  });
  it("the phrasing routes to the new tool", () => {
    const r = computeExact("Which conversations am I waiting on a reply to?", d, TODAY)
      ?? computeForQuery("Which conversations am I waiting on a reply to?", d, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/Waiting on them/i);
  });
});

describe("F8 — big contact tables show recency", () => {
  const d = book({ contacts: [
    contact("r1", "Recent", "Thread", "Acme", { two_way: true, responded: true, thread: thread("2026-05-20", false, 3, 3) }),
    contact("r2", "No", "Thread", "Acme"),
  ] });
  it("findContacts grows a Last heard column when threads exist", () => {
    const r = findContacts(d, { company: "Acme" });
    expect(r.columns).toContain("Last heard");
    const recentRow = r.rows.find((x) => String(x.cells[0]).includes("Recent"));
    expect(recentRow!.cells).toContain("2026-05-20");
  });
});

describe("F15 — the command never echoes into meeting notes", () => {
  it("'log a coffee with X this morning' strips clean", () => {
    expect(stripMeetingCommand("Log a coffee with Ateeq Ali this morning")).toBe("");
  });
  it("'log a meeting with X' still strips (no regression)", () => {
    expect(stripMeetingCommand("Log a meeting with Priya OConnor this morning")).toBe("");
  });
  it("real content survives", () => {
    expect(stripMeetingCommand("Log a call with Tom: discussed the audit scope, he wants a proposal")).toMatch(/audit scope/);
  });
});

describe("F22 + offer-conditioning — honest copy, no dead-end offers", () => {
  it("the wipe refusal names only REAL paths (no phantom data settings)", () => {
    const d = book();
    const r = computeExact("Wipe my book and start over", d, TODAY) ?? computeForQuery("Wipe my book and start over", d, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/can't delete your book from chat/i);
    expect(r!.intro).not.toMatch(/data settings/i);
    expect(r!.intro).toMatch(/re-import|Your data/i);
  });
  it("empty risk list on an empty book offers nothing that is itself empty", () => {
    const r = rankOpportunities(book(), "risk", undefined, TODAY);
    expect(r.intro).not.toMatch(/won deals/i);
    expect(r.intro).toMatch(/log your first deal/i);
  });
  it("empty risk list offers won deals only when won deals exist", () => {
    const d = book({ opps: [
      { id: "o1", opportunity_name: "X", organisation: "Acme", primary_contact: "", service_line: "Strategy", current_step: "revenue", est_value: 1 } as unknown as Opportunity,
    ] });
    const r = rankOpportunities(d, "risk", undefined, TODAY);
    expect(r.intro).toMatch(/won deals/i);
  });
  it("the empty-org footprint no longer offers a watch it cannot do", () => {
    const d = book({ contacts: [contact("x1", "A", "B", "Acme")] });
    const r = computeExact("What's my history with Nintendo?", d, TODAY) ?? computeForQuery("What's my history with Nintendo?", d, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).not.toMatch(/keep an eye out/i);
  });
});
