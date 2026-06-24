import { describe, it, expect, vi, afterEach } from "vitest";
import {
  staleContacts,
  winLossStats,
  agingOpportunities,
  hotOpportunities,
  keyContacts,
  phaseReachedFunnel,
  looseEnds,
  activityStats,
} from "./dashboard";
import type { Contact } from "./contacts";
import type { MeetingRow, ContactInfo } from "./meetings";
import type { Opportunity } from "../storage/opportunities";
import type { OwnerEdits } from "../storage/ownerEdits";
import type { Sow } from "../storage/revenue";
import { OPPORTUNITY_PHASES } from "./vocab";

afterEach(() => {
  vi.useRealTimers();
});

const TODAY = "2026-06-24";

// ── Fixture builders ─────────────────────────────────────────────────────────
function contact(over: Partial<Contact> = {}): Contact {
  return {
    first: "Jane",
    last: "Doe",
    organisation: "Acme",
    position: "Manager",
    sector_detail: "",
    sector_group: "Financial Services",
    sub_group: "Financial Services",
    seniority: "Manager",
    function: "Finance & Accounting",
    messaged: false,
    responded: false,
    two_way: false,
    agreed_to_meet: false,
    met: false,
    url: "https://linkedin.com/in/jane",
    phone: "",
    ...over,
  };
}

function opp(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "o1",
    opportunity_name: "Acme Deal",
    organisation: "Acme",
    primary_contact: "Jane Doe",
    service_line: "Strategy",
    current_step: "meeting",
    ...over,
  };
}

function sow(over: Partial<Sow> = {}): Sow {
  return {
    id: "s1",
    organisation: "Acme",
    engagement_name: "Transformation",
    service_line: "Strategy",
    status: "Active",
    ...over,
  };
}

const contactInfo = (over: Partial<ContactInfo> = {}): ContactInfo => ({
  name: "Jane Doe",
  organisation: "Acme",
  seniority: "Manager",
  function: "Finance & Accounting",
  sector_group: "Financial Services",
  phone: "",
  ...over,
});

function meetingRow(over: Partial<MeetingRow> = {}): MeetingRow {
  return {
    id: "m1",
    contact_url: "https://linkedin.com/in/jane",
    meeting_no: 1,
    meeting_stage: "Held",
    contactInfo: contactInfo(),
    isSeed: false,
    ...over,
  };
}

// ── staleContacts ─────────────────────────────────────────────────────────────
describe("staleContacts", () => {
  it("includes warm contacts never met (daysSince null) and sorts them first", () => {
    const c1 = contact({ url: "https://linkedin.com/in/warm1" });
    const c2 = contact({ url: "https://linkedin.com/in/warm2" });
    const edits: Record<string, OwnerEdits> = {
      "https://linkedin.com/in/warm1": { relationship_strength: "Warm" },
      "https://linkedin.com/in/warm2": { relationship_strength: "Strong" },
    };
    // c2 met 60 days ago; c1 never met.
    const lastMet = { "https://linkedin.com/in/warm2": "2026-04-25" };
    const out = staleContacts([c1, c2], edits, lastMet, TODAY);
    expect(out).toHaveLength(2);
    // "never met" (null) sorts to the very top.
    expect(out[0].contact.url).toBe("https://linkedin.com/in/warm1");
    expect(out[0].daysSince).toBeNull();
    expect(out[1].daysSince).toBe(60);
  });

  it("excludes Cold contacts (not worth maintaining)", () => {
    const c = contact({ url: "https://linkedin.com/in/cold" });
    const edits = {
      "https://linkedin.com/in/cold": { relationship_strength: "Cold" as const },
    };
    expect(staleContacts([c], edits, {}, TODAY)).toHaveLength(0);
  });

  it("excludes warm contacts met recently (within the threshold)", () => {
    const c = contact({ url: "https://linkedin.com/in/recent" });
    const edits = {
      "https://linkedin.com/in/recent": {
        relationship_strength: "Champion" as const,
      },
    };
    // met 10 days ago, threshold default 45 → not stale.
    const out = staleContacts(c ? [c] : [], edits, { "https://linkedin.com/in/recent": "2026-06-14" }, TODAY);
    expect(out).toHaveLength(0);
  });

  it("includes a warm contact past a custom threshold", () => {
    const c = contact({ url: "https://linkedin.com/in/x" });
    const edits = {
      "https://linkedin.com/in/x": { relationship_strength: "Warm" as const },
    };
    // met 20 days ago, custom threshold 14 → stale.
    const out = staleContacts([c], edits, { "https://linkedin.com/in/x": "2026-06-04" }, TODAY, 14);
    expect(out).toHaveLength(1);
    expect(out[0].daysSince).toBe(20);
  });

  it("returns an empty list for empty inputs", () => {
    expect(staleContacts([], {}, {}, TODAY)).toEqual([]);
  });
});

// ── winLossStats ──────────────────────────────────────────────────────────────
describe("winLossStats", () => {
  it("counts won (>= contracting) and lost, and computes the win rate over decided deals", () => {
    const opps = [
      opp({ id: "w1", current_step: "contracting" }), // Won
      opp({ id: "w2", current_step: "revenue" }), // Won (beyond signature)
      opp({ id: "l1", current_step: "meeting", lost: true }), // Lost
      opp({ id: "open1", current_step: "scoping" }), // Open — excluded
    ];
    const r = winLossStats(opps);
    expect(r.won).toBe(2);
    expect(r.lost).toBe(1);
    expect(r.winRate).toBeCloseTo(2 / 3);
  });

  it("returns winRate null when nothing is decided (divide-by-zero guard)", () => {
    const opps = [opp({ current_step: "scoping" }), opp({ id: "o2", current_step: "meeting" })];
    const r = winLossStats(opps);
    expect(r).toEqual({ won: 0, lost: 0, winRate: null });
  });

  it("treats a lost deal as Lost even past the signature step", () => {
    const r = winLossStats([opp({ current_step: "revenue", lost: true })]);
    expect(r.won).toBe(0);
    expect(r.lost).toBe(1);
  });

  it("handles empty input", () => {
    expect(winLossStats([])).toEqual({ won: 0, lost: 0, winRate: null });
  });
});

// ── agingOpportunities ────────────────────────────────────────────────────────
describe("agingOpportunities", () => {
  it("flags OPEN opps whose latest milestone is >= the threshold, most stale first", () => {
    const stale = opp({
      id: "stale",
      current_step: "scoping",
      step_dates: { meeting: "2026-01-01", scoping: "2026-05-01" }, // latest 2026-05-01 → 54 days
    });
    const fresher = opp({
      id: "fresher",
      current_step: "scoping",
      step_dates: { scoping: "2026-05-20" }, // 35 days
    });
    const recent = opp({
      id: "recent",
      current_step: "scoping",
      step_dates: { scoping: "2026-06-20" }, // 4 days → not aging
    });
    const out = agingOpportunities([recent, fresher, stale], TODAY);
    expect(out.map((a) => a.opp.id)).toEqual(["stale", "fresher"]);
    expect(out[0].daysSince).toBe(54);
    expect(out[1].daysSince).toBe(35);
  });

  it("skips opportunities with no step dates at all", () => {
    const o = opp({ current_step: "scoping", step_dates: {} });
    expect(agingOpportunities([o], TODAY)).toHaveLength(0);
  });

  it("ignores won and lost opportunities (only open ones can be 'stale')", () => {
    const won = opp({ id: "won", current_step: "contracting", step_dates: { contracting: "2026-01-01" } });
    const lost = opp({ id: "lost", current_step: "scoping", lost: true, step_dates: { scoping: "2026-01-01" } });
    expect(agingOpportunities([won, lost], TODAY)).toHaveLength(0);
  });

  it("handles empty input", () => {
    expect(agingOpportunities([], TODAY)).toEqual([]);
  });
});

// ── hotOpportunities ──────────────────────────────────────────────────────────
describe("hotOpportunities", () => {
  it("ranks open opps by est_value × proximity-to-signature", () => {
    // proximity = stepIndex / stepIndex(contracting=8).
    // proposal_delivery idx 6 → 0.75; pursuit idx 2 → 0.25.
    const big = opp({
      id: "big",
      current_step: "proposal_delivery",
      est_value: 100000,
      step_dates: { contracting: "2026-09-01" },
    }); // 100000 * 0.75 = 75000
    const early = opp({
      id: "early",
      current_step: "pursuit",
      est_value: 200000,
    }); // 200000 * 0.25 = 50000
    const out = hotOpportunities([early, big]);
    expect(out.map((h) => h.opp.id)).toEqual(["big", "early"]);
    expect(out[0].score).toBeCloseTo(75000);
    expect(out[0].signBy).toBe("2026-09-01");
    expect(out[1].score).toBeCloseTo(50000);
  });

  it("excludes zero-score opps (no value, or proximity 0 at the first step)", () => {
    const noValue = opp({ id: "nv", current_step: "scoping", est_value: 0 });
    const atMeeting = opp({ id: "m0", current_step: "meeting", est_value: 100000 }); // proximity 0
    expect(hotOpportunities([noValue, atMeeting])).toHaveLength(0);
  });

  it("excludes won and lost opps (open pipeline only)", () => {
    const won = opp({ id: "w", current_step: "contracting", est_value: 100000 });
    const lost = opp({ id: "l", current_step: "scoping", est_value: 100000, lost: true });
    expect(hotOpportunities([won, lost])).toHaveLength(0);
  });

  it("respects the limit", () => {
    const opps = Array.from({ length: 8 }, (_, i) =>
      opp({ id: `o${i}`, current_step: "scoping", est_value: 1000 * (i + 1) }),
    );
    expect(hotOpportunities(opps, 3)).toHaveLength(3);
  });

  it("handles empty input", () => {
    expect(hotOpportunities([])).toEqual([]);
  });
});

// ── keyContacts ───────────────────────────────────────────────────────────────
describe("keyContacts", () => {
  it("ranks a senior decision-maker above a junior unknown", () => {
    const exec = contact({ url: "https://linkedin.com/in/exec", seniority: "Executive Leadership" });
    const junior = contact({ url: "https://linkedin.com/in/jr", seniority: "Associate / Analyst" });
    const edits: Record<string, OwnerEdits> = {
      "https://linkedin.com/in/exec": { decision_role: "Decision Maker" },
    };
    const out = keyContacts([junior, exec], edits, []);
    expect(out[0].contact.url).toBe("https://linkedin.com/in/exec");
    expect(out[0].reason).toContain("Executive Leadership");
    expect(out[0].reason).toContain("Decision Maker");
  });

  it("boosts a contact attached to a live opportunity and labels the deal stage", () => {
    const c = contact({ url: "https://linkedin.com/in/deal", seniority: "Manager" });
    const noDeal = contact({ url: "https://linkedin.com/in/nodeal", seniority: "Manager" });
    const o = opp({
      id: "live",
      current_step: "proposal_delivery",
      contact_url: "https://linkedin.com/in/deal",
    });
    const out = keyContacts([c, noDeal], {}, [o]);
    expect(out[0].contact.url).toBe("https://linkedin.com/in/deal");
    expect(out[0].reason).toContain("deal");
  });

  it("drops contacts with a zero score and honours the limit", () => {
    // seniority unknown → SENIORITY_RANK undefined → 0 → score 0 → filtered out.
    const blank = contact({ url: "https://linkedin.com/in/blank", seniority: "" });
    expect(keyContacts([blank], {}, [])).toHaveLength(0);
  });

  it("handles empty input", () => {
    expect(keyContacts([], {}, [])).toEqual([]);
  });
});

// ── phaseReachedFunnel ────────────────────────────────────────────────────────
describe("phaseReachedFunnel", () => {
  it("counts opps that reached each phase (cumulative, descending bars)", () => {
    // meeting (Identify), scoping (Scope & Clear), contracting (Contract).
    const opps = [
      opp({ id: "a", current_step: "meeting" }),
      opp({ id: "b", current_step: "scoping" }),
      opp({ id: "c", current_step: "contracting" }),
    ];
    const { items, total } = phaseReachedFunnel(opps);
    expect(total).toBe(3);
    const byPhase = Object.fromEntries(items.map((i) => [i.phase, i.reached]));
    // All three reached Identify (the first phase).
    expect(byPhase["Identify"]).toBe(3);
    // Scoping + contracting reached "Scope & Clear".
    expect(byPhase["Scope & Clear"]).toBe(2);
    // Only contracting reached "Contract".
    expect(byPhase["Contract"]).toBe(1);
    // Nothing reached the final Deliver phase.
    expect(byPhase["Deliver"]).toBe(0);
    expect(items[0].pct).toBeCloseTo(1);
  });

  it("guards divide-by-zero with no opps (pct 0, all reached 0)", () => {
    const { items, total } = phaseReachedFunnel([]);
    expect(total).toBe(0);
    expect(items).toHaveLength(OPPORTUNITY_PHASES.length);
    for (const i of items) {
      expect(i.reached).toBe(0);
      expect(i.pct).toBe(0);
    }
  });
});

// ── looseEnds ─────────────────────────────────────────────────────────────────
describe("looseEnds", () => {
  it("flags a won deal with no linked SoW", () => {
    const won = opp({ id: "won1", current_step: "contracting", opportunity_name: "Big Win" });
    const groups = looseEnds([won], [], {}, []);
    const wonGroup = groups.find((g) => g.key === "wonNoSow");
    expect(wonGroup).toBeDefined();
    expect(wonGroup!.items[0].label).toBe("Big Win");
    expect(wonGroup!.items[0].tab).toBe("opportunities");
  });

  it("does not flag a won deal that already has a linked SoW", () => {
    const won = opp({ id: "won1", current_step: "contracting" });
    const linked = sow({ id: "s1", linked_opportunity_id: "won1" });
    const groups = looseEnds([won], [], {}, [linked]);
    expect(groups.find((g) => g.key === "wonNoSow")).toBeUndefined();
  });

  it("flags an open deal with no estimated value", () => {
    const open = opp({ id: "open1", current_step: "scoping", est_value: undefined });
    const groups = looseEnds([open], [], {}, []);
    expect(groups.find((g) => g.key === "openNoValue")).toBeDefined();
  });

  it("flags an open deal whose contact has no decision role, deduped by contact", () => {
    const c = contact({ url: "https://linkedin.com/in/jane", first: "Jane", last: "Doe" });
    const o1 = opp({ id: "o1", current_step: "scoping", est_value: 1, contact_url: c.url });
    const o2 = opp({ id: "o2", current_step: "proposal_build", est_value: 1, contact_url: c.url });
    const groups = looseEnds([o1, o2], [c], {}, []);
    const dm = groups.find((g) => g.key === "noDecisionMaker");
    expect(dm).toBeDefined();
    // Deduped: one entry per contact even with two opps.
    expect(dm!.items).toHaveLength(1);
    expect(dm!.items[0].label).toBe("Jane Doe");
    expect(dm!.items[0].tab).toBe("contacts");
  });

  it("does not flag when the contact already has a known decision role", () => {
    const c = contact({ url: "https://linkedin.com/in/jane" });
    const o = opp({ id: "o1", current_step: "scoping", est_value: 1, contact_url: c.url });
    const edits = {
      "https://linkedin.com/in/jane": { decision_role: "Decision Maker" as const },
    };
    const groups = looseEnds([o], [c], edits, []);
    expect(groups.find((g) => g.key === "noDecisionMaker")).toBeUndefined();
  });

  it("flags a standalone SoW not linked to an opportunity", () => {
    const s = sow({ id: "s1", linked_opportunity_id: undefined, engagement_name: "Lone SoW" });
    const groups = looseEnds([], [], {}, [s]);
    const g = groups.find((g) => g.key === "sowNoOpp");
    expect(g).toBeDefined();
    expect(g!.items[0].label).toBe("Lone SoW");
    expect(g!.items[0].tab).toBe("revenue");
  });

  it("returns no groups when there are no loose ends", () => {
    expect(looseEnds([], [], {}, [])).toEqual([]);
  });
});

// ── activityStats ─────────────────────────────────────────────────────────────
describe("activityStats", () => {
  it("counts distinct people met this month vs last month", () => {
    const rows = [
      meetingRow({ id: "m1", contact_url: "a", date_held: "2026-06-10" }),
      meetingRow({ id: "m2", contact_url: "a", date_held: "2026-06-20" }), // same person, June → dedup
      meetingRow({ id: "m3", contact_url: "b", date_held: "2026-06-05" }),
      meetingRow({ id: "m4", contact_url: "c", date_held: "2026-05-15" }), // last month
    ];
    const stats = activityStats(rows, [], TODAY);
    expect(stats.peopleMet.thisMonth).toBe(2); // a, b
    expect(stats.peopleMet.lastMonth).toBe(1); // c
  });

  it("counts opportunities created (by meeting step date) this vs last month", () => {
    const opps = [
      opp({ id: "o1", step_dates: { meeting: "2026-06-01" } }),
      opp({ id: "o2", step_dates: { meeting: "2026-06-15" } }),
      opp({ id: "o3", step_dates: { meeting: "2026-05-20" } }),
      opp({ id: "o4", step_dates: {} }), // no meeting date → neither month
    ];
    const stats = activityStats([], opps, TODAY);
    expect(stats.oppsCreated.thisMonth).toBe(2);
    expect(stats.oppsCreated.lastMonth).toBe(1);
  });

  it("rolls last month across a year boundary", () => {
    const rows = [meetingRow({ id: "m1", contact_url: "a", date_held: "2025-12-10" })];
    const stats = activityStats(rows, [], "2026-01-15");
    expect(stats.peopleMet.lastMonth).toBe(1);
    expect(stats.peopleMet.thisMonth).toBe(0);
  });

  it("handles empty inputs (all zero)", () => {
    const stats = activityStats([], [], TODAY);
    expect(stats).toEqual({
      peopleMet: { thisMonth: 0, lastMonth: 0 },
      oppsCreated: { thisMonth: 0, lastMonth: 0 },
    });
  });
});
