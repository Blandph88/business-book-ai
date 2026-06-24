import { describe, it, expect, afterEach } from "vitest";
import { seedToMeeting, seedToOpportunity, mergeSeedMinutes } from "./importMinutes";
import { meetingId } from "./meetings";
import { opportunityIdForMeeting } from "./opportunities";
import { loadAllMeetings, saveAllMeetings } from "../storage/meetings";
import { loadAllOpportunities, saveAllOpportunities } from "../storage/opportunities";
import { planStepDates } from "./timeline";
import type { SeedMinute, SeedOpportunity } from "./seedMinutes";
import type { Contact } from "./contacts";

// ── Fixtures ──────────────────────────────────────────────────────────────────
function seed(over: Partial<SeedMinute> = {}): SeedMinute {
  return {
    contact_url: "https://li/jane",
    meeting_no: 1,
    meeting_stage: "Held",
    opportunity: null,
    ...over,
  };
}

function seedOpp(over: Partial<SeedOpportunity> = {}): SeedOpportunity {
  return {
    opportunity_name: "Acme deal",
    service_line: "Technology",
    ...over,
  };
}

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

afterEach(() => {
  localStorage.clear();
});

// ── seedToMeeting ─────────────────────────────────────────────────────────────
describe("seedToMeeting", () => {
  it("maps the minute fields onto a Meeting with the deterministic id", () => {
    const m = seedToMeeting(
      seed({
        contact_url: "https://li/jane",
        meeting_no: 2,
        meeting_stage: "Held",
        date_agreed: "2026-05-01",
        date_scheduled: "2026-05-10",
        date_held: "2026-05-15",
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
        followup_date: "2026-06-01",
        sentiment: "Positive",
      }),
    );
    expect(m.id).toBe(meetingId("https://li/jane", 2));
    expect(m.contact_url).toBe("https://li/jane");
    expect(m.meeting_no).toBe(2);
    expect(m.meeting_stage).toBe("Held");
    expect(m.date_held).toBe("2026-05-15");
    expect(m.type).toBe("Coffee");
    expect(m.notes).toBe("Good chat");
    expect(m.sentiment).toBe("Positive");
  });

  it("sets linked_opportunity_id only when the minute carries an opportunity", () => {
    expect(seedToMeeting(seed({ opportunity: null })).linked_opportunity_id).toBeUndefined();
    const linked = seedToMeeting(
      seed({ contact_url: "u1", meeting_no: 1, opportunity: seedOpp() }),
    );
    expect(linked.linked_opportunity_id).toBe(
      opportunityIdForMeeting(meetingId("u1", 1)),
    );
  });
});

// ── seedToOpportunity ─────────────────────────────────────────────────────────
describe("seedToOpportunity", () => {
  const contacts = new Map([["https://li/jane", contact()]]);

  it("returns null when the minute spotted no opportunity", () => {
    expect(seedToOpportunity(seed({ opportunity: null }), contacts)).toBeNull();
  });

  it("maps the richer opportunity fields and derives org/contact/function/sector", () => {
    const o = seedToOpportunity(
      seed({
        date_held: "2026-06-01",
        opportunity: seedOpp({
          opportunity_name: "Big deal",
          service_line: "Strategy",
          description: "Scope it",
          est_value: 50000,
          probability: 0.5,
        }),
      }),
      contacts,
    )!;
    expect(o.id).toBe(opportunityIdForMeeting(meetingId("https://li/jane", 1)));
    expect(o.opportunity_name).toBe("Big deal");
    expect(o.organisation).toBe("Acme");
    expect(o.primary_contact).toBe("Jane Doe");
    expect(o.service_line).toBe("Strategy");
    expect(o.function).toBe("Technology & Engineering");
    expect(o.sector_group).toBe("Technology");
    expect(o.est_value).toBe(50000);
    expect(o.probability).toBe(0.5);
    expect(o.source_meeting_id).toBe(meetingId("https://li/jane", 1));
    expect(o.contact_url).toBe("https://li/jane");
  });

  it("places at the explicit step when given a valid one", () => {
    const o = seedToOpportunity(
      seed({ opportunity: seedOpp({ step: "scoping" }) }),
      contacts,
    )!;
    expect(o.current_step).toBe("scoping");
  });

  it("maps a legacy coarse stage to a workflow step", () => {
    const o = seedToOpportunity(
      seed({ opportunity: seedOpp({ stage: "SoW Signed" }) }),
      contacts,
    )!;
    expect(o.current_step).toBe("contracting");
  });

  it("falls back to the first pursuit step for an unknown step/stage", () => {
    const o = seedToOpportunity(
      seed({ opportunity: seedOpp({ step: "nonsense", stage: "Made Up" }) }),
      contacts,
    )!;
    expect(o.current_step).toBe("pursuit");
  });

  it("derives lost from an explicit flag or a Lost stage", () => {
    expect(
      seedToOpportunity(seed({ opportunity: seedOpp({ lost: true }) }), contacts)!.lost,
    ).toBe(true);
    expect(
      seedToOpportunity(seed({ opportunity: seedOpp({ stage: "Lost" }) }), contacts)!
        .lost,
    ).toBe(true);
    expect(
      seedToOpportunity(seed({ opportunity: seedOpp() }), contacts)!.lost,
    ).toBeUndefined();
  });

  it("anchors the planned timeline to the meeting date", () => {
    const o = seedToOpportunity(
      seed({ date_held: "2026-06-01", opportunity: seedOpp() }),
      contacts,
    )!;
    expect(o.step_dates).toEqual(planStepDates("2026-06-01"));
  });
});

// ── mergeSeedMinutes ──────────────────────────────────────────────────────────
describe("mergeSeedMinutes", () => {
  it("adds new meetings + opportunities and persists them", () => {
    const seeds = [
      seed({ contact_url: "u1", meeting_no: 1, opportunity: seedOpp() }),
      seed({ contact_url: "u2", meeting_no: 1, opportunity: null }),
    ];
    const res = mergeSeedMinutes(seeds, [contact({ url: "u1" }), contact({ url: "u2" })]);
    expect(res.addedMeetings).toBe(2);
    expect(res.addedOpportunities).toBe(1);

    const meetings = loadAllMeetings();
    expect(Object.keys(meetings)).toHaveLength(2);
    expect(meetings[meetingId("u1", 1)]).toBeDefined();

    const opps = loadAllOpportunities();
    expect(Object.keys(opps)).toHaveLength(1);
  });

  it("applies each seed AT MOST ONCE (no re-add on a repeat load)", () => {
    const seeds = [seed({ contact_url: "u1", meeting_no: 1, opportunity: seedOpp() })];
    const contacts = [contact({ url: "u1" })];
    const first = mergeSeedMinutes(seeds, contacts);
    expect(first.addedMeetings).toBe(1);
    const second = mergeSeedMinutes(seeds, contacts);
    expect(second).toEqual({ addedMeetings: 0, addedOpportunities: 0 });
  });

  it("does not resurrect a deleted seed on the next load", () => {
    const seeds = [seed({ contact_url: "u1", meeting_no: 1 })];
    const contacts = [contact({ url: "u1" })];
    mergeSeedMinutes(seeds, contacts);
    // owner deletes the meeting
    const all = loadAllMeetings();
    delete all[meetingId("u1", 1)];
    saveAllMeetings(all);
    // re-running must NOT bring it back (applied-id set remembers it)
    const res = mergeSeedMinutes(seeds, contacts);
    expect(res.addedMeetings).toBe(0);
    expect(loadAllMeetings()[meetingId("u1", 1)]).toBeUndefined();
  });

  it("does not clobber a record the owner already holds under that id", () => {
    const mid = meetingId("u1", 1);
    saveAllMeetings({
      [mid]: {
        id: mid,
        contact_url: "u1",
        meeting_no: 1,
        meeting_stage: "Held",
        notes: "owner's own notes",
      },
    });
    const res = mergeSeedMinutes(
      [seed({ contact_url: "u1", meeting_no: 1, notes: "seed notes" })],
      [contact({ url: "u1" })],
    );
    expect(res.addedMeetings).toBe(0);
    expect(loadAllMeetings()[mid].notes).toBe("owner's own notes");
  });

  it("does not duplicate an opportunity already present under the deterministic id", () => {
    const mid = meetingId("u1", 1);
    const oid = opportunityIdForMeeting(mid);
    saveAllOpportunities({
      [oid]: {
        id: oid,
        opportunity_name: "existing",
        organisation: "Acme",
        primary_contact: "Jane Doe",
        service_line: "Strategy",
        current_step: "scoping",
      },
    });
    const res = mergeSeedMinutes(
      [seed({ contact_url: "u1", meeting_no: 1, opportunity: seedOpp() })],
      [contact({ url: "u1" })],
    );
    expect(res.addedOpportunities).toBe(0);
    expect(loadAllOpportunities()[oid].opportunity_name).toBe("existing");
  });

  it("returns 0/0 for an empty seed list", () => {
    expect(mergeSeedMinutes([], [])).toEqual({
      addedMeetings: 0,
      addedOpportunities: 0,
    });
  });
});
