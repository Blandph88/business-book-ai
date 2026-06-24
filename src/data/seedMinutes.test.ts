import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchSeedMinutes } from "./seedMinutes";

// A minimal valid compiled-minute fixture.
const fixtureMinute = {
  contact_url: "https://linkedin.com/in/jane",
  meeting_no: 1,
  meeting_stage: "Held",
  opportunity: null,
};

function okResponse(json: unknown) {
  return { ok: true, json: async () => json } as unknown as Response;
}
function notOkResponse(status = 404) {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

describe("fetchSeedMinutes", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches seed_meetings.json and returns the parsed array", async () => {
    const fetchMock = vi.fn(async () => okResponse([fixtureMinute]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSeedMinutes();

    expect(fetchMock).toHaveBeenCalledWith("seed_meetings.json");
    expect(result).toEqual([fixtureMinute]);
  });

  it("returns [] when the response is not ok (file missing)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => notOkResponse()));
    expect(await fetchSeedMinutes()).toEqual([]);
  });

  it("returns [] when the JSON is not an array", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({ not: "an array" })));
    expect(await fetchSeedMinutes()).toEqual([]);
  });

  it("fails soft (returns []) when fetch throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    expect(await fetchSeedMinutes()).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("does not touch localStorage (pure fetch, no apply-once flag)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse([fixtureMinute])));
    await fetchSeedMinutes();
    expect(localStorage.length).toBe(0);
  });
});
