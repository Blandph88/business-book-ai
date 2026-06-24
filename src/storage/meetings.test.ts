import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadAllMeetings,
  saveAllMeetings,
  saveMeeting,
  deleteMeeting,
  type Meeting,
} from "./meetings";

const KEY = "bob.meetings.v2";

function mtg(id: string, over: Partial<Meeting> = {}): Meeting {
  return {
    id,
    contact_url: `https://x.com/in/${id}`,
    meeting_no: 1,
    meeting_stage: "Agreed - not scheduled",
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("{}", { status: 200 }),
  );
});

describe("loadAllMeetings", () => {
  it("returns {} when nothing stored", () => {
    expect(loadAllMeetings()).toEqual({});
  });

  it("returns {} and does not throw on malformed JSON", () => {
    localStorage.setItem(KEY, "{broken");
    expect(() => loadAllMeetings()).not.toThrow();
    expect(loadAllMeetings()).toEqual({});
  });

  it("uses the bob.meetings.v2 key", () => {
    saveMeeting(mtg("m1"));
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });
});

describe("saveMeeting / round-trip", () => {
  it("saves and reads back the same meeting", () => {
    const m = mtg("m1", { notes: "kickoff", meeting_stage: "Held" });
    saveMeeting(m);
    expect(loadAllMeetings()["m1"]).toEqual(m);
  });

  it("upserts: a second meeting does not clobber the first", () => {
    saveMeeting(mtg("m1"));
    const all = saveMeeting(mtg("m2"));
    expect(Object.keys(all).sort()).toEqual(["m1", "m2"]);
  });

  it("overwrites a meeting saved under the same id", () => {
    saveMeeting(mtg("m1", { notes: "v1" }));
    const all = saveMeeting(mtg("m1", { notes: "v2" }));
    expect(all["m1"].notes).toBe("v2");
    expect(Object.keys(all)).toHaveLength(1);
  });
});

describe("saveAllMeetings", () => {
  it("replaces the whole map in one write", () => {
    saveMeeting(mtg("old"));
    const fresh = { m1: mtg("m1"), m2: mtg("m2") };
    saveAllMeetings(fresh);
    expect(loadAllMeetings()).toEqual(fresh);
    expect(loadAllMeetings()["old"]).toBeUndefined();
  });
});

describe("deleteMeeting", () => {
  it("removes one meeting and leaves the rest", () => {
    saveMeeting(mtg("m1"));
    saveMeeting(mtg("m2"));
    const all = deleteMeeting("m1");
    expect(all["m1"]).toBeUndefined();
    expect(all["m2"]).toBeDefined();
    expect(loadAllMeetings()["m1"]).toBeUndefined();
  });

  it("is a no-op for an unknown id", () => {
    saveMeeting(mtg("m1"));
    const all = deleteMeeting("nope");
    expect(Object.keys(all)).toEqual(["m1"]);
  });
});
