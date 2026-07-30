import { describe, it, expect, vi } from "vitest";

// The action WRITE layer touches the opportunity/meeting stores, which freeze a scoped storage key at module
// load. Opt into demo BEFORE those modules import (vi.hoisted runs above imports), matching the store tests.
vi.hoisted(() => {
  (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__ = true;
});

import { SPECS, parseMoney, matchOpportunity, namedMonthDate } from "./actionSpecs";
import type { Opportunity } from "../../storage/opportunities";
import type { ActionCtx } from "./actionSpecs";

function baseCtx(over: Partial<ActionCtx> = {}): ActionCtx {
  return { op: "create", text: "", today: "2026-07-08", contacts: [], meetingRows: [], opps: [], sows: [], ...over };
}
function opp(over: Partial<Opportunity> = {}): Opportunity {
  return { id: "opp:1", opportunity_name: "Acme expansion", organisation: "Acme", primary_contact: "", service_line: "Strategy", current_step: "pursuit", ...over };
}

describe("parseMoney", () => {
  it("parses money-ish signals (symbol / magnitude / grouping)", () => {
    expect(parseMoney("worth £200k")).toBe(200_000);
    expect(parseMoney("about 1.5m")).toBe(1_500_000);
    expect(parseMoney("£250")).toBe(250);
    expect(parseMoney("value is 200,000")).toBe(200_000);
  });
  it("does NOT grab a bare integer (a date / time), preventing a wrong Est. value", () => {
    expect(parseMoney("met on June 12, went well")).toBe(0);
    expect(parseMoney("call at 3 tomorrow")).toBe(0);
    expect(parseMoney("no value mentioned")).toBe(0);
  });
});

describe("matchOpportunity", () => {
  const opps = [opp({ id: "opp:a", opportunity_name: "Acme expansion", organisation: "Acme" }), opp({ id: "opp:b", opportunity_name: "Globex refresh", organisation: "Globex" })];
  it("resolves a single deal by name/org token", () => {
    expect(matchOpportunity("mark the Globex deal as won", opps).map((o) => o.id)).toEqual(["opp:b"]);
  });
  it("returns [] when nothing recognisable is named (so the caller must clarify, not guess)", () => {
    expect(matchOpportunity("mark the deal as won", opps)).toEqual([]);
  });
});

describe("opportunity write — unresolved update never creates a duplicate", () => {
  it("throws UNRESOLVED_UPDATE instead of creating when op=update has no target", () => {
    expect(() => SPECS.opportunity.write({ opportunity_name: "Acme" }, baseCtx({ op: "update" })))
      .toThrow("UNRESOLVED_UPDATE");
  });
  it("marks an existing deal Lost (flag set, not a new record) via the Outcome", () => {
    const existing = opp({ id: "opp:x", lost: false });
    const res = SPECS.opportunity.write({ outcome: "Lost" }, baseCtx({ op: "update", targetId: "opp:x", opps: [existing] }));
    expect(res.id).toBe("opp:x"); // edited in place, not a new opp:<uuid>
    expect(res.summary).toMatch(/marked lost/i);
  });
  it("marks an existing deal Won (jumps to closed-won) via the Outcome", () => {
    const existing = opp({ id: "opp:y", current_step: "pursuit", lost: true });
    const res = SPECS.opportunity.write({ outcome: "Won" }, baseCtx({ op: "update", targetId: "opp:y", opps: [existing] }));
    expect(res.id).toBe("opp:y");
    expect(res.summary).toMatch(/marked won/i);
  });
});

describe("meeting write — unresolved update never creates a duplicate", () => {
  it("throws UNRESOLVED_UPDATE instead of logging a second meeting when op=update has no targetId", () => {
    expect(() => SPECS.meeting.write({ meeting_stage: "Held" }, baseCtx({ op: "update", subjectUrl: "https://linkedin.com/in/x" })))
      .toThrow("UNRESOLVED_UPDATE");
  });
});

// ── #34: named-month follow-up parsing (deterministic, overrides the model's day arithmetic) ──────
describe("namedMonthDate (R-I #34)", () => {
  it("resolves 'in March' from a July date to NEXT year's March, 1st", () => {
    expect(namedMonthDate("2026-07-09", "reconnect with them in March")).toBe("2027-03-01");
  });
  it("resolves a later-this-year month to this year", () => {
    expect(namedMonthDate("2026-07-09", "follow up in November")).toBe("2026-11-01");
  });
  it("returns '' when no month is named", () => {
    expect(namedMonthDate("2026-07-09", "reconnect soon")).toBe("");
  });
});

// ── WS4 battery fixes (#17 #26 #32 #19-adjacent) ────────────────────────────────────────────────
import { extractOrg } from "./actionSpecs";
import type { Contact } from "../../data/contacts";

const mkContact = (first: string, last: string, organisation: string, url: string): Contact =>
  ({ first, last, organisation, position: "", sector_detail: "", sector_group: "", sub_group: "", seniority: "",
     function: "", messaged: false, responded: false, two_way: false, agreed_to_meet: false, met: false, url, phone: "" } as Contact);

describe("#17 — extractOrg: exact beats superstring; generic tokens never carry a match", () => {
  const ctx = baseCtx({ contacts: [
    mkContact("A", "One", "Accenture", "u1"),
    mkContact("B", "Two", "Accenture Strategy", "u2"),
    mkContact("C", "Three", "ExxonMobil", "u3"),
    mkContact("D", "Four", "OC&C Strategy Consultants", "u4"),
    mkContact("E", "Five", "Ashcroft Group", "u5"),
    mkContact("F", "Six", "Ashcroft Advisers", "u6"),
  ]});
  it("a typed exact org wins over its superstring ('Accenture' ≠ 'Accenture Strategy')", () => {
    expect(extractOrg("start a new deal with Accenture", ctx)).toBe("Accenture");
  });
  it("the fully-typed superstring still wins when that IS what was typed", () => {
    expect(extractOrg("start a new deal with Accenture Strategy", ctx)).toBe("Accenture Strategy");
  });
  it("a service keyword cannot beat an exact org name ('the ExxonMobil strategy work' → ExxonMobil)", () => {
    expect(extractOrg("open an opportunity for the ExxonMobil strategy work", ctx)).toBe("ExxonMobil");
  });
  it("a genuinely ambiguous token ('Ashcroft') stays EMPTY rather than guessing a firm", () => {
    expect(extractOrg("start a deal with Ashcroft", ctx)).toBe("");
  });
});

describe("#32 — 'book a meeting' is future intent with NOTHING fabricated", () => {
  it("book → Scheduled, no date_held, no sentiment, no opportunity_spotted, no command junk in notes", async () => {
    const v = await SPECS.meeting.extract(baseCtx({ text: "Book a meeting with them", skipModel: true }));
    expect(v.meeting_stage).toBe("Scheduled");
    expect(v.date_held).toBeUndefined();
    expect(v.sentiment).toBeUndefined();
    expect(v.opportunity_spotted).toBeUndefined();
    expect(v.notes || "").not.toContain("Book a meeting");
  });
  it("a past-tense log still defaults Held + today", async () => {
    const v = await SPECS.meeting.extract(baseCtx({ text: "Log a meeting with Priya OConnor this morning", today: "2026-07-29", skipModel: true }));
    expect(v.meeting_stage).toBe("Held");
    expect(v.date_held).toBe("2026-07-29");
  });
});

describe("#26 — contact-update extraction actually populates the card", () => {
  it("'promoted to Partner' lands in Role/title", async () => {
    const v = await SPECS.contact.extract(baseCtx({ op: "update", text: "Priya got promoted to Partner — update her" }));
    expect(v.position).toBe("Partner");
  });
  it("'role to Partner' lands too", async () => {
    const v = await SPECS.contact.extract(baseCtx({ op: "update", text: "Update Priya OConnor's role to Partner" }));
    expect(v.position).toBe("Partner");
  });
  it("'add a note that …' captures the substance without a colon", async () => {
    const v = await SPECS.contact.extract(baseCtx({ op: "update", text: "Add a note that Emma prefers email" }));
    expect(v.notes).toBe("Emma prefers email");
  });
});
