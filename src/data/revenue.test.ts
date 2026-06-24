import { describe, it, expect } from "vitest";
import {
  contractedRevenue,
  pctRecognised,
  totalContractedRevenue,
  totalRecognised,
  myBook,
  sowFromOpportunity,
  sowForOpportunity,
} from "./revenue";
import type { Sow } from "../storage/revenue";
import type { Opportunity } from "../storage/opportunities";

// ── Fixtures ──────────────────────────────────────────────────────────────────
function sow(over: Partial<Sow> = {}): Sow {
  return {
    id: "s1",
    organisation: "Acme",
    engagement_name: "Acme engagement",
    service_line: "Strategy",
    status: "Active",
    ...over,
  };
}

function opp(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "o1",
    opportunity_name: "Acme deal",
    organisation: "Acme",
    primary_contact: "Jane Doe",
    service_line: "Finance & Deals",
    current_step: "contracting",
    ...over,
  };
}

// ── contractedRevenue ─────────────────────────────────────────────────────────
describe("contractedRevenue", () => {
  it("is chargeable_hours / 8 × day_rate", () => {
    // 80 hours = 10 days × 1000/day = 10000
    expect(contractedRevenue(sow({ chargeable_hours: 80, day_rate: 1000 }))).toBe(
      10000,
    );
  });

  it("treats a missing number as 0", () => {
    expect(contractedRevenue(sow({ day_rate: 1000 }))).toBe(0);
    expect(contractedRevenue(sow({ chargeable_hours: 80 }))).toBe(0);
    expect(contractedRevenue(sow())).toBe(0);
  });

  it("handles fractional days", () => {
    // 4 hours = 0.5 days × 1000 = 500
    expect(contractedRevenue(sow({ chargeable_hours: 4, day_rate: 1000 }))).toBe(500);
  });

  it("uses the legacy day-rate path only when project_type is unset", () => {
    expect(contractedRevenue(sow({ chargeable_hours: 80, day_rate: 1000 }))).toBe(10000);
  });
});

describe("contractedRevenue — Fixed price", () => {
  it("sums the deliverable prices (a missing price counts as 0)", () => {
    const s = sow({
      project_type: "Fixed price",
      deliverables: [
        { id: "a", name: "Assessment", category: "Diagnostic & Assessment", price: 40000 },
        { id: "b", name: "Roadmap", category: "Strategy & Roadmap", price: 60000 },
        { id: "c", name: "TBD", category: "Other" },
      ],
    });
    expect(contractedRevenue(s)).toBe(100000);
  });

  it("is 0 with no deliverables", () => {
    expect(contractedRevenue(sow({ project_type: "Fixed price" }))).toBe(0);
    expect(contractedRevenue(sow({ project_type: "Fixed price", deliverables: [] }))).toBe(0);
  });

  it("ignores the legacy day_rate fields once priced Fixed price", () => {
    const s = sow({
      project_type: "Fixed price",
      deliverables: [{ id: "a", name: "x", category: "Other", price: 5000 }],
      chargeable_hours: 80,
      day_rate: 1000,
    });
    expect(contractedRevenue(s)).toBe(5000); // not the legacy 10000
  });
});

describe("contractedRevenue — Time & materials", () => {
  it("sums rate per hour × hours across the rate card", () => {
    const s = sow({
      project_type: "Time & materials",
      rate_card: [
        { grade: "Associate", rate_per_hour: 200, hours: 100 }, // 20000
        { grade: "Manager", rate_per_hour: 350, hours: 40 }, // 14000
        { grade: "Partner", rate_per_hour: 600 }, // no hours → 0
      ],
    });
    expect(contractedRevenue(s)).toBe(34000);
  });

  it("is 0 with no rate card", () => {
    expect(contractedRevenue(sow({ project_type: "Time & materials" }))).toBe(0);
    expect(contractedRevenue(sow({ project_type: "Time & materials", rate_card: [] }))).toBe(0);
  });
});

// ── pctRecognised ─────────────────────────────────────────────────────────────
describe("pctRecognised", () => {
  it("is recognised / contracted × 100", () => {
    const s = sow({ chargeable_hours: 80, day_rate: 1000, recognised_to_date: 2500 });
    expect(pctRecognised(s)).toBe(25); // 2500 / 10000 × 100
  });

  it("is 0 (guarded) when the SoW is unpriced", () => {
    expect(pctRecognised(sow({ recognised_to_date: 500 }))).toBe(0);
  });

  it("is 0 when nothing recognised yet", () => {
    expect(pctRecognised(sow({ chargeable_hours: 80, day_rate: 1000 }))).toBe(0);
  });

  it("can exceed 100 if over-recognised", () => {
    const s = sow({ chargeable_hours: 8, day_rate: 1000, recognised_to_date: 2000 });
    expect(pctRecognised(s)).toBe(200);
  });
});

// ── totalContractedRevenue ────────────────────────────────────────────────────
describe("totalContractedRevenue", () => {
  it("sums contracted revenue across SoWs", () => {
    const sows = [
      sow({ chargeable_hours: 80, day_rate: 1000 }), // 10000
      sow({ chargeable_hours: 8, day_rate: 2000 }), // 2000
      sow(), // 0
    ];
    expect(totalContractedRevenue(sows)).toBe(12000);
  });

  it("is 0 for no SoWs", () => {
    expect(totalContractedRevenue([])).toBe(0);
  });
});

// ── totalRecognised ───────────────────────────────────────────────────────────
describe("totalRecognised", () => {
  it("sums recognised_to_date across SoWs, treating missing as 0", () => {
    const sows = [
      sow({ recognised_to_date: 1000 }),
      sow({ recognised_to_date: 500 }),
      sow(),
    ];
    expect(totalRecognised(sows)).toBe(1500);
  });

  it("is 0 for no SoWs", () => {
    expect(totalRecognised([])).toBe(0);
  });
});

// ── myBook ────────────────────────────────────────────────────────────────────
describe("myBook", () => {
  it("counts recognised revenue only on self/co-originated linked opps", () => {
    const oppsById: Record<string, Opportunity> = {
      self: opp({ id: "self", origination_credit: "Self-originated" }),
      co: opp({ id: "co", origination_credit: "Co-originated" }),
      ref: opp({ id: "ref", origination_credit: "Referral" }),
    };
    const sows = [
      sow({ id: "a", linked_opportunity_id: "self", recognised_to_date: 1000 }),
      sow({ id: "b", linked_opportunity_id: "co", recognised_to_date: 2000 }),
      sow({ id: "c", linked_opportunity_id: "ref", recognised_to_date: 9999 }), // excluded
      sow({ id: "d", recognised_to_date: 9999 }), // no link → excluded
    ];
    expect(myBook(sows, oppsById)).toBe(3000);
  });

  it("excludes a SoW whose opp has no origination credit", () => {
    const oppsById = { o1: opp({ id: "o1" }) };
    const sows = [sow({ linked_opportunity_id: "o1", recognised_to_date: 500 })];
    expect(myBook(sows, oppsById)).toBe(0);
  });

  it("excludes a SoW linked to an opp that does not exist", () => {
    const sows = [sow({ linked_opportunity_id: "gone", recognised_to_date: 500 })];
    expect(myBook(sows, {})).toBe(0);
  });

  it("is 0 for no SoWs", () => {
    expect(myBook([], {})).toBe(0);
  });
});

// ── sowFromOpportunity ────────────────────────────────────────────────────────
describe("sowFromOpportunity", () => {
  it("pre-fills org / name / service line / signed date / link", () => {
    const o = opp({
      id: "o1",
      organisation: "Acme",
      opportunity_name: "Acme transformation",
      service_line: "Technology",
      step_dates: { contracting: "2026-05-01" },
    });
    const s = sowFromOpportunity(o);
    expect(s.id).toBe(""); // assigned on save
    expect(s.linked_opportunity_id).toBe("o1");
    expect(s.organisation).toBe("Acme");
    expect(s.engagement_name).toBe("Acme transformation");
    expect(s.signed_date).toBe("2026-05-01");
    expect(s.service_line).toBe("Technology");
    expect(s.status).toBe("Active");
  });

  it("falls back the engagement name to '<org> engagement' when name is blank", () => {
    const s = sowFromOpportunity(opp({ opportunity_name: "", organisation: "Acme" }));
    expect(s.engagement_name).toBe("Acme engagement");
  });

  it("leaves signed_date undefined when there is no contracting date", () => {
    const s = sowFromOpportunity(opp({ step_dates: undefined }));
    expect(s.signed_date).toBeUndefined();
  });
});

// ── sowForOpportunity ─────────────────────────────────────────────────────────
describe("sowForOpportunity", () => {
  it("finds the first SoW linked to the opportunity", () => {
    const sows = [
      sow({ id: "a", linked_opportunity_id: "other" }),
      sow({ id: "b", linked_opportunity_id: "o1" }),
      sow({ id: "c", linked_opportunity_id: "o1" }),
    ];
    expect(sowForOpportunity("o1", sows)!.id).toBe("b");
  });

  it("returns undefined when none is linked", () => {
    expect(sowForOpportunity("o1", [sow({ linked_opportunity_id: "x" })])).toBeUndefined();
    expect(sowForOpportunity("o1", [])).toBeUndefined();
  });
});
