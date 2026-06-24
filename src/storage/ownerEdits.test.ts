import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  normalizeUrl,
  editsFor,
  loadAllEdits,
  saveEdits,
  type OwnerEdits,
} from "./ownerEdits";

const KEY = "bob.contactOwnerEdits.v1";

beforeEach(() => {
  localStorage.clear();
  // Silence/avoid the disk-sync fetch firing real requests.
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("{}", { status: 200 }),
  );
});

describe("normalizeUrl", () => {
  it("trims, lowercases, drops query string and trailing slashes", () => {
    expect(normalizeUrl("  https://www.LinkedIn.com/in/Jane/  ")).toBe(
      "https://www.linkedin.com/in/jane",
    );
    expect(normalizeUrl("https://x.com/in/jane?tracking=1")).toBe(
      "https://x.com/in/jane",
    );
    expect(normalizeUrl("https://x.com/in/jane///")).toBe("https://x.com/in/jane");
  });

  it("treats null/undefined as empty string", () => {
    expect(normalizeUrl(undefined as unknown as string)).toBe("");
    expect(normalizeUrl(null as unknown as string)).toBe("");
  });
});

describe("loadAllEdits", () => {
  it("returns an empty object when nothing is stored", () => {
    expect(loadAllEdits()).toEqual({});
  });

  it("returns {} and does not throw on malformed JSON", () => {
    localStorage.setItem(KEY, "{not valid json");
    expect(() => loadAllEdits()).not.toThrow();
    expect(loadAllEdits()).toEqual({});
  });

  it("reads back what was stored under the bob.* key", () => {
    const data = { "https://x.com/in/jane": { notes: "hi" } };
    localStorage.setItem(KEY, JSON.stringify(data));
    expect(loadAllEdits()).toEqual(data);
  });
});

describe("saveEdits + editsFor round-trip", () => {
  it("saves under the normalised url and reads it back", () => {
    const edits: OwnerEdits = { notes: "key contact", priority: "High" as OwnerEdits["priority"] };
    const all = saveEdits("https://X.com/in/Jane/?ref=1", edits);

    // Stored under the normalised key.
    expect(all["https://x.com/in/jane"]).toEqual(edits);
    // Persisted to the correct localStorage key.
    expect(loadAllEdits()["https://x.com/in/jane"]).toEqual(edits);
    // editsFor normalises the lookup url the same way.
    expect(editsFor(all, "https://X.com/in/Jane")).toEqual(edits);
  });

  it("merges/upserts: a second contact's edits do not clobber the first", () => {
    saveEdits("https://x.com/in/a", { notes: "A" });
    const all = saveEdits("https://x.com/in/b", { notes: "B" });
    expect(Object.keys(all)).toHaveLength(2);
    expect(editsFor(all, "https://x.com/in/a")?.notes).toBe("A");
    expect(editsFor(all, "https://x.com/in/b")?.notes).toBe("B");
  });

  it("overwrites the same contact's edits on re-save", () => {
    saveEdits("https://x.com/in/a", { notes: "first" });
    const all = saveEdits("https://x.com/in/a", { notes: "second" });
    expect(editsFor(all, "https://x.com/in/a")?.notes).toBe("second");
    expect(Object.keys(all)).toHaveLength(1);
  });

  it("editsFor returns undefined for an unknown url", () => {
    expect(editsFor({}, "https://x.com/in/nobody")).toBeUndefined();
  });
});
