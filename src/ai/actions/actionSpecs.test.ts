import { describe, it, expect, vi } from "vitest";

// The action WRITE layer touches the opportunity/meeting stores, which freeze a scoped storage key at module
// load. Opt into demo BEFORE those modules import (vi.hoisted runs above imports), matching the store tests.
vi.hoisted(() => {
  (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__ = true;
});

import { SPECS, parseMoney, matchOpportunity } from "./actionSpecs";
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
