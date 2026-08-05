import { describe, it, expect } from "vitest";
import { buildTourSteps, TOUR_STEPS } from "./Tutorial";

// The tour is data-gated: the demo seeds meetings/opps/engagements so it walks the whole app,
// but an owned book that's only imported connections + messages should skip the steps that would
// spotlight empty tabs (same idea as the data-gated empty cards).
const ids = (has: { meetings: boolean; opportunities: boolean; engagements: boolean }) =>
  buildTourSteps(has).map((s) => s.id);

describe("buildTourSteps", () => {
  it("shows the FULL tour when everything is populated (the demo)", () => {
    const steps = buildTourSteps({ meetings: true, opportunities: true, engagements: true });
    expect(steps.length).toBe(TOUR_STEPS.length);
    // and it's the unmodified finish (still points at 'sample data')
    expect(steps.find((s) => s.id === "finish")?.title).toBe("That’s the tour");
  });

  it("drops the empty tabs for a fresh import (contacts + messages only)", () => {
    const got = ids({ meetings: false, opportunities: false, engagements: false });
    // the network/contacts steps that light up from connections + messages stay
    for (const keep of ["welcome", "import-button", "met-funnel", "met-followups", "contacts-list", "dash-net-funnel"]) {
      expect(got).toContain(keep);
    }
    // every meetings / opportunities / engagements / opp-derived step is gone
    for (const drop of [
      "meetings-stats", "meetings-list",
      "opps-stats", "opps-list",
      "rev-stats", "rev-list", "rev-form",
      "met-opp-phase", "met-opp-breakdowns",
      "dash-week", "dash-opp-funnel", "dash-hygiene",
    ]) {
      expect(got).not.toContain(drop);
    }
    // the finish is swapped for the forward-looking one (not the "sample data" copy)
    expect(buildTourSteps({ meetings: false, opportunities: false, engagements: false })
      .find((s) => s.id === "finish")?.title).toBe("You’re set up");
  });

  it("shows opportunity steps once there are deals, still hides meetings/engagements", () => {
    const got = ids({ meetings: false, opportunities: true, engagements: false });
    for (const keep of ["opps-list", "met-opp-phase", "dash-opp-funnel", "dash-week", "dash-hygiene"]) {
      expect(got).toContain(keep);
    }
    for (const drop of ["meetings-list", "rev-list"]) {
      expect(got).not.toContain(drop);
    }
  });
});
