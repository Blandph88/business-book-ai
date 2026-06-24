import { describe, it, expect } from "vitest";
import {
  weightedValue,
  serviceLineForFunction,
  opportunityPhase,
  LOST_PHASE,
  pipelineByPhase,
  opportunitiesForPhase,
  UNASSIGNED_GROUP,
  opportunityContact,
  opportunitiesBySectorGroup,
  opportunitiesByFunction,
  opportunitiesByServiceLine,
  opportunityStatus,
  openWeightedPipeline,
  opportunityIdForMeeting,
  meetingContext,
  buildOpportunityFromMeeting,
  applyPlannedSteps,
} from "./opportunities";
import type { Opportunity } from "../storage/opportunities";
import type { Meeting } from "../storage/meetings";
import type { Contact } from "./contacts";
import type { ContactInfo } from "./meetings";
import { OPPORTUNITY_PHASES, SERVICE_LINE, OTHER_FUNCTIONS } from "./vocab";
import { planStepDates } from "./timeline";

// ── Fixtures ──────────────────────────────────────────────────────────────────
function opp(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "o1",
    opportunity_name: "Acme deal",
    organisation: "Acme",
    primary_contact: "Jane Doe",
    service_line: "Strategy",
    current_step: "meeting",
    ...over,
  };
}

function contact(over: Partial<Contact> = {}): Contact {
  return {
    first: "Jane",
    last: "Doe",
    organisation: "Acme",
    position: "Manager",
    sector_detail: "Acme Ltd",
    sector_group: "Technology",
    sub_group: "Technology",
    seniority: "Manager",
    function: "Technology & Engineering",
    messaged: false,
    responded: false,
    two_way: false,
    agreed_to_meet: false,
    met: false,
    url: "u1",
    phone: "",
    ...over,
  };
}

// ── weightedValue ─────────────────────────────────────────────────────────────
describe("weightedValue", () => {
  it("is est_value × probability", () => {
    expect(weightedValue(opp({ est_value: 100000, probability: 0.25 }))).toBe(25000);
  });

  it("treats a missing number as 0 (no NaN)", () => {
    expect(weightedValue(opp({ est_value: 100000 }))).toBe(0);
    expect(weightedValue(opp({ probability: 0.5 }))).toBe(0);
    expect(weightedValue(opp())).toBe(0);
  });
});

// ── serviceLineForFunction ────────────────────────────────────────────────────
describe("serviceLineForFunction", () => {
  it("maps known functions to a service line", () => {
    expect(serviceLineForFunction("Risk & Audit")).toBe("Risk & Compliance");
    expect(serviceLineForFunction("Finance & Accounting")).toBe("Finance & Deals");
    expect(serviceLineForFunction("Human Resources")).toBe("People & Change");
    expect(serviceLineForFunction(OTHER_FUNCTIONS)).toBe("Other");
  });

  it("returns undefined for an unmapped or missing function", () => {
    expect(serviceLineForFunction("Made Up Function")).toBeUndefined();
    expect(serviceLineForFunction(undefined)).toBeUndefined();
    expect(serviceLineForFunction("")).toBeUndefined();
  });
});

// ── opportunityPhase ──────────────────────────────────────────────────────────
describe("opportunityPhase", () => {
  it("rolls up to the current step's phase", () => {
    expect(opportunityPhase(opp({ current_step: "meeting" }))).toBe("Identify");
    expect(opportunityPhase(opp({ current_step: "scoping" }))).toBe("Scope & Clear");
    expect(opportunityPhase(opp({ current_step: "contracting" }))).toBe("Contract");
    expect(opportunityPhase(opp({ current_step: "delivery" }))).toBe("Deliver");
  });

  it("returns Lost when the deal is lost, overriding the step", () => {
    expect(opportunityPhase(opp({ current_step: "delivery", lost: true }))).toBe(
      LOST_PHASE,
    );
    expect(LOST_PHASE).toBe("Lost");
  });

  it("falls back to the first phase for an unknown step", () => {
    expect(
      opportunityPhase(opp({ current_step: "bogus" as Opportunity["current_step"] })),
    ).toBe(OPPORTUNITY_PHASES[0]);
  });
});

// ── pipelineByPhase ───────────────────────────────────────────────────────────
describe("pipelineByPhase", () => {
  it("iterates the fixed phases + Lost, summing to the total", () => {
    const opps = [
      opp({ current_step: "meeting" }),
      opp({ current_step: "scoping" }),
      opp({ current_step: "scoping" }),
      opp({ current_step: "meeting", lost: true }),
    ];
    const bd = pipelineByPhase(opps);
    expect(bd.items).toHaveLength(OPPORTUNITY_PHASES.length + 1);
    expect(bd.total).toBe(4);
    expect(bd.sumsToTotal).toBe(true);
    const byLabel = Object.fromEntries(bd.items.map((i) => [i.label, i.count]));
    expect(byLabel["Identify"]).toBe(1);
    expect(byLabel["Scope & Clear"]).toBe(2);
    expect(byLabel["Lost"]).toBe(1);
  });

  it("shows 0 bars and still sums for an empty pipeline", () => {
    const bd = pipelineByPhase([]);
    expect(bd.total).toBe(0);
    expect(bd.sumsToTotal).toBe(true);
    expect(bd.items.every((i) => i.count === 0)).toBe(true);
  });
});

// ── opportunitiesForPhase ─────────────────────────────────────────────────────
describe("opportunitiesForPhase", () => {
  it("returns exactly the opps a phase bar counts", () => {
    const a = opp({ id: "a", current_step: "meeting" });
    const b = opp({ id: "b", current_step: "scoping" });
    const c = opp({ id: "c", current_step: "meeting", lost: true });
    const all = [a, b, c];
    expect(opportunitiesForPhase(all, "Identify")).toEqual([a]);
    expect(opportunitiesForPhase(all, "Lost")).toEqual([c]);
    expect(opportunitiesForPhase(all, "Deliver")).toEqual([]);
  });
});

// ── opportunityContact ────────────────────────────────────────────────────────
describe("opportunityContact", () => {
  const c = contact({ url: "u1" });
  const byUrl = new Map([["u1", c]]);

  it("uses the explicit contact_url first", () => {
    expect(opportunityContact(opp({ contact_url: "u1" }), byUrl, {})).toBe(c);
  });

  it("follows source_meeting_id → meeting.contact_url when no direct link", () => {
    const meetings = {
      m1: { id: "m1", contact_url: "u1", meeting_no: 1, meeting_stage: "Held" } as Meeting,
    };
    expect(
      opportunityContact(opp({ source_meeting_id: "m1" }), byUrl, meetings),
    ).toBe(c);
  });

  it("returns null when there is no link", () => {
    expect(opportunityContact(opp(), byUrl, {})).toBeNull();
  });

  it("returns null when the linked contact is not in the CSV", () => {
    expect(opportunityContact(opp({ contact_url: "gone" }), byUrl, {})).toBeNull();
  });
});

// ── opportunitiesBySectorGroup ────────────────────────────────────────────────
describe("opportunitiesBySectorGroup", () => {
  it("groups by the opp's own sector group, summing weighted value", () => {
    const opps = [
      opp({ id: "a", sector_group: "Technology", est_value: 100, probability: 0.5 }),
      opp({ id: "b", sector_group: "Technology", est_value: 200, probability: 0.5 }),
    ];
    const bd = opportunitiesBySectorGroup(opps, [], {});
    const tech = bd.items.find((i) => i.label === "Technology")!;
    expect(tech.count).toBe(2);
    expect(tech.weighted).toBe(150); // 50 + 100
    expect(bd.total).toBe(2);
    expect(bd.weightedTotal).toBe(150);
    expect(bd.sumsToTotal).toBe(true);
    expect(bd.items[bd.items.length - 1].label).toBe(UNASSIGNED_GROUP);
  });

  it("falls back to the linked contact's sector group", () => {
    const c = contact({ url: "u1", sector_group: "Financial Services" });
    const opps = [opp({ contact_url: "u1" })];
    const bd = opportunitiesBySectorGroup(opps, [c], {});
    expect(bd.items.find((i) => i.label === "Financial Services")!.count).toBe(1);
  });

  it("buckets opps with no resolvable contact into Unassigned (last)", () => {
    const bd = opportunitiesBySectorGroup([opp()], [], {});
    expect(bd.items.find((i) => i.label === UNASSIGNED_GROUP)!.count).toBe(1);
  });
});

// ── opportunitiesByFunction ───────────────────────────────────────────────────
describe("opportunitiesByFunction", () => {
  it("orders real functions by count desc, Other Functions then Unassigned last", () => {
    const opps = [
      opp({ id: "a", function: "Finance & Accounting" }),
      opp({ id: "b", function: "Finance & Accounting" }),
      opp({ id: "c", function: "Legal & Compliance" }),
      opp({ id: "d", function: OTHER_FUNCTIONS }),
      opp({ id: "e" }), // no function, no contact → Unassigned
    ];
    const bd = opportunitiesByFunction(opps, [], {});
    const labels = bd.items.map((i) => i.label);
    expect(labels[0]).toBe("Finance & Accounting"); // busiest real fn leads
    expect(labels[labels.length - 1]).toBe(UNASSIGNED_GROUP);
    expect(labels[labels.length - 2]).toBe(OTHER_FUNCTIONS);
    expect(bd.sumsToTotal).toBe(true);
    expect(bd.total).toBe(5);
  });

  it("falls back to the contact's function, empty → Other Functions", () => {
    const c1 = contact({ url: "u1", function: "Data & Analytics" });
    const c2 = contact({ url: "u2", function: "" });
    const opps = [opp({ contact_url: "u1" }), opp({ id: "o2", contact_url: "u2" })];
    const bd = opportunitiesByFunction(opps, [c1, c2], {});
    expect(bd.items.find((i) => i.label === "Data & Analytics")!.count).toBe(1);
    expect(bd.items.find((i) => i.label === OTHER_FUNCTIONS)!.count).toBe(1);
  });
});

// ── opportunitiesByServiceLine ────────────────────────────────────────────────
describe("opportunitiesByServiceLine", () => {
  it("iterates the fixed SERVICE_LINE vocab with 0 bars and sums to total", () => {
    const opps = [
      opp({ id: "a", service_line: "Strategy" }),
      opp({ id: "b", service_line: "Technology", est_value: 10, probability: 1 }),
    ];
    const bd = opportunitiesByServiceLine(opps);
    expect(bd.items).toHaveLength(SERVICE_LINE.length);
    expect(bd.items.find((i) => i.label === "Strategy")!.count).toBe(1);
    expect(bd.items.find((i) => i.label === "Technology")!.weighted).toBe(10);
    expect(bd.items.find((i) => i.label === "Other")!.count).toBe(0);
    expect(bd.total).toBe(2);
    expect(bd.weightedTotal).toBe(10);
    expect(bd.sumsToTotal).toBe(true);
  });
});

// ── opportunityStatus ─────────────────────────────────────────────────────────
describe("opportunityStatus", () => {
  it("is Lost when the lost flag is set, even past the won step", () => {
    expect(opportunityStatus(opp({ current_step: "delivery", lost: true }))).toBe(
      "Lost",
    );
  });

  it("is Won at the won step (contracting) or beyond", () => {
    expect(opportunityStatus(opp({ current_step: "contracting" }))).toBe("Won");
    expect(opportunityStatus(opp({ current_step: "revenue" }))).toBe("Won");
  });

  it("is Open before the won step", () => {
    expect(opportunityStatus(opp({ current_step: "meeting" }))).toBe("Open");
    expect(opportunityStatus(opp({ current_step: "procurement" }))).toBe("Open");
  });
});

// ── openWeightedPipeline ──────────────────────────────────────────────────────
describe("openWeightedPipeline", () => {
  it("sums weighted value of OPEN opps only (excludes Won and Lost)", () => {
    const opps = [
      opp({ id: "open", current_step: "scoping", est_value: 100, probability: 0.5 }),
      opp({ id: "won", current_step: "contracting", est_value: 999, probability: 1 }),
      opp({ id: "lost", current_step: "meeting", lost: true, est_value: 999, probability: 1 }),
    ];
    expect(openWeightedPipeline(opps)).toBe(50);
  });

  it("is 0 for an empty pipeline", () => {
    expect(openWeightedPipeline([])).toBe(0);
  });
});

// ── opportunityIdForMeeting ───────────────────────────────────────────────────
describe("opportunityIdForMeeting", () => {
  it("is the deterministic `opp:meeting:<id>` form", () => {
    expect(opportunityIdForMeeting("https://li/jane#1")).toBe(
      "opp:meeting:https://li/jane#1",
    );
  });
});

// ── meetingContext ────────────────────────────────────────────────────────────
describe("meetingContext", () => {
  it("composes notes + labelled pain points + org insights", () => {
    expect(
      meetingContext({
        notes: "Good chat",
        pain_points: "High costs",
        org_insights: "Expanding",
      }),
    ).toBe("Good chat\n\nPain points: High costs\n\nOrg insights: Expanding");
  });

  it("omits blank/whitespace sections", () => {
    expect(meetingContext({ notes: "Only notes", pain_points: "  " })).toBe(
      "Only notes",
    );
  });

  it("is empty when nothing is present", () => {
    expect(meetingContext({})).toBe("");
  });
});

// ── buildOpportunityFromMeeting ───────────────────────────────────────────────
describe("buildOpportunityFromMeeting", () => {
  const info: ContactInfo = {
    name: "Jane Doe",
    organisation: "Acme",
    seniority: "Manager",
    function: "Technology & Engineering",
    sector_group: "Technology",
    phone: "",
  };

  it("pre-fills from the meeting + contact with a deterministic id at the first step", () => {
    const m: Meeting = {
      id: "https://li/jane#1",
      contact_url: "https://li/jane",
      meeting_no: 1,
      meeting_stage: "Held",
      date_held: "2026-06-01",
      notes: "Good chat",
    };
    const o = buildOpportunityFromMeeting(m, info);
    expect(o.id).toBe("opp:meeting:https://li/jane#1");
    expect(o.opportunity_name).toBe("Acme — Jane Doe");
    expect(o.organisation).toBe("Acme");
    expect(o.primary_contact).toBe("Jane Doe");
    expect(o.service_line).toBe("Strategy");
    expect(o.current_step).toBe("meeting");
    expect(o.function).toBe("Technology & Engineering");
    expect(o.sector_group).toBe("Technology");
    expect(o.description).toBe("Good chat");
    expect(o.source_meeting_id).toBe("https://li/jane#1");
    expect(o.contact_url).toBe("https://li/jane");
  });

  it("anchors the planned timeline to the held date", () => {
    const m: Meeting = {
      id: "m1",
      contact_url: "u1",
      meeting_no: 1,
      meeting_stage: "Held",
      date_held: "2026-06-01",
    };
    const o = buildOpportunityFromMeeting(m, info);
    expect(o.step_dates).toEqual(planStepDates("2026-06-01"));
    expect(o.step_dates!.meeting).toBe("2026-06-01");
  });

  it("leaves description undefined when the meeting has no context", () => {
    const m: Meeting = {
      id: "m1",
      contact_url: "u1",
      meeting_no: 1,
      meeting_stage: "Held",
    };
    const o = buildOpportunityFromMeeting(m, info);
    expect(o.description).toBeUndefined();
    expect(o.step_dates).toBeUndefined(); // no anchor → no planning
  });
});

// ── applyPlannedSteps ─────────────────────────────────────────────────────────
describe("applyPlannedSteps", () => {
  it("fills the standard schedule and meeting date, defaulting current_step", () => {
    const o = opp({ current_step: undefined as unknown as Opportunity["current_step"] });
    applyPlannedSteps(o, "2026-06-01");
    expect(o.current_step).toBe("meeting");
    expect(o.step_dates).toEqual(planStepDates("2026-06-01"));
    expect(o.step_dates!.meeting).toBe("2026-06-01");
  });

  it("preserves existing step dates (they win over the plan)", () => {
    const o = opp({ step_dates: { scoping: "2025-01-01" } });
    applyPlannedSteps(o, "2026-06-01");
    expect(o.step_dates!.scoping).toBe("2025-01-01");
    expect(o.step_dates!.contracting).toBe(planStepDates("2026-06-01").contracting);
  });

  it("mutates and returns the same object", () => {
    const o = opp();
    expect(applyPlannedSteps(o, "2026-06-01")).toBe(o);
  });
});
