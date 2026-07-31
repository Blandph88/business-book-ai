import { describe, it, expect, vi, beforeEach } from "vitest";

// F6 regression suite: the older Freehold vault round-tripped the owned book through CSV with
// blind type coercion, so STRING fields that merely look numeric/boolean reloaded as numbers/
// booleans (a company literally named "54", every digits-only phone, a chat message of "42") and
// crashed every ?.trim() render — Contacts and Chats blanked with no error. These tests pin the
// lossless String() healing at every store's read boundary.

vi.hoisted(() => {
  (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__ = true;
});

import { healStr, healOptStr } from "./safeRead";
import { healContactStrings, type Contact } from "../data/contacts";
import { loadAllEdits } from "./ownerEdits";
import { loadAllMeetings } from "./meetings";
import { loadAllOpportunities } from "./opportunities";
import { listChats } from "./chats";

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
});

const baseContact: Contact = {
  first: "Gayathri", last: "Nair", organisation: "54", position: "Accountant",
  sector_detail: "", sector_group: "Professional Services", sub_group: "", seniority: "Analyst",
  function: "Finance", messaged: true, responded: false, two_way: false,
  agreed_to_meet: false, met: false, url: "https://linkedin.com/in/x", phone: "966557312825",
};

describe("healStr / healOptStr", () => {
  it("restores mangled numbers and booleans to their exact original text", () => {
    expect(healStr(54)).toBe("54");
    expect(healStr(true)).toBe("true");
    expect(healStr(966557312825)).toBe("966557312825");
    expect(healStr("already fine")).toBe("already fine");
    expect(healStr(null)).toBe("");
    expect(healOptStr(54)).toBe("54");
    expect(healOptStr(undefined)).toBeUndefined();
    expect(healOptStr(null)).toBeUndefined();
  });
});

describe("healContactStrings", () => {
  it("repairs a vault-mangled contact losslessly", () => {
    const poisoned = { ...baseContact, organisation: 54, phone: 966557312825 } as unknown as Contact;
    const healed = healContactStrings(poisoned);
    expect(healed.organisation).toBe("54");
    expect(healed.phone).toBe("966557312825");
    // The exact crash: organisation?.trim() must work again.
    expect(healed.organisation?.trim()).toBe("54");
  });

  it("returns the SAME reference for a clean row (no per-load allocation on a 26k book)", () => {
    expect(healContactStrings(baseContact)).toBe(baseContact);
  });
});

describe("store read boundaries heal mangled strings", () => {
  it("ownerEdits: a digits-only phone stored as a number comes back as a string", () => {
    localStorage.setItem(
      "bob.contactOwnerEdits.v1",
      JSON.stringify({ "https://linkedin.com/in/x": { phone: 447900123456, notes: 42 } }),
    );
    const edits = loadAllEdits()["https://linkedin.com/in/x"];
    expect(edits.phone).toBe("447900123456");
    expect(edits.notes).toBe("42");
    expect(edits.phone?.trim()).toBe("447900123456");
  });

  it("meetings: numeric-looking notes fields come back as strings", () => {
    localStorage.setItem(
      "bob.meetings.v2",
      JSON.stringify({ "u#1": { id: "u#1", contact_url: "u", meeting_no: 1, meeting_stage: "Held", notes: 42, purpose: true } }),
    );
    const m = loadAllMeetings()["u#1"];
    expect(m.notes).toBe("42");
    expect(m.purpose).toBe("true");
  });

  it("opportunities: a numeric organisation comes back as a string (RevenueForm crash site)", () => {
    localStorage.setItem(
      "bob.opportunities.v2",
      JSON.stringify({ o1: { id: "o1", opportunity_name: 2026, organisation: 54, primary_contact: "X", service_line: "Strategy", current_step: "pursuit" } }),
    );
    const o = loadAllOpportunities()["o1"];
    expect(o.organisation).toBe("54");
    expect(o.opportunity_name).toBe("2026");
    expect(o.organisation?.trim()).toBe("54");
  });

  it("chats: a message that is just a number renders as text again (chats.ts title/turn crash site)", () => {
    localStorage.setItem(
      "bob.chats.v1",
      JSON.stringify([{ id: "c1", title: 42, createdAt: 1, updatedAt: 2, turns: [{ role: "you", text: 42 }] }]),
    );
    const chat = listChats()[0];
    expect(chat.title).toBe("42");
    expect(chat.turns[0].text).toBe("42");
    expect(chat.turns[0].text?.trim()).toBe("42");
  });
});
