import { describe, it, expect } from "vitest";
import { detectOrphans, type Orphan } from "./orphans";
import type { Contact } from "./contacts";
import type { OwnerEdits } from "../storage/ownerEdits";
import type { Meeting } from "../storage/meetings";
import type { Opportunity } from "../storage/opportunities";

function contact(url: string): Contact {
  return {
    first: "A",
    last: "B",
    organisation: "Acme",
    position: "Manager",
    sector_detail: "",
    sector_group: "Technology",
    sub_group: "",
    seniority: "Manager",
    function: "Technology & Engineering",
    messaged: false,
    responded: false,
    two_way: false,
    agreed_to_meet: false,
    met: false,
    url,
    phone: "",
  };
}

function meeting(url: string, no = 1): Meeting {
  return {
    id: `${url}#${no}`,
    contact_url: url,
    meeting_no: no,
    meeting_stage: "Held",
  };
}

function opp(url: string | undefined, over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "o-" + (url ?? "manual"),
    opportunity_name: "Deal",
    organisation: "Acme",
    primary_contact: "Jane",
    service_line: "Strategy",
    current_step: "pursuit",
    contact_url: url,
    ...over,
  };
}

const PRESENT = "https://x.com/in/present";
const MISSING = "https://x.com/in/missing";

describe("detectOrphans — owner edits", () => {
  it("flags a non-empty edit pointing at a missing contact", () => {
    const edits: Record<string, OwnerEdits> = { [MISSING]: { notes: "important" } };
    const out = detectOrphans([contact(PRESENT)], edits, [], []);
    expect(out).toEqual<Orphan[]>([
      { kind: "Contact note", label: MISSING, url: MISSING },
    ]);
  });

  it("does NOT flag an edit whose contact is still present", () => {
    const edits: Record<string, OwnerEdits> = { [PRESENT]: { notes: "ok" } };
    expect(detectOrphans([contact(PRESENT)], edits, [], [])).toEqual([]);
  });

  it("does NOT flag an empty {} edit (nothing worth keeping)", () => {
    const edits: Record<string, OwnerEdits> = { [MISSING]: {} };
    expect(detectOrphans([], edits, [], [])).toEqual([]);
  });

  it('does NOT flag an edit whose fields are all "" or undefined', () => {
    const edits: Record<string, OwnerEdits> = {
      [MISSING]: { notes: "", next_action: undefined },
    };
    expect(detectOrphans([], edits, [], [])).toEqual([]);
  });

  it("ignores sample/example.com urls (demo leftovers)", () => {
    const edits: Record<string, OwnerEdits> = {
      "https://www.example.com/in/sample": { notes: "demo" },
    };
    expect(detectOrphans([], edits, [], [])).toEqual([]);
  });
});

describe("detectOrphans — meetings", () => {
  it("flags a meeting whose contact is missing", () => {
    const out = detectOrphans([contact(PRESENT)], {}, [meeting(MISSING, 2)], []);
    expect(out).toEqual<Orphan[]>([
      { kind: "Meeting", label: "Meeting #2", url: MISSING },
    ]);
  });

  it("does not flag a meeting whose contact is present", () => {
    expect(detectOrphans([contact(PRESENT)], {}, [meeting(PRESENT)], [])).toEqual([]);
  });

  it("ignores sample-url meetings", () => {
    expect(
      detectOrphans([], {}, [meeting("https://example.com/in/x")], []),
    ).toEqual([]);
  });

  it("ignores a meeting with no contact_url", () => {
    const m = meeting(MISSING);
    m.contact_url = "";
    expect(detectOrphans([], {}, [m], [])).toEqual([]);
  });
});

describe("detectOrphans — opportunities", () => {
  it("flags a contact-linked opportunity whose contact is missing", () => {
    const out = detectOrphans([], {}, [], [opp(MISSING, { opportunity_name: "Big deal" })]);
    expect(out).toEqual<Orphan[]>([
      { kind: "Opportunity", label: "Big deal", url: MISSING },
    ]);
  });

  it("does NOT flag a manual opportunity with no contact_url", () => {
    expect(detectOrphans([], {}, [], [opp(undefined)])).toEqual([]);
  });

  it("falls back the label to organisation then url when name is blank", () => {
    const out = detectOrphans([], {}, [], [opp(MISSING, { opportunity_name: "", organisation: "Acme Corp" })]);
    expect(out[0].label).toBe("Acme Corp");
  });

  it("ignores sample-url opportunities", () => {
    expect(detectOrphans([], {}, [], [opp("https://example.com/in/x")])).toEqual([]);
  });
});

describe("detectOrphans — combined", () => {
  it("returns orphans across all three kinds together", () => {
    const out = detectOrphans(
      [contact(PRESENT)],
      { [MISSING]: { notes: "n" } },
      [meeting(MISSING, 3)],
      [opp(MISSING, { opportunity_name: "Deal X" })],
    );
    expect(out.map((o) => o.kind).sort()).toEqual([
      "Contact note",
      "Meeting",
      "Opportunity",
    ]);
  });

  it("returns [] when everything maps to a present contact", () => {
    const out = detectOrphans(
      [contact(PRESENT)],
      { [PRESENT]: { notes: "n" } },
      [meeting(PRESENT)],
      [opp(PRESENT)],
    );
    expect(out).toEqual([]);
  });
});
