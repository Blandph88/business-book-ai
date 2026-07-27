import { describe, it, expect, beforeEach } from "vitest";
import { logFailure, listFailures, clearFailures, failuresReportText } from "./failureLog";

describe("failureLog", () => {
  beforeEach(() => clearFailures());

  it("appends metadata-only entries and reads them back", () => {
    logFailure({ surface: "copilot", reason: "no-first-token", backend: "byok", ms: 61000 });
    const list = listFailures();
    expect(list.length).toBe(1);
    expect(list[0].surface).toBe("copilot");
    expect(list[0].reason).toBe("no-first-token");
    expect(typeof list[0].at).toBe("number");
  });

  it("caps the ring buffer at 200, keeping the newest", () => {
    for (let i = 0; i < 260; i++) logFailure({ surface: `s${i}`, reason: "error" });
    const list = listFailures();
    expect(list.length).toBe(200);
    expect(list[list.length - 1].surface).toBe("s259"); // newest kept
    expect(list[0].surface).toBe("s60"); // oldest 60 dropped
  });

  it("report is content-free and reads newest-first", () => {
    logFailure({ surface: "yourday", reason: "mid-stream-stall", backend: "ollama" });
    const txt = failuresReportText(Date.now());
    expect(txt).toMatch(/yourday/);
    expect(txt).toMatch(/stalled mid-answer/);
  });

  it("empty log reports honestly", () => {
    expect(failuresReportText(Date.now())).toMatch(/No failures recorded/);
  });
});
