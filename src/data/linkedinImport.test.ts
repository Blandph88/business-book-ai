import { describe, it, expect } from "vitest";
import {
  normalizeUrl,
  parseConnections,
  parseMessages,
  importLinkedIn,
  carryOverEnrichment,
} from "./linkedinImport";
import type { Contact } from "./contacts";

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────
// A real LinkedIn Connections.csv begins with a "Notes:" preamble, a quoted note, and a blank
// line BEFORE the real header row.
const PREAMBLE = [
  "Notes:",
  '"When exporting your connection data, you may notice that some of the',
  'fields are empty. ..."',
  "",
];

const CONN_HEADER = "First Name,Last Name,URL,Email Address,Company,Position,Connected On";

function connFile(rows: string[], withPreamble = true): string {
  const body = [CONN_HEADER, ...rows].join("\n");
  return withPreamble ? [...PREAMBLE, body].join("\n") : body;
}

// Profile URLs
const OWNER = "https://www.linkedin.com/in/owner";
const ANA = "https://www.linkedin.com/in/ana-msg"; // owner messaged, no reply
const BEN = "https://www.linkedin.com/in/ben-rep"; // replied (responded)
const CAS = "https://www.linkedin.com/in/cas-agree"; // proposed-to + affirmed (agreed)

const MSG_HEADER =
  "CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,SUBJECT,CONTENT,FOLDER";

// papaparse handles quoting; wrap CONTENT in quotes since it contains commas/keywords.
function msgRow(
  convId: string,
  senderUrl: string,
  recipientUrls: string,
  content: string,
): string {
  const c = `"${content.replace(/"/g, '""')}"`;
  return `${convId},Title,From Name,${senderUrl},To Name,${recipientUrls},2026-01-01,Subject,${c},INBOX`;
}

function msgFile(rows: string[]): string {
  return [MSG_HEADER, ...rows].join("\n");
}

// ── normalizeUrl ───────────────────────────────────────────────────────────────────────────
describe("normalizeUrl", () => {
  it("returns '' for undefined/empty", () => {
    expect(normalizeUrl(undefined)).toBe("");
    expect(normalizeUrl("")).toBe("");
  });

  it("lowercases, trims, strips query/hash and trailing slashes", () => {
    expect(normalizeUrl("  HTTPS://www.LinkedIn.com/in/Jane/  ")).toBe(
      "https://www.linkedin.com/in/jane",
    );
    expect(normalizeUrl("https://x.com/in/jane?utm=1")).toBe("https://x.com/in/jane");
    expect(normalizeUrl("https://x.com/in/jane#about")).toBe("https://x.com/in/jane");
    expect(normalizeUrl("https://x.com/in/jane///")).toBe("https://x.com/in/jane");
  });

  it("treats trailing-slash / case / query variants of one person as equal", () => {
    expect(normalizeUrl("https://x.com/in/Jane/")).toBe(normalizeUrl("https://x.com/in/jane?ref=1"));
  });
});

// ── parseConnections ───────────────────────────────────────────────────────────────────────
describe("parseConnections", () => {
  it("strips the 'Notes:' preamble and parses rows from the real header", () => {
    const text = connFile([
      "Jane,Doe,https://x.com/in/jane,jane@x.com,Microsoft,Software Engineer,01 Jan 2024",
    ]);
    const rows = parseConnections(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      first: "Jane",
      last: "Doe",
      company: "Microsoft",
      title: "Software Engineer",
      url: "https://x.com/in/jane",
    });
  });

  it("parses a file WITHOUT a preamble (header is the first line)", () => {
    const text = connFile(
      ["Sam,Smith,https://x.com/in/sam,,Acme,Manager,02 Feb 2024"],
      false,
    );
    const rows = parseConnections(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].first).toBe("Sam");
    expect(rows[0].url).toBe("https://x.com/in/sam");
  });

  it("keeps a no-URL contact via a name-based synthetic key", () => {
    const text = connFile([
      "Jane,Doe,https://x.com/in/jane,,Microsoft,Engineer,01 Jan 2024",
      "Noprofile,Person,,,Acme,Manager,01 Jan 2024",
    ]);
    const rows = parseConnections(text);
    expect(rows).toHaveLength(2); // the no-URL row is KEPT (restricted profiles shouldn't vanish)
    expect(rows[1].first).toBe("Noprofile");
    expect(rows[1].url).toBe("name:noprofile-person");
  });

  it("returns [] for an empty file", () => {
    expect(parseConnections("")).toEqual([]);
  });

  it("returns [] for a header-only file", () => {
    expect(parseConnections(connFile([]))).toEqual([]);
  });

  it("tolerates missing optional columns (Company/Position blank)", () => {
    // header with no Company/Position columns at all
    const text = "First Name,Last Name,URL\nJane,Doe,https://x.com/in/jane";
    const rows = parseConnections(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      first: "Jane",
      last: "Doe",
      company: "",
      title: "",
      url: "https://x.com/in/jane",
    });
  });
});

// ── parseMessages (funnel) ──────────────────────────────────────────────────────────────────
describe("parseMessages", () => {
  it("returns empty sets for empty/blank text", () => {
    const f = parseMessages("");
    expect(f.messaged.size).toBe(0);
    expect(f.responded.size).toBe(0);
    expect(f.agreed.size).toBe(0);
    expect(parseMessages("   ").messaged.size).toBe(0);
  });

  it("auto-detects the owner (most frequent profile URL) and derives the funnel", () => {
    const rows = [
      // owner messages Ana (plain) — messaged only
      msgRow("c1", OWNER, ANA, "Hi Ana, nice to connect."),
      // owner proposes a meeting to Ben
      msgRow("c2", OWNER, BEN, "Want to grab a coffee sometime?"),
      // Ben replies (responded) but does NOT affirm
      msgRow("c2", BEN, OWNER, "Thanks for reaching out."),
      // owner proposes a meeting to Cas
      msgRow("c3", OWNER, CAS, "Shall we jump on a call next week?"),
      // Cas replies and affirms (responded + agreed)
      msgRow("c3", CAS, OWNER, "Sounds great, looking forward to it!"),
    ];
    // make OWNER unambiguously most-frequent: appears in every row (4 sends + as recipient on replies)
    const f = parseMessages(msgFile(rows));

    const nAna = normalizeUrl(ANA);
    const nBen = normalizeUrl(BEN);
    const nCas = normalizeUrl(CAS);

    // messaged: everyone the owner sent to
    expect(f.messaged.has(nAna)).toBe(true);
    expect(f.messaged.has(nBen)).toBe(true);
    expect(f.messaged.has(nCas)).toBe(true);

    // responded: anyone (not owner) who sent a message
    expect(f.responded.has(nAna)).toBe(false);
    expect(f.responded.has(nBen)).toBe(true);
    expect(f.responded.has(nCas)).toBe(true);

    // agreed: proposed-to AND affirmed-in-reply
    expect(f.agreed.has(nBen)).toBe(false); // replied but no affirm keyword
    expect(f.agreed.has(nCas)).toBe(true); // proposed + affirmed
    expect(f.agreed.has(nAna)).toBe(false); // never proposed-to
  });

  it("does not mark agreed when affirmed but never proposed-to", () => {
    const rows = [
      msgRow("c1", OWNER, BEN, "Hi Ben, plain message no proposal."),
      msgRow("c1", BEN, OWNER, "Sounds great!"), // affirms, but owner never proposed
      // pad owner frequency so owner wins detection
      msgRow("c2", OWNER, ANA, "hello"),
    ];
    const f = parseMessages(msgFile(rows));
    expect(f.responded.has(normalizeUrl(BEN))).toBe(true);
    expect(f.agreed.has(normalizeUrl(BEN))).toBe(false);
  });

  it("ignores the owner messaging themselves (self-recipient skipped)", () => {
    const rows = [
      msgRow("c1", OWNER, OWNER, "note to self"),
      msgRow("c2", OWNER, ANA, "hi"),
    ];
    const f = parseMessages(msgFile(rows));
    expect(f.messaged.has(normalizeUrl(OWNER))).toBe(false);
    expect(f.messaged.has(normalizeUrl(ANA))).toBe(true);
  });

  it("treats a message to multiple recipients as a group chat and excludes it from the 1:1 funnel", () => {
    const rows = [
      msgRow("c1", OWNER, `${ANA} ${BEN}`, "hello both"), // 3-participant thread → group
      msgRow("c2", OWNER, CAS, "hi"),                       // a genuine 1:1
    ];
    const f = parseMessages(msgFile(rows));
    // The group thread must NOT mark its members as personally messaged — that's the funnel-poisoning bug.
    expect(f.messaged.has(normalizeUrl(ANA))).toBe(false);
    expect(f.messaged.has(normalizeUrl(BEN))).toBe(false);
    // ...but a real 1:1 message still counts.
    expect(f.messaged.has(normalizeUrl(CAS))).toBe(true);
  });

  it("returns empty sets when there are no profile URLs at all", () => {
    const rows = [
      `c1,Title,From,,To,,2026-01-01,Subj,"hello there",INBOX`,
    ];
    const f = parseMessages(msgFile(rows));
    expect(f.messaged.size).toBe(0);
    expect(f.responded.size).toBe(0);
    expect(f.agreed.size).toBe(0);
  });
});

// ── importLinkedIn (full) ───────────────────────────────────────────────────────────────────
describe("importLinkedIn", () => {
  it("dedupes the same person (URL variants) into one contact", () => {
    const conns = connFile([
      `Jane,Doe,${ANA},,Microsoft,Software Engineer,01 Jan 2024`,
      `Jane,Doe,${ANA}/?utm=foo,,Microsoft,Software Engineer,01 Jan 2024`, // same person, variant URL
    ]);
    const { contacts, counts } = importLinkedIn(conns, "");
    expect(contacts).toHaveLength(1);
    expect(counts.total).toBe(1);
  });

  it("applies the classifier (sector_group / seniority / function populated)", () => {
    const conns = connFile([
      `Jane,Doe,${ANA},,Microsoft,Software Engineer,01 Jan 2024`,
    ]);
    const { contacts } = importLinkedIn(conns, "");
    const c = contacts[0];
    expect(c.sector_group).toBe("Technology");
    expect(c.seniority).toBe("Associate / Analyst");
    expect(c.function).toBe("Technology & Engineering");
    // funnel defaults false when no messages file
    expect(c.messaged).toBe(false);
    expect(c.responded).toBe(false);
    expect(c.two_way).toBe(false);
    expect(c.agreed_to_meet).toBe(false);
    expect(c.met).toBe(false);
    expect(c.phone).toBe("");
  });

  it("joins connections to the funnel and produces the funnel counts", () => {
    const conns = connFile([
      `Ana,A,${ANA},,Acme,Manager,01 Jan 2024`,
      `Ben,B,${BEN},,Globex,Director,01 Jan 2024`,
      `Cas,C,${CAS},,Initech,Analyst,01 Jan 2024`,
    ]);
    const msgs = msgFile([
      msgRow("c1", OWNER, ANA, "Hi Ana, nice to connect."),
      msgRow("c2", OWNER, BEN, "Want to grab a coffee sometime?"),
      msgRow("c2", BEN, OWNER, "Thanks, no plans yet."),
      msgRow("c3", OWNER, CAS, "Shall we jump on a call?"),
      msgRow("c3", CAS, OWNER, "Sounds great, looking forward to it!"),
    ]);
    const { contacts, counts } = importLinkedIn(conns, msgs);
    expect(counts.total).toBe(3);
    expect(counts.messaged).toBe(3);
    expect(counts.responded).toBe(2); // Ben + Cas replied
    expect(counts.agreed).toBe(1); // only Cas

    const byUrl = (u: string) =>
      contacts.find((c) => normalizeUrl(c.url) === normalizeUrl(u))!;
    expect(byUrl(ANA).messaged).toBe(true);
    expect(byUrl(ANA).responded).toBe(false);
    expect(byUrl(BEN).responded).toBe(true);
    expect(byUrl(BEN).two_way).toBe(true);
    expect(byUrl(BEN).agreed_to_meet).toBe(false);
    expect(byUrl(CAS).agreed_to_meet).toBe(true);
  });

  it("defaults all funnel flags to false when messages.csv is absent/empty", () => {
    const conns = connFile([`Ana,A,${ANA},,Acme,Manager,01 Jan 2024`]);
    const { contacts, counts } = importLinkedIn(conns, "");
    expect(counts.messaged).toBe(0);
    expect(counts.responded).toBe(0);
    expect(counts.agreed).toBe(0);
    expect(contacts[0].messaged).toBe(false);
  });

  it("returns no contacts for empty / header-only connections", () => {
    expect(importLinkedIn("", "").contacts).toEqual([]);
    expect(importLinkedIn(connFile([]), "").contacts).toEqual([]);
  });

  it("keeps a no-URL contact (restricted profile) via a synthetic key", () => {
    const conns = connFile([
      `Jane,Doe,${ANA},,Microsoft,Engineer,01 Jan 2024`,
      `Bad,Row,,,NoUrl Co,Manager,01 Jan 2024`,
    ]);
    const { contacts } = importLinkedIn(conns, "");
    expect(contacts).toHaveLength(2); // the no-URL row is kept, not dropped
    expect(contacts.some((c) => c.url === "name:bad-row")).toBe(true);
  });
});

// ── carryOverEnrichment (re-import preserves the LLM scans) ──────────────────────────────────
describe("carryOverEnrichment", () => {
  const warmth = { score: 8, label: "keen", at: "2026-01-01" } as Contact["warmthSentiment"];
  const opp = { text: "wants a CRM", at: "2026-01-01" } as Contact["latentOpp"];

  function freshBook(): Contact[] {
    const conns = connFile([
      `Ana,A,${ANA},,Acme,Manager,01 Jan 2024`,
      `Ben,B,${BEN},,Globex,Director,01 Jan 2024`,
    ]);
    const msgs = msgFile([msgRow("c1", OWNER, ANA, "Hi Ana, nice to connect.")]);
    return importLinkedIn(conns, msgs).contacts;
  }
  const isAna = (c: Contact) => normalizeUrl(c.url) === normalizeUrl(ANA);
  const isBen = (c: Contact) => normalizeUrl(c.url) === normalizeUrl(BEN);

  it("carries warmthSentiment + latentOpp over for a URL-matched contact", () => {
    const fresh = freshBook();
    const prev = freshBook().map((c) => (isAna(c) ? { ...c, warmthSentiment: warmth, latentOpp: opp } : c));
    const out = carryOverEnrichment(fresh, prev);
    expect(out.find(isAna)!.warmthSentiment).toEqual(warmth);
    expect(out.find(isAna)!.latentOpp).toEqual(opp);
    expect(out.find(isBen)!.warmthSentiment).toBeUndefined(); // Ben was never scored
  });

  it("matches across URL variants (trailing slash / query)", () => {
    const fresh = freshBook();
    const prev: Contact[] = [{ ...fresh.find(isAna)!, url: `${ANA}/?utm=x`, warmthSentiment: warmth }];
    expect(carryOverEnrichment(fresh, prev).find(isAna)!.warmthSentiment).toEqual(warmth);
  });

  it("keeps the FRESH thread/inbound (a newer export wins), only carries the scans", () => {
    const fresh = freshBook();
    const freshThread = fresh.find(isAna)!.thread;
    const prev = fresh.map((c) => ({
      ...c,
      thread: { lastDate: "1999-01-01", lastFromOwner: false, inboundCount: 99, outboundCount: 99 },
      warmthSentiment: warmth,
    }));
    const ana = carryOverEnrichment(fresh, prev).find(isAna)!;
    expect(ana.thread).toEqual(freshThread); // stale prev thread NOT copied
    expect(ana.warmthSentiment).toEqual(warmth); // but the expensive scan output is
  });

  it("returns the fresh book unchanged when there's no previous book", () => {
    const fresh = freshBook();
    expect(carryOverEnrichment(fresh, [])).toEqual(fresh);
  });

  it("carries the funnel + thread + inbound when re-importing WITHOUT messages.csv", () => {
    // prev = a book WITH a real two-way thread: owner messaged Ana, Ana replied.
    const prev = importLinkedIn(
      connFile([`Ana,A,${ANA},,Acme,Manager,01 Jan 2024`, `Ben,B,${BEN},,Globex,Director,01 Jan 2024`]),
      msgFile([
        msgRow("c1", OWNER, ANA, "Hi Ana, want to grab a coffee?"),
        msgRow("c1", ANA, OWNER, "Sounds great, would love to!"),
      ]),
    ).contacts;
    const anaPrev = prev.find(isAna)!;
    expect(anaPrev.messaged).toBe(true); // sanity: prev really has funnel
    expect(anaPrev.responded).toBe(true);
    expect(anaPrev.inbound?.length).toBeGreaterThan(0);

    // Connections-only re-import: no messages → empty funnel on the fresh book.
    const connsOnly = importLinkedIn(
      connFile([`Ana,A,${ANA},,Acme,Manager,01 Jan 2024`, `Ben,B,${BEN},,Globex,Director,01 Jan 2024`]),
      "",
    ).contacts;
    expect(connsOnly.find(isAna)!.messaged).toBe(false); // sanity: the fresh book really lost it

    const ana = carryOverEnrichment(connsOnly, prev).find(isAna)!;
    expect(ana.messaged).toBe(true);
    expect(ana.responded).toBe(true);
    expect(ana.thread).toEqual(anaPrev.thread);
    expect(ana.inbound).toEqual(anaPrev.inbound);
  });

  it("unions funnel flags — a Connections-only re-import can't downgrade prior progress", () => {
    const prev = freshBook().map((c) => (isAna(c) ? { ...c, agreed_to_meet: true, met: true } : c));
    const connsOnly = importLinkedIn(connFile([`Ana,A,${ANA},,Acme,Manager,01 Jan 2024`]), "").contacts;
    const ana = carryOverEnrichment(connsOnly, prev).find(isAna)!;
    expect(ana.agreed_to_meet).toBe(true);
    expect(ana.met).toBe(true);
  });
});

// ── Tier-4 import-correctness fixes ─────────────────────────────────────────────────────────
// A message row with an explicit date/time (the default msgRow hardcodes a date-only value).
function msgRowAt(convId: string, senderUrl: string, recipientUrls: string, content: string, date: string): string {
  const c = `"${content.replace(/"/g, '""')}"`;
  return `${convId},Title,From,${senderUrl},To,${recipientUrls},${date},Subject,${c},INBOX`;
}

describe("cold-inbound guard", () => {
  it("does NOT count a reply as 'responded' when the owner never messaged them first", () => {
    // Owner appears as a recipient in two threads (so owner-detection picks them), messages BEN, and a
    // stranger (DAN) cold-messages the owner without the owner ever reaching out.
    const DAN = "https://www.linkedin.com/in/dan-cold";
    const funnel = parseMessages(
      msgFile([
        msgRow("t1", OWNER, BEN, "hi ben"),
        msgRow("t1", BEN, OWNER, "hi back"),
        msgRow("t2", DAN, OWNER, "cold recruiter pitch"),
      ]),
    );
    expect(funnel.responded.has(BEN)).toBe(true);   // genuine two-way
    expect(funnel.responded.has(DAN)).toBe(false);  // cold inbound — not a response to outreach
    expect(funnel.messaged.has(DAN)).toBe(false);
  });
});

describe("same-day owes-a-reply tiebreak", () => {
  it("uses the clock time, not row order, to decide who messaged last that day", () => {
    // BEN replies at 14:00 AFTER the owner's 09:00 message, but the reply row is listed FIRST. The t2 row
    // makes OWNER appear in the most distinct conversations so owner-detection is unambiguous.
    const funnel = parseMessages(
      msgFile([
        msgRowAt("t1", BEN, OWNER, "great, will do", "2026-03-26 14:00:00 UTC"),
        msgRowAt("t1", OWNER, BEN, "let's meet", "2026-03-26 09:00:00 UTC"),
        msgRowAt("t2", OWNER, CAS, "hello", "2026-01-01 09:00:00 UTC"),
      ]),
    );
    // The contact messaged last → the owner owes a reply → lastFromOwner is false.
    expect(funnel.thread.get(BEN)?.lastFromOwner).toBe(false);
  });
});

describe("import warnings", () => {
  it("warns when messages.csv has blank profile URLs (funnel reads empty)", () => {
    // A messages export stripped of profile URLs can't be keyed to anyone → the whole funnel is empty and
    // would look like the owner did no outreach. That silent case must be flagged.
    const res = importLinkedIn(
      connFile([`Ana,A,${ANA},,Acme,Manager,01 Jan 2024`]),
      msgFile([msgRow("t1", "", "", "hi there"), msgRow("t1", "", "", "hello back")]),
    );
    expect(res.warnings.some((w) => /didn't match/i.test(w))).toBe(true);
  });

  it("warns when the connections file has no readable rows", () => {
    const res = importLinkedIn("garbage,header\nwith,no,names", "");
    expect(res.warnings.some((w) => /couldn't read any connections/i.test(w))).toBe(true);
  });
});

describe("non-Latin restricted-profile contact", () => {
  it("keeps a URL-less connection whose name is entirely non-Latin (synthetic key)", () => {
    // No URL column value → must fall back to a name-based key. A fully non-Latin name previously slugged to
    // "" and the contact was dropped.
    const res = importLinkedIn(connFile(["李,伟,,,腾讯,总监,01 Jan 2024"]), "");
    expect(res.contacts.length).toBe(1);
    expect(res.contacts[0].url).toMatch(/^name:/);
  });
});
