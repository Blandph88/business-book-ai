import { describe, it, expect } from "vitest";
import {
  computeFunnelStacked,
  OUT_OF_SCOPE_GROUP,
  PENDING_GROUP,
} from "./metrics";
import { SECTOR_GROUPS } from "./vocab";
import type { Contact } from "./contacts";

// ── Fixtures ──────────────────────────────────────────────────────────────────
// A tiny Contact factory — all funnel flags default false; the test overrides only
// the fields it cares about. The funnel reads: messaged, two_way (= "Responded"),
// agreed_to_meet, met (+ optional metUrls), and sector_group (for segments).
let seq = 0;
function contact(over: Partial<Contact> = {}): Contact {
  seq += 1;
  return {
    first: "F",
    last: "L",
    organisation: "Org",
    position: "Pos",
    sector_detail: "Detail",
    sector_group: "Financial Services",
    sub_group: "Banks",
    seniority: "Manager",
    function: "Finance & Accounting",
    messaged: false,
    responded: false,
    two_way: false,
    agreed_to_meet: false,
    met: false,
    url: `https://linkedin.com/in/p${seq}`,
    phone: "",
    ...over,
  };
}

// A known book: nested funnel by construction.
//  - 8 total
//  - 6 messaged
//  - 4 two_way (Responded)
//  - 2 agreed_to_meet
//  - 1 met (and is also agreed)
// Sector mix: 4 Financial Services, 2 Technology, 2 Healthcare & Pharma.
function sampleBook(): Contact[] {
  return [
    // Financial Services
    contact({ sector_group: "Financial Services", messaged: true, two_way: true, agreed_to_meet: true, met: true }),
    contact({ sector_group: "Financial Services", messaged: true, two_way: true, agreed_to_meet: true, met: false }),
    contact({ sector_group: "Financial Services", messaged: true, two_way: true }),
    contact({ sector_group: "Financial Services", messaged: false }),
    // Technology
    contact({ sector_group: "Technology", messaged: true, two_way: true }),
    contact({ sector_group: "Technology", messaged: true }),
    // Healthcare & Pharma
    contact({ sector_group: "Healthcare & Pharma", messaged: true }),
    contact({ sector_group: "Healthcare & Pharma", messaged: false }),
  ];
}

describe("computeFunnelStacked — stages", () => {
  it("produces the five contacts-first stages in order", () => {
    const stages = computeFunnelStacked(sampleBook());
    expect(stages.map((s) => s.label)).toEqual([
      "Your network",
      "Messaged",
      "Responded",
      "Agreed to meet",
      "Met",
    ]);
  });

  it("computes correct stage totals from the flags", () => {
    const stages = computeFunnelStacked(sampleBook());
    const byLabel = Object.fromEntries(stages.map((s) => [s.label, s.count]));
    expect(byLabel["Your network"]).toBe(8);
    expect(byLabel["Messaged"]).toBe(6);
    expect(byLabel["Responded"]).toBe(4); // two_way, not responded
    expect(byLabel["Agreed to meet"]).toBe(2);
    expect(byLabel["Met"]).toBe(1);
  });

  it("count always equals the stage's contacts array length (reconciles)", () => {
    const stages = computeFunnelStacked(sampleBook());
    for (const s of stages) expect(s.count).toBe(s.contacts.length);
  });
});

describe("computeFunnelStacked — nesting invariant (each stage ⊆ previous)", () => {
  it("every later stage's contacts are a subset of the earlier stage", () => {
    const stages = computeFunnelStacked(sampleBook());
    for (let i = 1; i < stages.length; i++) {
      const prev = new Set(stages[i - 1].contacts.map((c) => c.url));
      for (const c of stages[i].contacts) {
        expect(prev.has(c.url)).toBe(true);
      }
    }
  });

  it("Met ⊆ Agreed even when metUrls names a non-agreed contact", () => {
    // A contact who is messaged+two_way but NOT agreed; supplying its url in metUrls
    // must NOT promote it into Met (Met is intersected with agreed).
    const stray = contact({ messaged: true, two_way: true, agreed_to_meet: false });
    const agreedAndMet = contact({ messaged: true, two_way: true, agreed_to_meet: true });
    const stages = computeFunnelStacked([stray, agreedAndMet], {
      metUrls: new Set([stray.url, agreedAndMet.url]),
    });
    const met = stages.find((s) => s.label === "Met")!;
    expect(met.count).toBe(1);
    expect(met.contacts.map((c) => c.url)).toEqual([agreedAndMet.url]);
  });

  it("Met unions the met heuristic with metUrls (both routes count)", () => {
    const viaFlag = contact({ messaged: true, two_way: true, agreed_to_meet: true, met: true });
    const viaUrl = contact({ messaged: true, two_way: true, agreed_to_meet: true, met: false });
    const stages = computeFunnelStacked([viaFlag, viaUrl], {
      metUrls: new Set([viaUrl.url]),
    });
    const met = stages.find((s) => s.label === "Met")!;
    expect(met.count).toBe(2);
  });
});

describe("computeFunnelStacked — per-stage segments by sector_group", () => {
  it("segments cover the fixed SECTOR_GROUPS list in order", () => {
    const stages = computeFunnelStacked(sampleBook());
    const network = stages[0];
    expect(network.segments.map((seg) => seg.label)).toEqual([...SECTOR_GROUPS]);
  });

  it("segment counts sum to the stage total and reconcile to contacts", () => {
    const stages = computeFunnelStacked(sampleBook());
    for (const s of stages) {
      const summed = s.segments.reduce((a, seg) => a + seg.count, 0);
      expect(summed).toBe(s.count);
      for (const seg of s.segments) expect(seg.count).toBe(seg.contacts.length);
    }
  });

  it("breaks the network stage down by the right sector counts", () => {
    const stages = computeFunnelStacked(sampleBook());
    const segs = Object.fromEntries(
      stages[0].segments.map((s) => [s.label, s.count]),
    );
    expect(segs["Financial Services"]).toBe(4);
    expect(segs["Technology"]).toBe(2);
    expect(segs["Healthcare & Pharma"]).toBe(2);
    expect(segs["Public Sector"]).toBe(0); // empty group still present (count 0)
  });

  it("keeps zero-count segments so segments always sum to the whole (§6 rule 2)", () => {
    // The funnel stage segments are FIXED over SECTOR_GROUPS — empty groups are kept
    // (count 0), unlike the group-summary chart which drops them.
    const stages = computeFunnelStacked(sampleBook());
    const respondedSegs = stages.find((s) => s.label === "Responded")!.segments;
    expect(respondedSegs.length).toBe(SECTOR_GROUPS.length);
    // Healthcare & Pharma responded = 0 but the segment is still present.
    const hp = respondedSegs.find((s) => s.label === "Healthcare & Pharma")!;
    expect(hp.count).toBe(0);
  });
});

describe("computeFunnelStacked — pctOfTarget", () => {
  it("expresses each stage as a whole % of the Your-network total", () => {
    const stages = computeFunnelStacked(sampleBook());
    const byLabel = Object.fromEntries(stages.map((s) => [s.label, s.pctOfTarget]));
    expect(byLabel["Your network"]).toBe(100); // 8/8
    expect(byLabel["Messaged"]).toBe(75); // 6/8
    expect(byLabel["Responded"]).toBe(50); // 4/8
    expect(byLabel["Agreed to meet"]).toBe(25); // 2/8
    expect(byLabel["Met"]).toBe(13); // round(1/8*100)=13
  });
});

describe("computeFunnelStacked — edge cases", () => {
  it("empty input → all stages zero, no crash, divide-by-zero guarded", () => {
    const stages = computeFunnelStacked([]);
    expect(stages).toHaveLength(5);
    for (const s of stages) {
      expect(s.count).toBe(0);
      expect(s.contacts).toEqual([]);
      expect(s.pctOfTarget).toBe(0); // guarded: targetTotal===0 → 0, not NaN
      // segments still cover all groups, all zero
      expect(s.segments).toHaveLength(SECTOR_GROUPS.length);
      expect(s.segments.every((seg) => seg.count === 0)).toBe(true);
    }
  });

  it("all-in-one-group concentrates the segment counts in that group", () => {
    const book = [
      contact({ sector_group: "Technology", messaged: true, two_way: true }),
      contact({ sector_group: "Technology", messaged: true, two_way: true }),
      contact({ sector_group: "Technology", messaged: true }),
    ];
    const stages = computeFunnelStacked(book);
    const tech = stages[0].segments.find((s) => s.label === "Technology")!;
    expect(tech.count).toBe(3);
    const others = stages[0].segments.filter((s) => s.label !== "Technology");
    expect(others.every((s) => s.count === 0)).toBe(true);
  });

  it("exposes the special top-stage group labels as constants", () => {
    // These name the Out-of-Scope / Pending segments used by the connections-based
    // stages; assert the exported spellings so callers stay in sync.
    expect(OUT_OF_SCOPE_GROUP).toBe("Out of Scope");
    expect(PENDING_GROUP).toBe("Pending");
  });
});
