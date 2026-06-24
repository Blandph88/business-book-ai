import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StatsBar, type Stat } from "./StatsBar";

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

function render(stats: Stat[], variant?: "cards" | "chips") {
  act(() => root.render(<StatsBar stats={stats} variant={variant} />));
}
// Find the rendered stat element (button or div) whose label matches.
function statEl(label: string): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>(".statsbar-stat")].find((e) =>
    e.textContent?.includes(label),
  );
}

describe("StatsBar", () => {
  it("renders a plain stat (no onSelect) as a non-interactive div", () => {
    render([{ label: "People met", value: 82 }]);
    const el = statEl("People met")!;
    expect(el.tagName).toBe("DIV");
    expect(el.className).not.toContain("statsbar-stat--selectable");
    expect(el.textContent).toContain("82");
  });

  it("renders a selectable, non-active stat as a clickable button that fires onSelect", () => {
    const onSelect = vi.fn();
    render([{ label: "Messaged", value: 757, onSelect }]);
    const el = statEl("Messaged")!;
    expect(el.tagName).toBe("BUTTON");
    expect(el.className).toContain("statsbar-stat--selectable");
    act(() => el.click());
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders the ACTIVE stat as a non-clickable div even though it has onSelect", () => {
    const onSelect = vi.fn();
    render([{ label: "Messaged", value: 757, onSelect, active: true }]);
    const el = statEl("Messaged")!;
    expect(el.tagName).toBe("DIV"); // not a button → not clickable
    expect(el.className).toContain("statsbar-stat--active");
    expect(el.getAttribute("aria-current")).toBe("true");
    act(() => el.click()); // clicking the div must not invoke the handler
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("marks a highlighted stat with the --hl class", () => {
    render([{ label: "Weighted pipeline", value: "$6.4M", highlight: true }]);
    expect(statEl("Weighted pipeline")!.className).toContain("statsbar-stat--hl");
  });

  it("applies the chips variant class to the container", () => {
    render([{ label: "All", value: 20, onSelect: () => {} }], "chips");
    expect(container.querySelector(".statsbar")!.className).toContain("statsbar--chips");
  });

  it("supports a mixed bar (some selectable, one plain) — e.g. the Meetings tab", () => {
    render([
      { label: "Meetings", value: 128, onSelect: () => {}, active: true },
      { label: "Scheduled", value: 23, onSelect: () => {} },
      { label: "Held", value: 82, onSelect: () => {} },
      { label: "People met", value: 82 }, // display-only
    ]);
    expect(statEl("Meetings")!.tagName).toBe("DIV"); // active → div
    expect(statEl("Scheduled")!.tagName).toBe("BUTTON");
    expect(statEl("Held")!.tagName).toBe("BUTTON");
    const people = statEl("People met")!;
    expect(people.tagName).toBe("DIV");
    expect(people.className).not.toContain("statsbar-stat--selectable");
  });
});
