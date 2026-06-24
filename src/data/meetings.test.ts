import { describe, it, expect } from "vitest";
import {
  heldContactUrls,
  deriveContactInfo,
  meetingId,
  buildMeetingRows,
  meetingMissingFields,
  meetingIsComplete,
  lastMetByUrl,
  nextMeetingNo,
  type MeetingRow,
} from "./meetings";
import type { Contact } from "./contacts";
import type { Meeting } from "../storage/meetings";

// ── Small fixture helpers ─────────────────────────────────────────────────────
function contact(over: Partial<Contact> = {}): Contact {
  return {
    first: "Jane",
    last: "Doe",
    organisation: "Acme",
    position: "Manager",
    sector_detail: "Acme Ltd",
    sector_group: "Technology",
    sub_group: "Technology",
    seniority: "Manager",
    function: "Technology & Engineering",
    messaged: false,
    responded: false,
    two_way: false,
    agreed_to_meet: false,
    met: false,
    url: "https://li/jane",
    phone: "",
    ...over,
  };
}

function meeting(over: Partial<Meeting> = {}): Meeting {
  return {
    id: "https://li/jane#1",
    contact_url: "https://li/jane",
    meeting_no: 1,
    meeting_stage: "Held",
    ...over,
  };
}

// ── meetingId ─────────────────────────────────────────────────────────────────
describe("meetingId", () => {
  it("is the deterministic `${url}#${no}` form", () => {
    expect(meetingId("https://li/jane", 1)).toBe("https://li/jane#1");
    expect(meetingId("u", 3)).toBe("u#3");
  });
});

// ── heldContactUrls ───────────────────────────────────────────────────────────
describe("heldContactUrls", () => {
  it("returns only the contact urls of Held meetings", () => {
    const set = heldContactUrls({
      a: meeting({ id: "a", contact_url: "u1", meeting_stage: "Held" }),
      b: meeting({ id: "b", contact_url: "u2", meeting_stage: "Scheduled" }),
      c: meeting({ id: "c", contact_url: "u3", meeting_stage: "Held" }),
    });
    expect(set).toEqual(new Set(["u1", "u3"]));
  });

  it("is empty for no meetings", () => {
    expect(heldContactUrls({})).toEqual(new Set());
  });
});

// ── deriveContactInfo ─────────────────────────────────────────────────────────
describe("deriveContactInfo", () => {
  it("returns placeholder facts for a missing contact", () => {
    expect(deriveContactInfo(undefined)).toEqual({
      name: "(unknown contact)",
      organisation: "—",
      seniority: "—",
      function: "—",
      sector_group: "—",
      phone: "",
    });
  });

  it("joins first + last (trimmed) and copies the read-only facts", () => {
    const info = deriveContactInfo(
      contact({ first: "Jane", last: "Doe", phone: "966557312825" }),
    );
    expect(info.name).toBe("Jane Doe");
    expect(info.organisation).toBe("Acme");
    expect(info.seniority).toBe("Manager");
    expect(info.function).toBe("Technology & Engineering");
    expect(info.sector_group).toBe("Technology");
    expect(info.phone).toBe("966557312825");
  });

  it("trims a name with a missing last part", () => {
    expect(deriveContactInfo(contact({ first: "Cher", last: "" })).name).toBe(
      "Cher",
    );
  });

  it("defaults phone to '' when undefined on the contact", () => {
    const c = contact();
    // simulate an older contact row lacking phone
    delete (c as Partial<Contact>).phone;
    expect(deriveContactInfo(c).phone).toBe("");
  });
});

// ── buildMeetingRows ──────────────────────────────────────────────────────────
describe("buildMeetingRows", () => {
  it("returns [] for no contacts and no saved meetings", () => {
    expect(buildMeetingRows([], {})).toEqual([]);
  });

  it("synthesises a virtual seed for each agreed-to-meet contact", () => {
    const c = contact({ url: "u1", agreed_to_meet: true });
    const rows = buildMeetingRows([c], {});
    expect(rows).toHaveLength(1);
    expect(rows[0].isSeed).toBe(true);
    expect(rows[0].id).toBe(meetingId("u1", 1));
    expect(rows[0].meeting_no).toBe(1);
    expect(rows[0].meeting_stage).toBe("Agreed - not scheduled");
    expect(rows[0].contactInfo.name).toBe("Jane Doe");
  });

  it("does NOT seed contacts that have not agreed to meet", () => {
    const rows = buildMeetingRows([contact({ agreed_to_meet: false })], {});
    expect(rows).toEqual([]);
  });

  it("keeps a saved meeting and suppresses the seed once materialised", () => {
    const c = contact({ url: "u1", agreed_to_meet: true });
    const saved = {
      [meetingId("u1", 1)]: meeting({
        id: meetingId("u1", 1),
        contact_url: "u1",
        meeting_no: 1,
        meeting_stage: "Held",
      }),
    };
    const rows = buildMeetingRows([c], saved);
    expect(rows).toHaveLength(1);
    expect(rows[0].isSeed).toBe(false);
    expect(rows[0].meeting_stage).toBe("Held");
  });

  it("derives contact info live and flags an unknown contact for an orphan meeting", () => {
    const saved = {
      x: meeting({ id: "x", contact_url: "gone", meeting_no: 1 }),
    };
    const rows = buildMeetingRows([], saved);
    expect(rows).toHaveLength(1);
    expect(rows[0].isSeed).toBe(false);
    expect(rows[0].contactInfo.name).toBe("(unknown contact)");
  });

  it("sorts by contact name then meeting_no", () => {
    const alice = contact({ url: "ua", first: "Alice", last: "A", agreed_to_meet: true });
    const bob = contact({ url: "ub", first: "Bob", last: "B", agreed_to_meet: true });
    const saved = {
      [meetingId("ub", 2)]: meeting({
        id: meetingId("ub", 2),
        contact_url: "ub",
        meeting_no: 2,
      }),
      [meetingId("ub", 1)]: meeting({
        id: meetingId("ub", 1),
        contact_url: "ub",
        meeting_no: 1,
      }),
    };
    const rows = buildMeetingRows([bob, alice], saved);
    // Alice (seed) sorts before Bob's two meetings, which sort 1 then 2.
    expect(rows.map((r) => [r.contactInfo.name, r.meeting_no])).toEqual([
      ["Alice A", 1],
      ["Bob B", 1],
      ["Bob B", 2],
    ]);
  });
});

// ── meetingMissingFields / meetingIsComplete ──────────────────────────────────
describe("meetingMissingFields", () => {
  it("lists every required field label for an empty meeting", () => {
    const missing = meetingMissingFields({});
    expect(missing).toContain("Type");
    expect(missing).toContain("Location");
    expect(missing).toContain("Sentiment");
    expect(missing).toHaveLength(14);
  });

  it("treats whitespace-only values as missing", () => {
    expect(meetingMissingFields({ purpose: "   " })).toContain("Purpose");
  });

  it("excludes a field once it has a non-blank value", () => {
    const missing = meetingMissingFields({ type: "Coffee", location: "Cafe" });
    expect(missing).not.toContain("Type");
    expect(missing).not.toContain("Location");
    expect(missing).toHaveLength(12);
  });

  it("does not require the opportunity link", () => {
    expect(meetingMissingFields({})).not.toContain("Opportunity link");
  });
});

describe("meetingIsComplete", () => {
  it("is false when any required field is blank", () => {
    expect(meetingIsComplete({ type: "Coffee" })).toBe(false);
  });

  it("is true when every required field is filled", () => {
    const full: Partial<Meeting> = {
      type: "Coffee",
      location: "Cafe",
      attendees_ours: "Phil",
      attendees_client: "Jane",
      purpose: "Intro",
      notes: "Good chat",
      org_insights: "Growing",
      pain_points: "Costs",
      opportunity_spotted: "Yes",
      actions_mine: "Follow up",
      actions_theirs: "Send deck",
      followup: "Yes",
      followup_date: "2026-07-01",
      sentiment: "Positive",
    };
    expect(meetingIsComplete(full)).toBe(true);
  });
});

// ── lastMetByUrl ──────────────────────────────────────────────────────────────
describe("lastMetByUrl", () => {
  function row(over: Partial<MeetingRow>): MeetingRow {
    return {
      ...meeting(over),
      contactInfo: deriveContactInfo(undefined),
      isSeed: false,
      ...over,
    } as MeetingRow;
  }

  it("is empty when no meeting has a held date", () => {
    expect(lastMetByUrl([row({ contact_url: "u1" })])).toEqual({});
  });

  it("keeps the most recent held date per contact", () => {
    const rows = [
      row({ contact_url: "u1", date_held: "2026-01-01" }),
      row({ contact_url: "u1", date_held: "2026-03-01" }),
      row({ contact_url: "u2", date_held: "2026-02-01" }),
    ];
    expect(lastMetByUrl(rows)).toEqual({
      u1: "2026-03-01",
      u2: "2026-02-01",
    });
  });

  it("ignores rows without a held date", () => {
    const rows = [
      row({ contact_url: "u1", date_held: "2026-01-01" }),
      row({ contact_url: "u1", date_held: undefined }),
    ];
    expect(lastMetByUrl(rows)).toEqual({ u1: "2026-01-01" });
  });
});

// ── nextMeetingNo ─────────────────────────────────────────────────────────────
describe("nextMeetingNo", () => {
  function row(contact_url: string, meeting_no: number): MeetingRow {
    return {
      ...meeting({ contact_url, meeting_no }),
      contactInfo: deriveContactInfo(undefined),
      isSeed: false,
    };
  }

  it("is 1 when the contact has no meetings yet", () => {
    expect(nextMeetingNo("u1", [])).toBe(1);
    expect(nextMeetingNo("u1", [row("u2", 3)])).toBe(1);
  });

  it("is highest-existing + 1 for the contact", () => {
    const rows = [row("u1", 1), row("u1", 3), row("u2", 9)];
    expect(nextMeetingNo("u1", rows)).toBe(4);
  });
});
