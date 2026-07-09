import { describe, it, expect } from "vitest";
import { clearlyPersonal, conversationPath } from "./grounding";
import { runTool, computeExact } from "./compute";
import type { BookData } from "./bookContext";
import type { Contact } from "../data/contacts";

const TODAY = "2026-06-24";

// Minimal contact fixture (mirrors the dashboard.test builder) — enough for runTool's filters.
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
    url: "https://www.linkedin.com/in/jane",
    phone: "",
    ...over,
  };
}

function book(over: Partial<BookData> = {}): BookData {
  return { contacts: [], meetingRows: [], opps: [], sows: [], ...over };
}

// ── clearlyPersonal: the DETERMINISTIC pre-router floor ──────────────────────────────────────────
describe("clearlyPersonal (deterministic personal floor)", () => {
  const d = book();

  it("catches an emotional/personal message the LLM router could misroute", () => {
    expect(clearlyPersonal("I feel worthless, work is grinding me down")).toBe(true);
    expect(clearlyPersonal("thinking about quitting, I'm so burned out")).toBe(true);
  });

  it("catches bare small talk and life/career decisions", () => {
    expect(clearlyPersonal("hey there")).toBe(true);
    expect(clearlyPersonal("should I take the job at EY or stay put")).toBe(true);
  });

  it("does NOT catch a BD ask, even one worded emotionally — it keeps grounding on the book", () => {
    // BOOK_INTENT beats the personal register (same precedence as conversationPath).
    expect(clearlyPersonal("I'm dreading the renewal — who are my warmest leads?")).toBe(false);
    expect(clearlyPersonal("show me my pipeline")).toBe(false);
    expect(clearlyPersonal("who should I reach out to this week")).toBe(false);
  });

  it("does NOT swallow ambiguous / capability queries — those still reach the LLM router", () => {
    // These are NOT clearly personal, so the floor lets them through (conversationPath may still
    // default them to companion via its data/stickiness fall-through, but the pre-router floor must not).
    expect(clearlyPersonal("what can you do")).toBe(false);
    expect(clearlyPersonal("summarise the Q3 numbers")).toBe(false);
  });

  it("agrees with conversationPath on the clear personal cases (consistency)", () => {
    for (const t of ["hey there", "I feel worthless", "should I quit my job"]) {
      if (clearlyPersonal(t)) expect(conversationPath(t, d)).toBe("companion");
    }
  });
});

// ── runTool arg validation: stage + pronoun ──────────────────────────────────────────────────────
describe("runTool arg validation", () => {
  const d = book({
    contacts: [
      contact({ first: "Christopher", last: "Shepherd", url: "https://www.linkedin.com/in/chris", messaged: true, responded: true }),
      contact({ first: "Amara", last: "Okafor", url: "https://www.linkedin.com/in/amara", messaged: true }),
    ],
  });

  it("ignores a hallucinated funnel stage instead of using it as a dynamic key", () => {
    // A junk/magic stage must not match everything (e.g. via a prototype key) — it's treated as no filter.
    const bad = runTool({ tool: "findContacts", args: { stage: "__proto__" } }, d, TODAY);
    const junk = runTool({ tool: "findContacts", args: { stage: "hot" } }, d, TODAY);
    const none = runTool({ tool: "findContacts", args: {} }, d, TODAY);
    // Same result as no stage at all — the invalid stage is dropped, not applied.
    expect(bad?.rows.length).toBe(none?.rows.length);
    expect(junk?.rows.length).toBe(none?.rows.length);
    expect(bad?.rows.length).toBe(2);
  });

  it("honours a VALID funnel stage", () => {
    const responded = runTool({ tool: "findContacts", args: { stage: "responded" } }, d, TODAY);
    expect(responded?.rows.length).toBe(1); // only Christopher responded
  });

  it("does not brief a coincidental substring match for a pronoun name", () => {
    // "her" must NOT resolve to "Christopher SHEPHERD" / any name containing the letters — it returns
    // null so answer() falls through to the grounded book path (which carries the thread's real person).
    expect(runTool({ tool: "contactBrief", args: { name: "her" } }, d, TODAY)).toBeNull();
    expect(runTool({ tool: "contactBrief", args: { name: "them" } }, d, TODAY)).toBeNull();
    expect(runTool({ tool: "accountSummary", args: { company: "them" } }, d, TODAY)).toBeNull();
  });

  it("still briefs a real named contact", () => {
    const brief = runTool({ tool: "contactBrief", args: { name: "Christopher Shepherd" } }, d, TODAY);
    expect(brief).not.toBeNull();
    expect(brief?.intro || JSON.stringify(brief)).toContain("Christopher");
  });
});

// ── R3: no book-existence check on the LLM-router path → confident false-negative ─────────────────
describe("runTool unknown-company guard (R3)", () => {
  const d = book({ contacts: [contact({ first: "Ana", last: "Ng", organisation: "Meridian Advisory" })] });
  it("returns null for a company NOT in the book (so answer() falls through to the grounded path)", () => {
    expect(runTool({ tool: "findContracts", args: { company: "Meridian Consulting" } }, d, TODAY)).toBeNull();
    expect(runTool({ tool: "findContacts", args: { company: "ZzzCorp" } }, d, TODAY)).toBeNull();
    expect(runTool({ tool: "findOpportunities", args: { company: "Citibank" } }, d, TODAY)).toBeNull();
  });
  it("still runs when the company IS in the book, or when none is supplied", () => {
    expect(runTool({ tool: "findContacts", args: { company: "Meridian Advisory" } }, d, TODAY)).not.toBeNull();
    expect(runTool({ tool: "findContacts", args: {} }, d, TODAY)).not.toBeNull(); // no company filter = all contacts
  });
});

// ── R1/R2: the narrow computeExact rail owns exact maths, leaves rankings/chat to the LLM router ───
describe("computeExact rail (R1/R2)", () => {
  const d = book({ contacts: [contact()] });
  it("does NOT own rankings, stats or chit-chat (those go to the LLM router → null)", () => {
    expect(computeExact("show me my warmest leads", d, TODAY)).toBeNull();
    expect(computeExact("how's my pipeline looking", d, TODAY)).toBeNull();
    expect(computeExact("how are you today?", d, TODAY)).toBeNull();
  });
  it("does NOT hijack a genuine reasoning request", () => {
    expect(computeExact("analyse the average deal and tell me what to focus on", d, TODAY)).toBeNull();
  });
});
