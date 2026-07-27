import { describe, it, expect, beforeEach } from "vitest";
import { composeFlagReport } from "./FlagModal";
import { logFailure, clearFailures } from "../ai/failureLog";

const NOW = Date.UTC(2026, 6, 27, 12, 0, 0);

describe("composeFlagReport", () => {
  beforeEach(() => clearFailures());

  it("includes the question, answer, tier and timing", () => {
    const r = composeFlagReport("How's my pipeline?", "£4.4m open across 20 deals.",
      { aiLabel: "Your own key", aiModel: "gpt-4o-mini", cloud: true, genMs: 8200, genTok: 130, computed: true }, NOW);
    expect(r).toContain("How's my pipeline?");
    expect(r).toContain("£4.4m open across 20 deals.");
    expect(r).toContain("gpt-4o-mini");
    expect(r).toContain("computed table");
    expect(r).toMatch(/~8s/);
    expect(r).toMatch(/Business Book — flagged answer/);
  });

  it("folds in the content-free device diagnostics", () => {
    logFailure({ surface: "copilot-stream", reason: "no-first-token", backend: "byok" });
    const r = composeFlagReport("q", "a", {}, NOW);
    expect(r).toContain("Device diagnostics");
    expect(r).toMatch(/timed out before the model answered/);
  });

  it("handles a missing answer without throwing", () => {
    const r = composeFlagReport("q only", "", {}, NOW);
    expect(r).toContain("(none)");
  });
});
