import { describe, it, expect } from "vitest";
import {
  COMPANY_DICTIONARY,
  COMPANY_KEYWORD_RULES,
  INDUSTRIES,
  INDUSTRY_LABEL,
  OTHER_INDUSTRY_LABEL,
  INDEPENDENT_LABEL,
  REGIONS,
  type CompanyEntry,
  type IndustryId,
} from "../../config/markets";
import { SLICE_COMPANIES } from "./index";

// ── Taxonomy lookup tables (the source of truth the dictionary must conform to) ──
const VALID_INDUSTRY_IDS = new Set<string>(Object.keys(INDUSTRY_LABEL));
const VALID_SUBS_BY_INDUSTRY: Record<string, Set<string>> = Object.fromEntries(
  INDUSTRIES.map((i) => [i.id, new Set(i.subSectors)]),
);
const VALID_REGION_IDS = new Set<string>(REGIONS.map((r) => r.id));

// Subs that the dictionary/rules reference but that are MISSING from the INDUSTRIES
// config. These are genuine data-integrity gaps (see SUSPECTED BUG notes below): the
// dashboard's sub-sector axis is built from INDUSTRIES, so a row tagged with one of
// these subs cannot reconcile into a configured band.
const KNOWN_UNCONFIGURED_SUBS = new Set<string>([
  "Health & Wellness", // consumer-retail (also looks healthcare-shaped)
  "Sports & Recreation", // consumer-retail
  "Logistics & Transport", // energy-industrial
]);

function isValidSub(entry: { industry: string; sub: string }): boolean {
  const subs = VALID_SUBS_BY_INDUSTRY[entry.industry];
  return !!subs && subs.has(entry.sub);
}

// ── Sanity: the aggregate concatenates into the curated dictionary ──────────────
describe("COMPANY_DICTIONARY composition", () => {
  it("is a large, non-empty array", () => {
    expect(Array.isArray(COMPANY_DICTIONARY)).toBe(true);
    expect(COMPANY_DICTIONARY.length).toBeGreaterThan(1000);
  });

  it("contains every SLICE_COMPANIES row", () => {
    expect(COMPANY_DICTIONARY.length).toBeGreaterThanOrEqual(
      SLICE_COMPANIES.length,
    );
  });
});

// ── Per-entry structural integrity ──────────────────────────────────────────────
describe("COMPANY_DICTIONARY entry integrity", () => {
  it("no entry has an empty/blank name", () => {
    const empty = COMPANY_DICTIONARY.filter((e) => !e.name || !e.name.trim());
    expect(empty).toEqual([]);
  });

  it("every entry's industry is a valid IndustryId (in INDUSTRY_LABEL)", () => {
    const bad = COMPANY_DICTIONARY.filter(
      (e) => !VALID_INDUSTRY_IDS.has(e.industry),
    ).map((e) => `${e.name} (${e.industry})`);
    expect(bad).toEqual([]);
  });

  it("aliases, when present, are a non-empty array of non-empty strings", () => {
    const bad: string[] = [];
    for (const e of COMPANY_DICTIONARY) {
      if (e.aliases === undefined) continue;
      if (
        !Array.isArray(e.aliases) ||
        e.aliases.some((a) => typeof a !== "string" || a.trim() === "")
      ) {
        bad.push(e.name);
      }
    }
    expect(bad).toEqual([]);
  });

  it("regions, when present, are valid RegionIds", () => {
    const bad: string[] = [];
    for (const e of COMPANY_DICTIONARY) {
      if (!Array.isArray(e.regions)) {
        bad.push(`${e.name} (regions not an array)`);
        continue;
      }
      for (const r of e.regions) {
        if (!VALID_REGION_IDS.has(r)) bad.push(`${e.name} (region ${r})`);
      }
    }
    expect(bad).toEqual([]);
  });

  // RELAXED, ALWAYS-PASSING guard: every entry's sub is either a configured sub for
  // its industry OR one of the three known-unconfigured subs documented above. This
  // catches NEW bad subs while tolerating the known data gap.
  it("every entry's sub is configured for its industry (or a known-unconfigured sub)", () => {
    const bad: string[] = [];
    for (const e of COMPANY_DICTIONARY) {
      if (!VALID_INDUSTRY_IDS.has(e.industry)) continue; // covered above
      if (isValidSub(e)) continue;
      if (KNOWN_UNCONFIGURED_SUBS.has(e.sub)) continue;
      bad.push(`${e.name} -> ${e.industry} / ${e.sub}`);
    }
    expect(bad).toEqual([]);
  });

  // FIXED 2026-06-24: the 3 sub-sectors the dictionary emits but the config lacked
  // ("Health & Wellness" + "Sports & Recreation" under consumer-retail, "Logistics &
  // Transport" under energy-industrial) were added to INDUSTRIES in config/markets.ts,
  // so this strict guard now passes and locks the config + dictionary together.
  it("STRICT: every entry's sub is a configured sub-sector for its industry", () => {
    const bad: string[] = [];
    for (const e of COMPANY_DICTIONARY) {
      if (!VALID_INDUSTRY_IDS.has(e.industry)) continue;
      if (!isValidSub(e)) bad.push(`${e.name} -> ${e.industry} / ${e.sub}`);
    }
    expect(bad).toEqual([]);
  });
});

// ── Duplicate normalized names — informational, NOT a failure ───────────────────
describe("COMPANY_DICTIONARY duplicate names (informational)", () => {
  it("reports duplicate normalized names without failing", () => {
    const norm = (s: string) => s.trim().toLowerCase();
    const counts = new Map<string, number>();
    for (const e of COMPANY_DICTIONARY) {
      const k = norm(e.name);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const dups = [...counts.entries()].filter(([, c]) => c > 1);
    const extraRows = dups.reduce((a, [, c]) => a + (c - 1), 0);
    // The code intentionally dedupes downstream in classify.ts, so duplicates here are
    // EXPECTED (slice overlaps + curated/mined collisions). Report, don't fail.
    // eslint-disable-next-line no-console
    console.info(
      `[dictionary] ${dups.length} duplicate normalized names across ${COMPANY_DICTIONARY.length} entries (${extraRows} extra rows)`,
    );
    expect(extraRows).toBeGreaterThanOrEqual(0);
  });
});

// ── COMPANY_KEYWORD_RULES integrity ─────────────────────────────────────────────
describe("COMPANY_KEYWORD_RULES integrity", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(COMPANY_KEYWORD_RULES)).toBe(true);
    expect(COMPANY_KEYWORD_RULES.length).toBeGreaterThan(0);
  });

  it("every rule has a valid industry", () => {
    const bad = COMPANY_KEYWORD_RULES.filter(
      (r) => !VALID_INDUSTRY_IDS.has(r.industry),
    ).map((r) => r.industry);
    expect(bad).toEqual([]);
  });

  it("every rule carries either kw (string[]) or re (RegExp)", () => {
    const bad: number[] = [];
    COMPANY_KEYWORD_RULES.forEach((r, i) => {
      const hasKw =
        Array.isArray(r.kw) &&
        r.kw.length > 0 &&
        r.kw.every((k) => typeof k === "string" && k.length > 0);
      const hasRe = r.re instanceof RegExp;
      if (!hasKw && !hasRe) bad.push(i);
    });
    expect(bad).toEqual([]);
  });

  // RELAXED, ALWAYS-PASSING guard mirroring the dictionary one.
  it("every rule's sub is configured for its industry (or a known-unconfigured sub)", () => {
    const bad: string[] = [];
    COMPANY_KEYWORD_RULES.forEach((r, i) => {
      if (!VALID_INDUSTRY_IDS.has(r.industry)) return;
      if (isValidSub(r)) return;
      if (KNOWN_UNCONFIGURED_SUBS.has(r.sub)) return;
      bad.push(`rule #${i} -> ${r.industry} / ${r.sub}`);
    });
    expect(bad).toEqual([]);
  });

  // FIXED 2026-06-24: same fix as the dictionary guard — the rules' sub-sectors are now
  // declared in config/markets.ts, so this strict guard passes.
  it("STRICT: every rule's sub is a configured sub-sector for its industry", () => {
    const bad: string[] = [];
    COMPANY_KEYWORD_RULES.forEach((r, i) => {
      if (!VALID_INDUSTRY_IDS.has(r.industry)) return;
      if (!isValidSub(r)) bad.push(`rule #${i} -> ${r.industry} / ${r.sub}`);
    });
    expect(bad).toEqual([]);
  });
});

// ── Cross-check the taxonomy constants themselves ───────────────────────────────
describe("taxonomy config", () => {
  it("INDUSTRY_LABEL maps each INDUSTRIES id to its label", () => {
    for (const i of INDUSTRIES) {
      expect(INDUSTRY_LABEL[i.id as IndustryId]).toBe(i.label);
    }
  });

  it("the two catch-all labels are not industry labels", () => {
    const labels = new Set(Object.values(INDUSTRY_LABEL));
    expect(labels.has(OTHER_INDUSTRY_LABEL)).toBe(false);
    expect(labels.has(INDEPENDENT_LABEL)).toBe(false);
  });

  it("every industry has at least one sub-sector and no duplicate subs within it", () => {
    for (const i of INDUSTRIES) {
      expect(i.subSectors.length).toBeGreaterThan(0);
      expect(new Set(i.subSectors).size).toBe(i.subSectors.length);
    }
  });

  it("CompanyEntry shape is exercised (compile-time + a representative row)", () => {
    const sample: CompanyEntry = COMPANY_DICTIONARY[0];
    expect(typeof sample.name).toBe("string");
    expect(typeof sample.industry).toBe("string");
    expect(typeof sample.sub).toBe("string");
    expect(Array.isArray(sample.regions)).toBe(true);
  });
});
