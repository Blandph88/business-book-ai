import { describe, it, expect } from "vitest";
import { SPECS, relativeDate } from "./actionSpecs";
import type { ActionCtx } from "./actionSpecs";

const TODAY = "2026-07-25";
const baseCtx = (text: string, over: Partial<ActionCtx> = {}): ActionCtx => ({
  op: "create", text, subjectUrl: undefined, targetId: undefined, today: TODAY,
  contacts: [], meetingRows: [], opps: [], sows: [], skipModel: true, ...over,
} as ActionCtx);

describe("Batch2-E: meeting extraction (retest #29 verbatim)", () => {
  const TEXT = "Log that I bumped into Karen OConnor at a conference this morning and we agreed to catch up properly next month.";
  it("past-tense wins: Held + today, despite the 'next month' follow-up clause", async () => {
    const v = await SPECS.meeting.extract(baseCtx(TEXT));
    expect(v.meeting_stage).toBe("Held");
    expect(v.date_held).toBe(TODAY);
  });
  it("notes drop the command wrapper", async () => {
    const v = await SPECS.meeting.extract(baseCtx(TEXT));
    expect(v.notes).not.toMatch(/^log that/i);
    expect(v.notes).toMatch(/bumped into Karen/i);
  });
});

describe("Batch2-E: opportunity update payload (retest #31/#43)", () => {
  const GOOGLE = { id: "o1", opportunity_name: "Google — Operations engagement", organisation: "Google", primary_contact: "Camille Williams", service_line: "Operations", current_step: "scoping", est_value: 800000, probability: 0.25, lost: false } as unknown as ActionCtx["opps"][number];
  it("'Move the Google deal to Proposal Build' → current_step lands on the card", async () => {
    const v = await SPECS.opportunity.extract(baseCtx("Move the Google deal to Proposal Build.", { op: "update", targetId: "o1", opps: [GOOGLE] }));
    expect(v.current_step).toBe("proposal_build");
  });
  it("'Close the Chevron Strategy deal as won and note the £90k invoice' → won, value UNCHANGED, note lands", async () => {
    const CHEV = { ...GOOGLE, id: "o2", opportunity_name: "Chevron — Strategy engagement", organisation: "Chevron", est_value: 250000 } as typeof GOOGLE;
    const v = await SPECS.opportunity.extract(baseCtx("Close the Chevron Strategy deal as won and note the £90k invoice", { op: "update", targetId: "o2", opps: [CHEV] }));
    expect(v.outcome).toBe("Won");
    expect(v.est_value).toBe("250000"); // the £90k must NOT clobber the deal value
    expect(v.description).toMatch(/£90k invoice/i);
  });
  it("create pre-suggests the conventional name", async () => {
    const v = await SPECS.opportunity.extract(baseCtx("New opportunity — data migration project at ExxonMobil worth £40k", {
      contacts: [{ first: "Karen", last: "OConnor", organisation: "ExxonMobil", url: "u1" } as unknown as ActionCtx["contacts"][number]],
    }));
    expect(v.opportunity_name).toMatch(/ExxonMobil — .* engagement/);
  });
});

describe("Batch2-E: contact update — reminders + moves (retest #33/#44)", () => {
  it("'Remind me to chase the JPMorgan proposal next Friday' → parsed date + cleaned action", async () => {
    const v = await SPECS.contact.extract(baseCtx("Remind me to chase the JPMorgan proposal next Friday.", { op: "update", subjectUrl: "u1" }));
    expect(v.next_action).toMatch(/chase the JPMorgan proposal/i);
    expect(v.next_action).not.toMatch(/next friday/i);
    expect(v.next_action_date).toBe(relativeDate(TODAY, "next Friday"));
    expect(v.next_action_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("'switching to the Madrid office in October' → based_in Madrid", async () => {
    const v = await SPECS.contact.extract(baseCtx("Note on Daniel Garcia — he's switching to the Madrid office in October.", { op: "update", subjectUrl: "u1" }));
    expect(v.based_in).toBe("Madrid");
    expect(v.notes).toMatch(/Madrid/);
  });
});
