import { describe, it, expect } from "vitest";
import {
  inPopulation,
  computeSeniorityBars,
  computeFunctionBars,
  computeGroupSummary,
  computeMatrix,
  type Population,
} from "./metrics";
import { SENIORITY, SECTOR_GROUPS, OTHER_FUNCTIONS } from "./vocab";
import { OTHER_INDUSTRY_LABEL } from "../config/markets";
import type { Contact } from "./contacts";

// ── Fixture factory ───────────────────────────────────────────────────────────
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
    url: `https://linkedin.com/in/m${seq}`,
    phone: "",
    ...over,
  };
}

describe("inPopulation", () => {
  const c = contact({
    messaged: true,
    two_way: true,
    agreed_to_meet: false,
    met: false,
  });
  it("full includes everyone regardless of flags", () => {
    expect(inPopulation(contact(), "full")).toBe(true);
  });
  it("maps each population to its flag", () => {
    expect(inPopulation(c, "messaged")).toBe(true);
    expect(inPopulation(c, "twoWay")).toBe(true);
    expect(inPopulation(c, "agreed")).toBe(false);
    expect(inPopulation(c, "met")).toBe(false);
  });
  it("twoWay reads two_way (not responded)", () => {
    const r = contact({ responded: true, two_way: false });
    expect(inPopulation(r, "twoWay")).toBe(false);
  });
});

// ── computeGroupSummary ───────────────────────────────────────────────────────
describe("computeGroupSummary", () => {
  function mixedBook(): Contact[] {
    return [
      contact({ sector_group: "Financial Services" }),
      contact({ sector_group: "Financial Services" }),
      contact({ sector_group: "Financial Services" }),
      contact({ sector_group: "Technology" }),
      contact({ sector_group: "Technology" }),
      contact({ sector_group: "Public Sector" }),
      contact({ sector_group: OTHER_INDUSTRY_LABEL }),
    ];
  }

  it("counts contacts per sector_group", () => {
    const { items, total } = computeGroupSummary(mixedBook(), "full");
    const byLabel = Object.fromEntries(items.map((i) => [i.label, i.contacts.length]));
    expect(byLabel["Financial Services"]).toBe(3);
    expect(byLabel["Technology"]).toBe(2);
    expect(byLabel["Public Sector"]).toBe(1);
    expect(byLabel[OTHER_INDUSTRY_LABEL]).toBe(1);
    expect(total).toBe(7);
  });

  it("excludes empty groups (no zero-length bars)", () => {
    const { items } = computeGroupSummary(mixedBook(), "full");
    const labels = items.map((i) => i.label);
    // groups present in the book are kept...
    expect(labels).toContain("Financial Services");
    // ...absent groups are dropped entirely
    expect(labels).not.toContain("Healthcare & Pharma");
    expect(labels).not.toContain("Real Estate");
    expect(items.every((i) => i.contacts.length > 0)).toBe(true);
  });

  it("preserves SECTOR_GROUPS ordering among the surfaced groups", () => {
    // computeGroupSummary maps over SECTOR_GROUPS then filters — surviving items keep
    // that fixed order. "Other / Smaller firms" is last in SECTOR_GROUPS, so it sorts last.
    const { items } = computeGroupSummary(mixedBook(), "full");
    const labels = items.map((i) => i.label);
    const expected = SECTOR_GROUPS.filter((g) => labels.includes(g));
    expect(labels).toEqual([...expected]);
    expect(labels[labels.length - 1]).toBe(OTHER_INDUSTRY_LABEL);
  });

  it("respects the population filter", () => {
    const book = [
      contact({ sector_group: "Technology", agreed_to_meet: true }),
      contact({ sector_group: "Technology", agreed_to_meet: false }),
      contact({ sector_group: "Financial Services", agreed_to_meet: true }),
    ];
    const { items, total } = computeGroupSummary(book, "agreed");
    expect(total).toBe(2);
    const byLabel = Object.fromEntries(items.map((i) => [i.label, i.contacts.length]));
    expect(byLabel["Technology"]).toBe(1);
    expect(byLabel["Financial Services"]).toBe(1);
  });

  it("empty input → no items, zero total, sumsToTotal true (no crash)", () => {
    const { items, total, sumsToTotal } = computeGroupSummary([], "full");
    expect(items).toEqual([]);
    expect(total).toBe(0);
    expect(sumsToTotal).toBe(true);
  });

  it("all-in-one-group yields a single surfaced bar summing to total", () => {
    const book = [
      contact({ sector_group: "Technology" }),
      contact({ sector_group: "Technology" }),
    ];
    const { items, total, sumsToTotal } = computeGroupSummary(book, "full");
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("Technology");
    expect(total).toBe(2);
    expect(sumsToTotal).toBe(true);
  });
});

// ── computeSeniorityBars ──────────────────────────────────────────────────────
describe("computeSeniorityBars", () => {
  it("uses the fixed SENIORITY order and keeps zero bars (sums to total)", () => {
    const book = [
      contact({ seniority: "Executive Leadership" }),
      contact({ seniority: "Manager" }),
      contact({ seniority: "Manager" }),
    ];
    const { items, total, sumsToTotal } = computeSeniorityBars(book, "full");
    expect(items.map((i) => i.label)).toEqual([...SENIORITY]);
    const byLabel = Object.fromEntries(items.map((i) => [i.label, i.contacts.length]));
    expect(byLabel["Executive Leadership"]).toBe(1);
    expect(byLabel["Manager"]).toBe(2);
    expect(byLabel["VP / SM"]).toBe(0); // empty band kept
    expect(total).toBe(3);
    expect(sumsToTotal).toBe(true);
  });

  it("empty input → all bands zero, no crash", () => {
    const { items, total } = computeSeniorityBars([], "full");
    expect(items).toHaveLength(SENIORITY.length);
    expect(items.every((i) => i.contacts.length === 0)).toBe(true);
    expect(total).toBe(0);
  });
});

// ── computeFunctionBars ───────────────────────────────────────────────────────
describe("computeFunctionBars", () => {
  it("counts contacts per function (discovered from data)", () => {
    const book = [
      contact({ function: "Finance & Accounting" }),
      contact({ function: "Finance & Accounting" }),
      contact({ function: "Sales & Marketing" }),
    ];
    const { items, total } = computeFunctionBars(book, "full");
    const byLabel = Object.fromEntries(items.map((i) => [i.label, i.contacts.length]));
    expect(byLabel["Finance & Accounting"]).toBe(2);
    expect(byLabel["Sales & Marketing"]).toBe(1);
    expect(total).toBe(3);
  });

  it("sorts real functions by count desc, ties broken alphabetically", () => {
    const book = [
      contact({ function: "Sales & Marketing" }),
      contact({ function: "Sales & Marketing" }),
      contact({ function: "Sales & Marketing" }),
      contact({ function: "Finance & Accounting" }),
      contact({ function: "Finance & Accounting" }),
      contact({ function: "Data & Analytics" }),
      contact({ function: "Consulting & Advisory" }),
    ];
    const { items } = computeFunctionBars(book, "full");
    expect(items[0].label).toBe("Sales & Marketing"); // 3
    expect(items[1].label).toBe("Finance & Accounting"); // 2
    // Data & Analytics vs Consulting & Advisory both 1 → alphabetical
    expect(items[2].label).toBe("Consulting & Advisory");
    expect(items[3].label).toBe("Data & Analytics");
  });

  it("INVARIANT: 'Other Functions' sorts LAST even when it is the largest bucket", () => {
    const book = [
      contact({ function: OTHER_FUNCTIONS }),
      contact({ function: OTHER_FUNCTIONS }),
      contact({ function: OTHER_FUNCTIONS }),
      contact({ function: OTHER_FUNCTIONS }),
      contact({ function: "Finance & Accounting" }),
    ];
    const { items } = computeFunctionBars(book, "full");
    expect(items[items.length - 1].label).toBe(OTHER_FUNCTIONS);
    expect(items[items.length - 1].contacts.length).toBe(4); // biggest, still last
    expect(items[0].label).toBe("Finance & Accounting");
  });

  it("empty function string falls into the Other Functions catch-all (pinned last)", () => {
    const book = [
      contact({ function: "" }),
      contact({ function: "Finance & Accounting" }),
    ];
    const { items } = computeFunctionBars(book, "full");
    const other = items.find((i) => i.label === OTHER_FUNCTIONS)!;
    expect(other.contacts.length).toBe(1);
    expect(items[items.length - 1].label).toBe(OTHER_FUNCTIONS);
  });

  it("bars sum to the population total (reconciles)", () => {
    const book = [
      contact({ function: "Finance & Accounting", agreed_to_meet: true }),
      contact({ function: "Sales & Marketing", agreed_to_meet: true }),
      contact({ function: "", agreed_to_meet: true }),
      contact({ function: "Finance & Accounting", agreed_to_meet: false }),
    ];
    const { items, total, sumsToTotal } = computeFunctionBars(book, "agreed");
    expect(total).toBe(3);
    expect(items.reduce((a, i) => a + i.contacts.length, 0)).toBe(3);
    expect(sumsToTotal).toBe(true);
  });

  it("empty input → no items, zero total, no crash", () => {
    const { items, total, sumsToTotal } = computeFunctionBars([], "full");
    expect(items).toEqual([]);
    expect(total).toBe(0);
    expect(sumsToTotal).toBe(true);
  });
});

// ── computeMatrix (function-column "Other Functions" pinned last) ─────────────
describe("computeMatrix — column ordering invariant", () => {
  it("pins 'Other Functions' as the LAST column even when largest", () => {
    const rows = [
      contact({ function: OTHER_FUNCTIONS, organisation: "A" }),
      contact({ function: OTHER_FUNCTIONS, organisation: "B" }),
      contact({ function: OTHER_FUNCTIONS, organisation: "C" }),
      contact({ function: "Finance & Accounting", organisation: "A" }),
    ];
    const m = computeMatrix(rows, {
      entity: "organisation",
      columns: "function",
      label: "Test",
    });
    expect(m.colLabels[m.colLabels.length - 1]).toBe(OTHER_FUNCTIONS);
  });

  it("uses the fixed SENIORITY columns when columns=seniority", () => {
    const m = computeMatrix([contact()], {
      entity: "organisation",
      columns: "seniority",
      label: "Test",
    });
    expect(m.colLabels).toEqual([...SENIORITY]);
  });

  it("reconciles: grandTotal = sum of column totals = sum of rows", () => {
    const rows = [
      contact({ organisation: "Acme", seniority: "Manager" }),
      contact({ organisation: "Acme", seniority: "Manager" }),
      contact({ organisation: "Beta", seniority: "Executive Leadership" }),
    ];
    const m = computeMatrix(rows, {
      entity: "organisation",
      columns: "seniority",
      label: "Test",
    });
    expect(m.grandTotal.length).toBe(3);
    const colSum = m.colTotals.reduce((a, col) => a + col.length, 0);
    expect(colSum).toBe(3);
    const rowSum = m.rows.reduce((a, r) => a + r.total.length, 0);
    expect(rowSum).toBe(3);
    expect(m.entityCount).toBe(2);
  });

  it("empty input → empty matrix, no crash", () => {
    const m = computeMatrix([], {
      entity: "organisation",
      columns: "seniority",
      label: "Test",
    });
    expect(m.rows).toEqual([]);
    expect(m.grandTotal).toEqual([]);
    expect(m.entityCount).toBe(0);
    expect(m.sections).toEqual([]);
  });
});

// Type-level sanity: the Population union strings stay valid.
const _pops: Population[] = ["full", "messaged", "twoWay", "agreed", "met"];
void _pops;
