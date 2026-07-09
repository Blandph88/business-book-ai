import { describe, it, expect } from "vitest";
import { redactPII } from "./sentiment";

describe("redactPII", () => {
  it("redacts emails, links and real phone numbers", () => {
    expect(redactPII("mail me at jo@acme.co")).toContain("[email]");
    expect(redactPII("see https://acme.co/deck")).toContain("[link]");
    expect(redactPII("call +44 20 7946 0018 today")).toContain("[phone]");
    expect(redactPII("ring 020-7946-0018")).toContain("[phone]");
  });

  it("does NOT eat dates, year ranges or budgets (the opp scan reads these)", () => {
    expect(redactPII("project ran 2020-2024")).toBe("project ran 2020-2024");
    expect(redactPII("signed 10-12-2024")).toBe("signed 10-12-2024");
    expect(redactPII("budget of 2 000 000 confirmed")).toBe("budget of 2 000 000 confirmed");
    expect(redactPII("a 2500000 spend")).toBe("a 2500000 spend");
    expect(redactPII("start 2024-01-15")).toBe("start 2024-01-15");
  });

  it("redacts the contact's own name, including accented names", () => {
    expect(redactPII("Thanks, José here", ["José", ""])).toBe("Thanks, [name] here");
    expect(redactPII("From Anastasia", ["Anastasia", ""])).toBe("From [name]");
  });

  it("does not redact inside a longer word", () => {
    expect(redactPII("the analytics team", ["Ana"])).toBe("the analytics team");
  });

  it("skips first names that are everyday words (would blank the word throughout)", () => {
    expect(redactPII("we will meet in April", ["Will", ""])).toBe("we will meet in April");
    expect(redactPII("it may work", ["May"])).toBe("it may work");
  });
});
