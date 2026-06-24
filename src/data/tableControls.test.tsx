import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  useTableControls,
  type ControlsConfig,
  type ControlsInitial,
  type ControlsProps,
} from "./tableControls";

// Tell React this is a valid act() environment (silences the act-support warning).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// useTableControls is a React hook. We drive it through a tiny host component rendered
// with react-dom into jsdom, capturing its return value each render so assertions can
// inspect the filtered rows and controlsProps, and invoke the setters via act().

type Row = { name: string; priority: string; value: number };

const ROWS: Row[] = [
  { name: "Mohammed  M Alqahtani", priority: "High", value: 30 },
  { name: "Jane Doe", priority: "Low", value: 10 },
  { name: "John Smith", priority: "High", value: 20 },
];

const CONFIG: ControlsConfig<Row> = {
  searchText: (r) => `${r.name} ${r.priority}`,
  filters: [
    { key: "priority", label: "Priority", options: ["High", "Low"], get: (r) => r.priority },
  ],
  sorts: [
    { key: "name", label: "Name", get: (r) => r.name },
    { key: "value", label: "Value", get: (r) => r.value },
  ],
  defaultSortKey: "name",
  defaultSortDir: "asc",
};

let container: HTMLDivElement;
let root: Root;
let latest: { filtered: Row[]; controlsProps: ControlsProps };

function Host({ rows, initial }: { rows: Row[]; initial?: ControlsInitial }) {
  const result = useTableControls(rows, CONFIG, initial);
  latest = result;
  return null;
}

function render(rows: Row[], initial?: ControlsInitial) {
  act(() => {
    root.render(<Host rows={rows} initial={initial} />);
  });
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useTableControls — default state", () => {
  it("returns all rows sorted by the default sort (name asc)", () => {
    render(ROWS);
    expect(latest.filtered.map((r) => r.name)).toEqual([
      "Jane Doe",
      "John Smith",
      "Mohammed  M Alqahtani",
    ]);
    expect(latest.controlsProps.total).toBe(3);
    expect(latest.controlsProps.shown).toBe(3);
    expect(latest.controlsProps.isActive).toBe(false);
  });
});

describe("search", () => {
  it("case-insensitive substring filter over searchText", () => {
    render(ROWS);
    act(() => latest.controlsProps.setQuery("jane"));
    expect(latest.filtered.map((r) => r.name)).toEqual(["Jane Doe"]);
    expect(latest.controlsProps.isActive).toBe(true);
    expect(latest.controlsProps.shown).toBe(1);
  });

  it("collapses double spaces so a single-spaced query matches a double-spaced row", () => {
    render(ROWS);
    act(() => latest.controlsProps.setQuery("Mohammed M Alqahtani"));
    expect(latest.filtered.map((r) => r.name)).toEqual(["Mohammed  M Alqahtani"]);
  });

  it("a no-match query yields no rows", () => {
    render(ROWS);
    act(() => latest.controlsProps.setQuery("zzzzz"));
    expect(latest.filtered).toEqual([]);
  });
});

describe("filters", () => {
  it("an exact categorical filter narrows the rows", () => {
    render(ROWS);
    act(() => latest.controlsProps.setFilter("priority", "High"));
    expect(latest.filtered.map((r) => r.name).sort()).toEqual([
      "John Smith",
      "Mohammed  M Alqahtani",
    ]);
    expect(latest.controlsProps.isActive).toBe(true);
  });

  it('a blank filter ("") is ignored', () => {
    render(ROWS);
    act(() => latest.controlsProps.setFilter("priority", ""));
    expect(latest.filtered).toHaveLength(3);
    expect(latest.controlsProps.isActive).toBe(false);
  });
});

describe("sorting", () => {
  it("sorts numerically when the sort getter returns numbers", () => {
    render(ROWS);
    act(() => latest.controlsProps.setSortKey("value"));
    expect(latest.filtered.map((r) => r.value)).toEqual([10, 20, 30]);
  });

  it("toggleSortDir flips the order", () => {
    render(ROWS);
    act(() => latest.controlsProps.setSortKey("value"));
    act(() => latest.controlsProps.toggleSortDir());
    expect(latest.filtered.map((r) => r.value)).toEqual([30, 20, 10]);
  });

  it("sortBy a new column sorts ascending; clicking it again flips direction", () => {
    render(ROWS);
    act(() => latest.controlsProps.sortBy("value"));
    expect(latest.controlsProps.sortKey).toBe("value");
    expect(latest.controlsProps.sortDir).toBe("asc");
    expect(latest.filtered.map((r) => r.value)).toEqual([10, 20, 30]);

    act(() => latest.controlsProps.sortBy("value"));
    expect(latest.controlsProps.sortDir).toBe("desc");
    expect(latest.filtered.map((r) => r.value)).toEqual([30, 20, 10]);
  });
});

describe("reset", () => {
  it("clears query and filters and restores the default sort", () => {
    render(ROWS);
    act(() => latest.controlsProps.setQuery("john"));
    act(() => latest.controlsProps.setFilter("priority", "High"));
    act(() => latest.controlsProps.setSortKey("value"));
    act(() => latest.controlsProps.reset());

    expect(latest.controlsProps.query).toBe("");
    expect(latest.controlsProps.filterValues).toEqual({});
    expect(latest.controlsProps.sortKey).toBe("name");
    expect(latest.controlsProps.sortDir).toBe("asc");
    expect(latest.controlsProps.isActive).toBe(false);
    expect(latest.filtered).toHaveLength(3);
  });
});

describe("initial state (deep-link seeding)", () => {
  it("applies an initial query, filter and sort on mount", () => {
    render(ROWS, {
      query: "",
      filters: { priority: "High" },
      sortKey: "value",
      sortDir: "desc",
    });
    expect(latest.controlsProps.filterValues).toEqual({ priority: "High" });
    expect(latest.controlsProps.sortKey).toBe("value");
    expect(latest.filtered.map((r) => r.value)).toEqual([30, 20]);
  });
});

describe("derived controlsProps", () => {
  it("exposes filterDefs and sortDefs mirroring the config", () => {
    render(ROWS);
    expect(latest.controlsProps.filterDefs).toEqual([
      { key: "priority", label: "Priority", options: ["High", "Low"] },
    ]);
    expect(latest.controlsProps.sortDefs).toEqual([
      { key: "name", label: "Name" },
      { key: "value", label: "Value" },
    ]);
  });
});
