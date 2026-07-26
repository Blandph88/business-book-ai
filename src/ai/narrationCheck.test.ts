import { describe, it, expect } from "vitest";
import { checkNarration, stripForeignGlitch, numericClaims, isDisambiguation } from "./narrationCheck";

// The evidence tables are drawn from the retest transcripts (abbreviated).
const RISK_TABLE = `Open opportunities with NO next meeting booked (20 of 20 open) — the follow-up-debt list, biggest first:
| Operations engagement | Google | Scoping | £800k | 2026-03-25 |
| People & Change engagement | Johnson & Johnson | Scoping | £500k | 2026-06-24 |
| Strategy engagement | KPMG | Proposal Delivery | £75k | 2026-02-11 |`;

describe("Batch2-D: narration trust boundary", () => {
  it("kills the invented 'Six of your £100k+ deals' (retest #17 verbatim)", () => {
    const narration = "Six of your £100k+ deals have gone silent, with the largest being Google at £800k. These stalled engagements could release significant pipeline capacity if addressed promptly.";
    const v = checkNarration(narration, RISK_TABLE);
    expect(v.dropped.length).toBe(1);
    expect(v.dropped[0]).toMatch(/Six of your/);
    expect(v.cleaned).toMatch(/stalled engagements/);
  });
  it("passes a faithful narration (numbers all present)", () => {
    const narration = "Google leads at £800k, with Johnson & Johnson close behind at £500k. Both are still in scoping, so momentum is yours to set.";
    const v = checkNarration(narration, RISK_TABLE);
    expect(v.ok).toBe(true);
    expect(v.dropped.length).toBe(0);
  });
  it("kills a fabricated book statistic ('10 contacts, around 5 keen' — retest #38 shape)", () => {
    const narration = "You currently have a total of 10 contacts in your pipeline. Out of those, around 5 are considered keen.";
    const v = checkNarration(narration, "2,319 contacts in your book — 91 met.");
    expect(v.ok).toBe(false);
  });
  it("date mentions don't count as numeric claims", () => {
    const narration = "Your last meeting was on July 18, 2026 and it went well.";
    const v = checkNarration(narration, "| 2026-07-18 | Olivia Thomas | HSBC | Positive |");
    expect(v.dropped.length).toBe(0);
  });
  it("small counts covered by visible rows pass ('both deals')", () => {
    const narration = "Both deals sit at the same stage, which is worth a look.";
    const v = checkNarration(narration, "| a | b |\n| c | d |");
    expect(v.dropped.length).toBe(0);
  });
  it("scale-tolerant matching: £800k narration vs 800000 evidence", () => {
    expect(numericClaims("£800k")).toContain("800000");
    const v = checkNarration("The Google deal at £800k stands out.", "Est. value 800000 at Google.");
    expect(v.dropped.length).toBe(0);
  });
  it("disambiguation detection", () => {
    expect(isDisambiguation("You know 45 people called Rachel — which one did you mean?")).toBe(true);
    expect(isDisambiguation("Your biggest open opportunities by value:")).toBe(false);
  });
});

describe("Re-verify additions: sentiment-pairing check", () => {
  const MEETINGS_TABLE = `| 2026-07-22 | Hannah Singh | General Electric | Very Positive |
| 2026-07-21 | Anders Stewart | General Electric | Positive |
| 2026-07-19 | Olivia Thomas | HSBC | Positive |
| 2026-07-18 | Camille Singh | HSBC | Cautious |
| 2026-07-17 | Sophie Miller | Amazon | Neutral |`;
  it("kills the GE-neutral garble (re-verify item 2, verbatim shape)", () => {
    const v = checkNarration("A few companies like General Electric and Amazon have multiple neutral sentiments, suggesting mixed reactions.", MEETINGS_TABLE);
    expect(v.dropped.length).toBe(1);
  });
  it("kills the HSBC-Very-Positive garble (item 4 shape)", () => {
    const v = checkNarration("There's an encouraging number of Very Positive engagements, especially with General Electric and HSBC.", MEETINGS_TABLE);
    expect(v.dropped.length).toBe(1);
  });
  it("passes faithful pairings", () => {
    const v = checkNarration("Hannah Singh at General Electric came away Very Positive, while Camille Singh at HSBC read Cautious.", MEETINGS_TABLE);
    expect(v.dropped.length).toBe(0);
  });
});

// ── AUDIT SWEEP (2026-07-25): the planned org-pairing half of the trust boundary ──────────────────
describe("org-pairing check: person-at-company claims must match a real row", () => {
  const EV = [
    "Your open deals:",
    "| Karen OConnor | ExxonMobil | 40000 |",
    "| Marcus Webb | Google | 800000 |",
  ].join("\n");
  it("drops a sentence binding a person to the WRONG company", () => {
    const v = checkNarration("Karen OConnor at Google leads the list. Worth chasing this week.", EV);
    expect(v.dropped.some((s) => /Karen OConnor at Google/.test(s))).toBe(true);
  });
  it("keeps the faithful pairing", () => {
    const v = checkNarration("Karen OConnor at ExxonMobil leads the list. Worth chasing this week.", EV);
    expect(v.dropped.length).toBe(0);
  });
  it("two entities merely co-mentioned (no binding preposition) survive", () => {
    const v = checkNarration("Karen OConnor and Marcus Webb both look live. Worth chasing this week.", EV);
    expect(v.dropped.length).toBe(0);
  });
});

describe("header rows are chrome, not evidence (re-verify item 4 live run)", () => {
  const EV = [
    "Meetings you held in the last two weeks (4):",
    "| Date | Contact | Company | Sentiment |",
    "| --- | --- | --- | --- |",
    "| 2026-07-22 | Hannah Singh | General Electric | Very Positive |",
    "| 2026-07-19 | Olivia Thomas | HSBC | Positive |",
    "| 2026-07-18 | Camille Singh | HSBC | Cautious |",
    "| 2026-07-24 | Daniel Garcia | Confluent | Neutral |",
  ].join("\n");
  it("healthy sentences containing 'sentiment'/'contacts' are NOT flagged via header cells", () => {
    const v = checkNarration(
      "A few neutral interactions might indicate areas needing follow-up to shift sentiment. Want me to review the neutral contacts for potential next steps?",
      EV,
    );
    expect(v.dropped.length).toBe(0);
  });
  it("the real garble still drops: Very Positive paired with HSBC whose rows are Positive/Cautious", () => {
    const v = checkNarration(
      "Notably, there's an encouraging number of Very Positive engagements, especially with General Electric and HSBC. A busy fortnight overall with plenty to build on.",
      EV,
    );
    expect(v.dropped.some((x) => /HSBC/.test(x))).toBe(true);
    expect(v.cleaned).toMatch(/busy fortnight/);
  });
});

describe("stripForeignGlitch: Qwen code-switch sentences drop, clean text unchanged", () => {
  it("drops the CJK-contaminated sentence and keeps the rest", () => {
    const out = stripForeignGlitch("Index funds can be a good option. Are you looking for something\u7a33\u5065\u7684\u56de\u7b54\uff0c\u8ba9\u6211\u4eec\u91cd\u65b0\u5f00\u59cb: Let me restart. What matters is your risk tolerance.");
    expect(out).toMatch(/Index funds can be a good option/);
    expect(out).toMatch(/risk tolerance/);
    expect(out).not.toMatch(/[\u4e00-\u9fff]/);
  });
  it("clean English text passes through untouched", () => {
    const t = "A perfectly ordinary reply. Nothing to strip here.";
    expect(stripForeignGlitch(t)).toBe(t);
  });
});
