import { describe, it, expect } from "vitest";
import { cleanName, cleanCompany } from "./linkedinImport";

// ── R-H: import name/company hygiene ─────────────────────────────────────────────────────────────
describe("cleanName", () => {
  it("strips a leading emoji but keeps the name", () => {
    expect(cleanName("☁️Jon")).toBe("Jon");
    expect(cleanName("🚀 Priya")).toBe("Priya");
  });
  it("drops trailing post-nominal credentials", () => {
    expect(cleanName("Albaroudi, MBA, CIA, ICCGO")).toBe("Albaroudi");
    expect(cleanName("Alhummaidani ,RMFS")).toBe("Alhummaidani");
  });
  it("removes a pronoun parenthetical", () => {
    expect(cleanName("Sam (he/him)")).toBe("Sam");
  });
  it("keeps accents and non-Latin scripts intact", () => {
    expect(cleanName("José")).toBe("José");
    expect(cleanName("王伟")).toBe("王伟");
  });
});

describe("cleanCompany", () => {
  it("blanks job-search status / placeholder values", () => {
    expect(cleanCompany("Open to work")).toBe("");
    expect(cleanCompany("#OpenToWork")).toBe("");
    expect(cleanCompany("Commencing new role in 2026")).toBe("");
    expect(cleanCompany("-")).toBe("");
    expect(cleanCompany("N/A")).toBe("");
    expect(cleanCompany("Seeking new opportunities")).toBe("");
  });
  it("keeps real company names, including small/unknown and self-employed", () => {
    expect(cleanCompany("Barclays")).toBe("Barclays");
    expect(cleanCompany("Self-employed")).toBe("Self-employed");
    expect(cleanCompany("Freelance")).toBe("Freelance");
    expect(cleanCompany("Bright & Co Advisory")).toBe("Bright & Co Advisory");
  });
});
