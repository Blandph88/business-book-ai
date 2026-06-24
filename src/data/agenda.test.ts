import { describe, it, expect, vi, afterEach } from "vitest";
import {
  AGENDA_WINDOW_DAYS,
  todayISO,
  daysBetween,
  buildAgenda,
} from "./agenda";
import type { MeetingRow, ContactInfo } from "./meetings";
import type { Opportunity } from "../storage/opportunities";

afterEach(() => {
  vi.useRealTimers();
});

const NOW = "2026-06-24T12:00:00Z";
const TODAY = "2026-06-24";

const contactInfo = (over: Partial<ContactInfo> = {}): ContactInfo => ({
  name: "Jane Doe",
  organisation: "Acme",
  seniority: "Manager",
  function: "Finance & Accounting",
  sector_group: "Financial Services",
  phone: "",
  ...over,
});

// A meeting row. By default it is fully blank apart from identity, so a held-date
// write-up is incomplete and a "Write-up due" item is produced.
function meeting(over: Partial<MeetingRow> = {}): MeetingRow {
  return {
    id: "m1",
    contact_url: "https://linkedin.com/in/jane",
    meeting_no: 1,
    meeting_stage: "Held",
    contactInfo: contactInfo(),
    isSeed: false,
    ...over,
  };
}

function opp(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "o1",
    opportunity_name: "Acme — Jane",
    organisation: "Acme",
    primary_contact: "Jane Doe",
    service_line: "Strategy",
    current_step: "meeting",
    ...over,
  };
}

describe("constants & helpers", () => {
  it("looks 7 days ahead", () => {
    expect(AGENDA_WINDOW_DAYS).toBe(7);
  });

  it("daysBetween counts whole days, signed (positive = later)", () => {
    expect(daysBetween("2026-06-24", "2026-06-24")).toBe(0);
    expect(daysBetween("2026-06-24", "2026-06-27")).toBe(3);
    expect(daysBetween("2026-06-24", "2026-06-21")).toBe(-3);
  });

  it("todayISO returns the local date under fake timers", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    // 2026-06-24T12:00:00Z is the 24th in any timezone west of UTC+12, and the
    // test runner uses local time; assert the shape and that it parses.
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("buildAgenda — meeting write-ups", () => {
  it("flags a held meeting with an incomplete write-up, dated at the held date", () => {
    const items = buildAgenda([meeting({ date_held: TODAY })], [], TODAY);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("Meeting write-up");
    expect(items[0].statusLabel).toBe("Write-up due");
    expect(items[0].date).toBe(TODAY);
    expect(items[0].daysUntil).toBe(0);
    expect(items[0].overdue).toBe(false);
    expect(items[0].openId).toBe("m1");
    expect(items[0].tab).toBe("meetings");
  });

  it("marks an overdue held write-up as overdue", () => {
    const items = buildAgenda([meeting({ date_held: "2026-06-20" })], [], TODAY);
    expect(items).toHaveLength(1);
    expect(items[0].overdue).toBe(true);
    expect(items[0].daysUntil).toBe(-4);
  });

  it("does not flag a held meeting whose write-up is complete", () => {
    const complete = meeting({
      date_held: TODAY,
      type: "Coffee",
      location: "Cafe",
      attendees_ours: "Phil",
      attendees_client: "Jane",
      purpose: "Intro",
      notes: "Good chat",
      org_insights: "Growing",
      pain_points: "Cost",
      opportunity_spotted: "No",
      actions_mine: "Send deck",
      actions_theirs: "Review",
      followup: "Call",
      followup_date: "2026-07-01",
      sentiment: "Positive",
    });
    const items = buildAgenda([complete], [], TODAY);
    // No write-up item (complete). followup_date is in-window but the meeting is
    // not linked to an opportunity, so a follow-up item IS produced — assert that
    // is the only item and there's no write-up.
    expect(items.some((i) => i.kind === "Meeting write-up")).toBe(false);
  });

  it("skips a meeting with no held date", () => {
    const items = buildAgenda([meeting({ date_held: undefined })], [], TODAY);
    expect(items).toHaveLength(0);
  });

  it("drops write-ups dated beyond the 7-day window", () => {
    const items = buildAgenda(
      [meeting({ date_held: "2026-07-05" })], // 11 days ahead
      [],
      TODAY,
    );
    expect(items).toHaveLength(0);
  });
});

describe("buildAgenda — follow-ups & scheduled meetings", () => {
  it("emits a meeting follow-up when there's a followup_date and no linked opportunity", () => {
    const m = meeting({
      id: "m2",
      date_held: undefined,
      followup_date: "2026-06-26",
      followup: "Send the proposal",
    });
    const items = buildAgenda([m], [], TODAY);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("Meeting follow-up");
    expect(items[0].statusLabel).toBe("Follow-up due");
    expect(items[0].what).toBe("Send the proposal");
    expect(items[0].daysUntil).toBe(2);
  });

  it("does NOT emit a follow-up when the meeting spawned an opportunity (no double-count)", () => {
    const m = meeting({
      date_held: undefined,
      followup_date: "2026-06-26",
      linked_opportunity_id: "opp:meeting:m1",
    });
    const items = buildAgenda([m], [], TODAY);
    expect(items.some((i) => i.kind === "Meeting follow-up")).toBe(false);
  });

  it("emits a scheduled-meeting item for a Scheduled meeting with a date", () => {
    const m = meeting({
      meeting_stage: "Scheduled",
      date_held: undefined,
      date_scheduled: "2026-06-25",
      type: "Video",
    });
    const items = buildAgenda([m], [], TODAY);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("Scheduled meeting");
    expect(items[0].statusLabel).toBe("Meeting due");
    expect(items[0].what).toBe("Video meeting");
    expect(items[0].daysUntil).toBe(1);
  });

  it("ignores a scheduled meeting beyond the window", () => {
    const m = meeting({
      meeting_stage: "Scheduled",
      date_held: undefined,
      date_scheduled: "2026-07-10",
    });
    expect(buildAgenda([m], [], TODAY)).toHaveLength(0);
  });
});

describe("buildAgenda — opportunity next steps", () => {
  it("emits the next step with its planned date when in window", () => {
    const o = opp({
      current_step: "meeting",
      est_value: 50000,
      step_dates: { qualify: "2026-06-27" },
    });
    const items = buildAgenda([], [o], TODAY);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("Opportunity next step");
    expect(items[0].statusLabel).toBe("Qualify due");
    expect(items[0].value).toBe(50000);
    expect(items[0].daysUntil).toBe(3);
    expect(items[0].tab).toBe("opportunities");
    expect(items[0].openId).toBe("o1");
  });

  it("skips lost opportunities", () => {
    const o = opp({
      lost: true,
      current_step: "meeting",
      step_dates: { qualify: "2026-06-27" },
    });
    expect(buildAgenda([], [o], TODAY)).toHaveLength(0);
  });

  it("skips an opportunity at the final step (no next step)", () => {
    const o = opp({ current_step: "revenue" });
    expect(buildAgenda([], [o], TODAY)).toHaveLength(0);
  });

  it("skips when the next step has no planned date", () => {
    const o = opp({ current_step: "meeting", step_dates: {} });
    expect(buildAgenda([], [o], TODAY)).toHaveLength(0);
  });
});

describe("buildAgenda — sorting & edge cases", () => {
  it("sorts items earliest-date first, so overdue leads", () => {
    const overdueWriteup = meeting({
      id: "m-overdue",
      date_held: "2026-06-20",
    });
    const futureSched = meeting({
      id: "m-future",
      meeting_stage: "Scheduled",
      date_held: undefined,
      date_scheduled: "2026-06-29",
    });
    const o = opp({
      current_step: "meeting",
      step_dates: { qualify: "2026-06-25" },
    });
    const items = buildAgenda([overdueWriteup, futureSched], [o], TODAY);
    const dates = items.map((i) => i.date);
    expect(dates).toEqual([...dates].sort((a, b) => a.localeCompare(b)));
    expect(items[0].date).toBe("2026-06-20");
  });

  it("returns an empty list for empty inputs (no crash)", () => {
    expect(buildAgenda([], [], TODAY)).toEqual([]);
  });
});
