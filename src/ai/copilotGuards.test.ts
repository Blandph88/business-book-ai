import { describe, it, expect } from "vitest";
import { clearlyPersonal, conversationPath } from "./grounding";
import { runTool, computeExact, resolveContact, contactBrief, computeForQuery, weeklyFocus } from "./compute";
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

  it("does NOT treat a hallucinated funnel stage as 'no filter' (R4) — it falls through instead of dumping all", () => {
    // A junk/magic stage that isn't a real funnel stage must NOT silently widen to the WHOLE network narrated
    // as that subset (the old "by design" widening bug). With no other filter it returns null so answer()
    // falls through to the grounded path. (It also must never be used as a dynamic/prototype key.)
    expect(runTool({ tool: "findContacts", args: { stage: "__proto__" } }, d, TODAY)).toBeNull();
    expect(runTool({ tool: "findContacts", args: { stage: "hot" } }, d, TODAY)).toBeNull();
    // But an invalid stage ALONGSIDE another real filter still runs (the other filter narrows it).
    expect(runTool({ tool: "findContacts", args: { stage: "hot", decisionRole: true } }, d, TODAY)).not.toBeNull();
    // And no stage at all is fine — all contacts.
    expect(runTool({ tool: "findContacts", args: {} }, d, TODAY)?.rows.length).toBe(2);
  });

  it("honours a VALID funnel stage", () => {
    const responded = runTool({ tool: "findContacts", args: { stage: "responded" } }, d, TODAY);
    expect(responded?.rows.length).toBe(1); // only Christopher responded
  });

  it("maps engagement-status SYNONYMS so 'signed'/'executed' don't zero-match (R4)", () => {
    const withSow = book({ sows: [{ id: "s1", organisation: "Acme", engagement_name: "Audit", status: "Active", recognised_to_date: 5000 } as never] });
    // "signed"/"executed" are synonyms for Active — must find the active engagement, not a confident zero.
    expect(runTool({ tool: "findContracts", args: { status: "signed" } }, withSow, TODAY)?.rows.length).toBe(1);
    expect(runTool({ tool: "findContracts", args: { status: "executed" } }, withSow, TODAY)?.rows.length).toBe(1);
    // An unrecognised word = all engagements (undefined filter), never a false zero.
    expect(runTool({ tool: "findContracts", args: { status: "wibble" } }, withSow, TODAY)?.rows.length).toBe(1);
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

// ── R10: accent/diacritic fold in contact resolution ─────────────────────────────────────────────
describe("resolveContact accent fold (R10)", () => {
  const d = book({ contacts: [contact({ first: "Jose", last: "Fernandez", organisation: "Iberia Capital" })] });
  it("matches an accented query to an unaccented stored name (and vice-versa)", () => {
    expect(resolveContact(d, "José Fernández", TODAY)?.last).toBe("Fernandez");
    expect(resolveContact(d, "jose fernandez", TODAY)?.last).toBe("Fernandez");
  });
});

// ── R7(a): bare shared first name → disambiguate, never silently pick the warmest ────────────────
describe("contactBrief bare-name disambiguation (R7a)", () => {
  const d = book({ contacts: [
    contact({ first: "Jose", last: "Fernandez", organisation: "Iberia Capital" }),
    contact({ first: "Jose", last: "Marquez", organisation: "Banco Sur", url: "https://www.linkedin.com/in/jose-m" }),
  ] });
  it("asks which one when two contacts share a first name", () => {
    const r = contactBrief(d, "Jose", TODAY);
    expect(r.rows.length).toBe(2);
    expect(r.intro).toMatch(/which one/i);
  });
  it("briefs directly when given the full name", () => {
    const r = contactBrief(d, "Jose Marquez", TODAY);
    expect(r.intro).toContain("Jose Marquez");
  });
});

// ── R-E: "who do I know in <sector>" lists that sector, not the whole book ────────────────────────
describe("computeForQuery sector scope (R-E)", () => {
  const d = book({ contacts: [
    contact({ first: "Ed", last: "Grid", organisation: "TotalEnergies", sector_group: "Energy & Industrial" }),
    contact({ first: "Fay", last: "Vault", organisation: "Barclays", sector_group: "Financial Services" }),
  ] });
  it("scopes to the sector rather than dumping every contact", () => {
    const r = computeForQuery("who do I know in energy", d, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/Energy & Industrial/);
    expect(r!.rows.length).toBe(1);
    expect(r!.rows[0].cells[0]).toBe("Ed Grid");
  });
});

// ── R-A: conversational BD phrasings route deterministically, not to the chatty companion ─────────
describe("computeForQuery BD routing (R-A)", () => {
  const d = book({ contacts: [contact()] });
  it("routes 'who did I speak to' and diary/coming-up to the meetings tool (non-null)", () => {
    expect(computeForQuery("who did I speak to in the last two weeks", d, TODAY)).not.toBeNull();
    expect(computeForQuery("what's coming up in my diary", d, TODAY)).not.toBeNull();
  });
  it("routes a vague business-open to the deterministic agenda", () => {
    expect(computeForQuery("where do things stand", d, TODAY)).not.toBeNull();
  });
});

// ── R-D: "what do I know about X" grounds in the book, never a world-knowledge recital ────────────
describe("computeForQuery 'what do I know about' grounding (R-D)", () => {
  const d = book({ contacts: [contact({ first: "Ada", last: "Byron", organisation: "Barclays" })] });
  it("summarises a real account from the book", () => {
    const r = computeForQuery("what do I know about Barclays", d, TODAY);
    expect(r).not.toBeNull();
    expect(JSON.stringify(r)).toMatch(/Barclays/);
  });
  it("gives a grounded not-found for a company not in the book (not null → never the model)", () => {
    const r = computeForQuery("what do I know about Meridain Capitl", d, TODAY);
    expect(r).not.toBeNull();
    expect(r!.intro).toMatch(/no .* in your book|book yet/i);
  });
});

// ── R-F: a fresh import (no dated agenda) still leads with message-derived signal ─────────────────
describe("weeklyFocus fresh-import backfill (R-F)", () => {
  it("surfaces an owed reply when there are no dated actions yet", () => {
    const d = book({ contacts: [contact({
      first: "Owen", last: "Reid", organisation: "Northwind",
      messaged: true, responded: true, two_way: true,
      thread: { lastDate: "2026-06-20", lastFromOwner: false, inboundCount: 1, outboundCount: 1 },
    })] });
    const r = weeklyFocus(d, TODAY);
    expect(r.intro).toMatch(/where I'd start|focus on this week/i);
    expect(JSON.stringify(r.rows)).toMatch(/reply owed/i);
    expect(JSON.stringify(r.rows)).toMatch(/Owen Reid/);
  });
});
