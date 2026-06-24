import { describe, it, expect } from "vitest";
import { waNumber, waLink } from "./whatsapp";

// ── waNumber ────────────────────────────────────────────────────────────────────────────────
describe("waNumber", () => {
  it("returns null for empty / nullish input", () => {
    expect(waNumber(undefined)).toBeNull();
    expect(waNumber(null)).toBeNull();
    expect(waNumber("")).toBeNull();
  });

  it("returns null when there are no digits at all", () => {
    expect(waNumber("abc")).toBeNull();
    expect(waNumber("+++")).toBeNull();
    expect(waNumber("   ")).toBeNull();
  });

  it("keeps an already-E.164 number as-is", () => {
    expect(waNumber("966557312825")).toBe("966557312825");
  });

  it("strips a leading '+' and any spaces/punctuation", () => {
    expect(waNumber("+966 50 123 4567")).toBe("966501234567");
    expect(waNumber("+1 (415) 555-0132")).toBe("14155550132");
  });

  it("converts a 00 international prefix to bare country code", () => {
    expect(waNumber("0044 7700 900123")).toBe("447700900123");
  });

  it("prefixes 966 for a local Saudi 05XXXXXXXX number", () => {
    expect(waNumber("0501234567")).toBe("966501234567");
  });

  it("prefixes 966 for a 9-digit 5XXXXXXXX number", () => {
    expect(waNumber("501234567")).toBe("966501234567");
  });

  it("does NOT prefix 966 for a 9-digit number that does not start with 5", () => {
    // length 9 but starts with 4 → not the Saudi local short form, and length < 10 → null
    expect(waNumber("412345678")).toBeNull();
  });

  it("rejects numbers that are too short (< 10 digits)", () => {
    expect(waNumber("123456789")).toBeNull(); // 9 digits, not 5-leading
    expect(waNumber("12345")).toBeNull();
  });

  it("rejects numbers that are too long (> 15 digits)", () => {
    expect(waNumber("1234567890123456")).toBeNull(); // 16 digits
  });

  it("accepts boundary lengths 10 and 15", () => {
    expect(waNumber("1234567890")).toBe("1234567890"); // exactly 10
    expect(waNumber("123456789012345")).toBe("123456789012345"); // exactly 15
  });

  it("accepts a number type coerced to string", () => {
    // waNumber stringifies its input; a numeric E.164 still normalises.
    expect(waNumber(966557312825 as unknown as string)).toBe("966557312825");
  });
});

// ── waLink ──────────────────────────────────────────────────────────────────────────────────
describe("waLink", () => {
  it("builds the whatsapp:// desktop deep link for a valid number", () => {
    expect(waLink("966557312825")).toBe("whatsapp://send?phone=966557312825");
  });

  it("normalises before building the link", () => {
    expect(waLink("+966 50 123 4567")).toBe("whatsapp://send?phone=966501234567");
    expect(waLink("0501234567")).toBe("whatsapp://send?phone=966501234567");
  });

  it("returns null when there is nothing dialable", () => {
    expect(waLink(undefined)).toBeNull();
    expect(waLink(null)).toBeNull();
    expect(waLink("")).toBeNull();
    expect(waLink("not a phone")).toBeNull();
    expect(waLink("12345")).toBeNull();
  });
});
