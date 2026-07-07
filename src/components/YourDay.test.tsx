import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Contact } from "../data/contacts";
import type { AgendaItem } from "../data/agenda";
import type { StaleContact } from "../data/dashboard";

// AI OFF: the whole point of the deterministic brief is that it renders with no working model.
// Mock the ai module so useAiAvailable() returns false (aiPrompt is never reached on this path).
vi.mock("../ai/ai", () => ({ useAiAvailable: () => false, aiPrompt: vi.fn() }));

import { YourDay } from "./YourDay";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function contact(over: Partial<Contact> = {}): Contact {
  return {
    first: "Jane", last: "Doe", organisation: "Acme", position: "Manager",
    sector_detail: "", sector_group: "Financial Services", sub_group: "Financial Services",
    seniority: "Manager", function: "Finance & Accounting",
    messaged: true, responded: true, two_way: false, agreed_to_meet: false, met: true,
    url: "https://www.linkedin.com/in/jane", phone: "", ...over,
  };
}
function agendaItem(over: Partial<AgendaItem> = {}): AgendaItem {
  return {
    date: "2026-06-25", daysUntil: -2, overdue: true, kind: "Meeting follow-up",
    who: "Jane Doe", what: "Send the proposal", statusLabel: "Overdue", org: "Acme",
    tab: "meetings", openId: "m1", ...over,
  };
}

const TODAY = "2026-06-27";
const baseProps = {
  today: TODAY, contacts: [] as Contact[], edits: {}, meetingRows: [],
  agenda: [] as AgendaItem[], hotOpps: [], stale: [] as StaleContact[], aging: [],
};

describe("YourDay deterministic brief (AI off)", () => {
  it("renders a structured brief from the signals — not null — with the model unavailable", () => {
    const c = contact();
    const props = {
      ...baseProps,
      contacts: [c],
      agenda: [agendaItem({ what: "Send the proposal", who: "Jane Doe" })],
      stale: [{ contact: c, relationship: "met", daysSince: 61 }],
    };
    act(() => root.render(<YourDay {...props} />));
    const text = container.textContent || "";
    // The card is present (previously it returned null with AI off) and shows the computed items.
    expect(text).toContain("Your day");
    expect(text).toContain("This week");
    expect(text).toContain("Send the proposal");
    expect(text).toContain("Reconnect");
    expect(text).toContain("Jane Doe");
    expect(text).toContain("61d");
  });

  it("points to Freehold AI settings and shows NO Draft chips when AI is off", () => {
    const c = contact();
    const props = { ...baseProps, contacts: [c], stale: [{ contact: c, relationship: "met", daysSince: 50 }] };
    act(() => root.render(<YourDay {...props} />));
    const text = container.textContent || "";
    expect(text).toContain("Freehold AI settings");
    expect(text).not.toContain("Draft →"); // per-item drafting needs the model; hidden when off
  });

  it("shows the empty state when there is no signal at all", () => {
    act(() => root.render(<YourDay {...baseProps} />));
    expect(container.textContent || "").toContain("Nothing pressing today");
  });
});
