import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CardEmpty } from "./CardEmpty";

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

describe("CardEmpty", () => {
  it("renders the guiding message and a CTA that fires", () => {
    const onCta = vi.fn();
    act(() => root.render(<CardEmpty message="No opportunities yet — add one." ctaLabel="Go to Opportunities →" onCta={onCta} />));
    expect(container.textContent).toContain("No opportunities yet");
    const btn = container.querySelector("button")!;
    expect(btn.textContent).toContain("Go to Opportunities");
    act(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onCta).toHaveBeenCalledOnce();
  });

  it("renders no button when no CTA is given", () => {
    act(() => root.render(<CardEmpty message="Nothing here yet." />));
    expect(container.querySelector("button")).toBeNull();
  });
});
