import { describe, it, expect } from "vitest";
import {
  classifySeniority,
  classifyFunction,
  classifySector,
  classifyContact,
  OTHER_FUNCTIONS,
} from "./classify";
import { SECTOR_GROUPS } from "./vocab";
import { OTHER_INDUSTRY_LABEL, INDEPENDENT_LABEL } from "../config/markets";

// ── SENIORITY ─────────────────────────────────────────────────────────────────────────────
describe("classifySeniority", () => {
  it("defaults empty/blank titles to Associate / Analyst", () => {
    expect(classifySeniority(undefined)).toBe("Associate / Analyst");
    expect(classifySeniority("")).toBe("Associate / Analyst");
    expect(classifySeniority("   ")).toBe("Associate / Analyst");
  });

  it.each([
    ["Chief Executive Officer", "Executive Leadership"],
    ["CEO", "Executive Leadership"],
    ["CFO", "Executive Leadership"],
    ["Managing Director", "Executive Leadership"],
    ["Executive Director", "Executive Leadership"],
    ["Founder & CEO", "Executive Leadership"],
    ["Co-Founder", "Executive Leadership"],
    ["Owner", "Executive Leadership"],
    ["Proprietor", "Executive Leadership"],
    ["Managing Partner", "Executive Leadership"],
    ["Partner", "Executive Leadership"],
    ["President", "Executive Leadership"],
    ["Chairman", "Executive Leadership"],
    ["Non-Executive Director", "Executive Leadership"],
  ])("puts org leadership %s in Executive Leadership", (title, band) => {
    expect(classifySeniority(title)).toBe(band);
  });

  // Regression guards for the big C-suite substring bug (cto/coo matched dire-cto-r, do-cto-r,
  // coo-rdinator, etc.). These MUST NOT be Executive Leadership.
  it.each(["Doctor", "Coordinator", "Contractor", "Factory Worker", "Solicitor"])(
    "does not misread '%s' as Executive Leadership (whole-word C-suite guard)",
    (title) => {
      expect(classifySeniority(title)).not.toBe("Executive Leadership");
    },
  );

  it("treats HR/business 'partner' as not equity partner", () => {
    expect(classifySeniority("HR Business Partner")).not.toBe("Executive Leadership");
    expect(classifySeniority("People Partner")).not.toBe("Executive Leadership");
  });

  it.each([
    ["Vice President", "VP / SM"],
    ["Vice President of Sales", "VP / SM"],
    ["AVP", "VP / SM"],
    ["Associate Director", "VP / SM"],
    ["Assistant Director", "VP / SM"],
    ["Advisory Director", "VP / SM"],
    ["Director, M&A", "VP / SM"],
    ["Senior Manager", "VP / SM"],
    ["Senior Product Manager", "VP / SM"],
    ["Principal", "VP / SM"],
    ["Principal Consultant", "VP / SM"],
  ])("places %s in VP / SM", (title, band) => {
    expect(classifySeniority(title)).toBe(band);
  });

  it.each([
    ["SVP", "Head of / Director"],
    ["Senior Vice President", "Head of / Director"],
    ["Regional Vice President", "Head of / Director"],
    ["Director", "Head of / Director"],
    ["Marketing Director", "Head of / Director"],
    ["Head of Marketing", "Head of / Director"],
    ["General Manager", "Head of / Director"],
    ["Company Secretary", "Head of / Director"],
    ["Financial Controller", "Head of / Director"],
  ])("places %s in Head of / Director", (title, band) => {
    expect(classifySeniority(title)).toBe(band);
  });

  it.each([
    ["Manager", "Manager"],
    ["Project Manager", "Manager"],
    ["Team Lead", "Manager"],
    ["Controller", "Manager"],
  ])("places %s in Manager", (title, band) => {
    expect(classifySeniority(title)).toBe(band);
  });

  it.each([
    ["Analyst", "Associate / Analyst"],
    ["Associate", "Associate / Analyst"],
    ["Specialist", "Associate / Analyst"],
    ["Assistant Manager", "Associate / Analyst"],
    ["Deputy Manager", "Associate / Analyst"],
    ["Credit Controller", "Associate / Analyst"],
    ["Software Engineer", "Associate / Analyst"],
  ])("places %s in Associate / Analyst", (title, band) => {
    expect(classifySeniority(title)).toBe(band);
  });
});

// ── FUNCTION ──────────────────────────────────────────────────────────────────────────────
describe("classifyFunction", () => {
  it("defaults empty titles to Other Functions", () => {
    expect(classifyFunction(undefined)).toBe(OTHER_FUNCTIONS);
    expect(classifyFunction("")).toBe(OTHER_FUNCTIONS);
  });

  it.each([
    ["Lawyer", "Legal & Compliance"],
    ["General Counsel", "Legal & Compliance"],
    ["Internal Auditor", "Risk, Audit & Actuarial"],
    ["Tax Manager", "Finance & Accounting"],
    ["Chartered Accountant", "Finance & Accounting"],
    ["Portfolio Manager", "Investments & Capital Markets"],
    ["Recruitment Consultant", "Human Resources"],
    ["Account Executive", "Sales & Marketing"],
    ["Data Scientist", "Data & Analytics"],
    ["Data Engineer", "Data & Analytics"],
    ["Product Manager", "Product & Design"],
    ["Software Engineer", "Technology & Engineering"],
    ["Procurement Manager", "Operations & Supply Chain"],
    ["Secondary School Teacher", "Education & Training"],
    ["Management Consultant", "Consulting & Advisory"],
    ["Founder", "Founder, Owner & Partner"],
    ["Chief Executive Officer", "General Management"],
  ])("classifies %s as %s", (title, fn) => {
    expect(classifyFunction(title)).toBe(fn);
  });

  // Whole-word regex guards (the old substring matcher leaked nurse→nursery, data→database…).
  it("does not leak nurse → nursery", () => {
    expect(classifyFunction("Nursery Manager")).not.toBe("Clinical & Healthcare");
  });

  it("orders Clinical before Consulting (consultant cardiologist is clinical)", () => {
    expect(classifyFunction("Consultant Cardiologist")).toBe("Clinical & Healthcare");
  });

  it("orders Data before Technology (data engineer is Data)", () => {
    expect(classifyFunction("Data Engineer")).toBe("Data & Analytics");
  });

  it("respects the (?<!quality )assurance lookbehind", () => {
    expect(classifyFunction("Assurance Manager")).toBe("Risk, Audit & Actuarial");
    // 'quality assurance' is excluded from Risk; 'engineer' lands it in Technology.
    expect(classifyFunction("Quality Assurance Engineer")).toBe("Technology & Engineering");
  });
});

// ── SECTOR ────────────────────────────────────────────────────────────────────────────────
describe("classifySector", () => {
  it("returns the Other catch-all for blank companies, with no entity", () => {
    expect(classifySector("")).toEqual({ sectorGroup: OTHER_INDUSTRY_LABEL, subGroup: "", entity: "" });
    expect(classifySector(undefined)).toEqual({ sectorGroup: OTHER_INDUSTRY_LABEL, subGroup: "", entity: "" });
  });

  it.each(["Self-employed", "Freelance", "Sole Trader", "Retired", "Open to work"])(
    "routes '%s' to the Independent band",
    (co) => {
      expect(classifySector(co).sectorGroup).toBe(INDEPENDENT_LABEL);
    },
  );

  it("routes placeholder employers to the Independent band", () => {
    expect(classifySector("Undisclosed").sectorGroup).toBe(INDEPENDENT_LABEL);
    expect(classifySector("Various Companies").sectorGroup).toBe(INDEPENDENT_LABEL);
  });

  it("resolves well-known dictionary companies (exact + fuzzy)", () => {
    expect(classifySector("Microsoft").sectorGroup).toBe("Technology");
    expect(classifySector("Microsoft Azure").sectorGroup).toBe("Technology"); // fuzzy: "<name> + words"
    expect(classifySector("Google").sectorGroup).toBe("Technology");
  });

  it("always returns a sectorGroup that is a registered SECTOR_GROUP", () => {
    const samples = ["", "Acme Widgets Ltd", "KPMG", "Self-employed", "Microsoft", "Zzxq Unknown Co"];
    for (const s of samples) {
      expect(SECTOR_GROUPS as readonly string[]).toContain(classifySector(s).sectorGroup);
    }
  });

  it("does not over-match a short canonical name mid-word (token-aligned fuzzy)", () => {
    // 'Capita' must not hit 'X Capital'; the fuzzy step is space-padded whole-token.
    const r = classifySector("Brookfield Capital Partners International");
    expect(r.entity).not.toBe("Capita");
  });
});

// ── CONTACT ENRICHMENT ──────────────────────────────────────────────────────────────────────
describe("classifyContact", () => {
  it("trims fields and fills all enriched columns", () => {
    const e = classifyContact({ first: " Jane ", last: " Doe ", company: " Microsoft ", title: " Software Engineer ", url: " https://x " });
    expect(e.first).toBe("Jane");
    expect(e.last).toBe("Doe");
    expect(e.organisation).toBe("Microsoft");
    expect(e.position).toBe("Software Engineer");
    expect(e.url).toBe("https://x");
    expect(e.sector_group).toBe("Technology");
    expect(e.seniority).toBe("Associate / Analyst");
    expect(e.function).toBe("Technology & Engineering");
  });

  it("falls back sector_detail to the raw org when no canonical entity matched", () => {
    const e = classifyContact({ company: "Acme Widgets Ltd", title: "Manager" });
    expect(e.sector_detail).toBe("Acme Widgets Ltd");
  });

  it("tolerates a fully empty contact", () => {
    const e = classifyContact({});
    expect(e.sector_group).toBe(OTHER_INDUSTRY_LABEL);
    expect(e.function).toBe(OTHER_FUNCTIONS);
    expect(e.seniority).toBe("Associate / Analyst");
  });
});
