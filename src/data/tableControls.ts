// Reusable search / filter / sort logic for any table in the app.
//
// WHY this exists: every CRM tab (Contacts, Meetings, Opportunities, Revenue) and
// the Dashboard drill-down list share the same need — let the owner narrow a long
// list by typing, by picking categorical values, and by re-ordering columns. Rather
// than re-implement that four times, each list declares a small CONFIG (what text is
// searchable, which filters to offer, which sorts) and calls this one hook. The hook
// holds the control state and returns the filtered+sorted rows plus the props the
// shared <TableControls> component needs to render the UI.
//
// IMPORTANT (CLAUDE.md §6): this is a VIEW concern only. It never mutates the data
// and the Dashboard/Metrics breakdowns still compute from the FULL dataset, so the
// nested-funnel and sum-to-total reconciliation rules are unaffected.

import { useMemo, useState } from "react";

// One filter dropdown: a labelled <select> whose options are categorical values, and
// a `get` that pulls the row's value to compare against the chosen option.
export type FilterDef<T> = {
  key: string; // stable id (used as the React key and state key)
  label: string; // shown above the dropdown, e.g. "Priority"
  options: readonly string[]; // the dropdown choices (usually a vocab.ts constant)
  get: (row: T) => string; // the row's value in this dimension ("" = no value)
};

// One sort option. `get` returns the comparable value; strings sort with
// localeCompare, numbers numerically. Booleans should be mapped to a number in `get`.
export type SortDef<T> = {
  key: string;
  label: string;
  get: (row: T) => string | number;
};

export type SortDir = "asc" | "desc";

// The per-list configuration. Only `searchText` is required; a list can offer search
// only, filters only, sorts only, or any mix.
export type ControlsConfig<T> = {
  searchText: (row: T) => string; // concatenated text the search box matches against
  searchPlaceholder?: string;
  filters?: FilterDef<T>[];
  sorts?: SortDef<T>[];
  defaultSortKey?: string; // preselected sort (e.g. Opportunities → weighted)
  defaultSortDir?: SortDir; // default "asc"
};

// Optional initial control state — used to seed the controls from a cross-tab deep link
// (e.g. the Dashboard sends "filter Agreed = Yes"). Applied once on mount only.
export type ControlsInitial = {
  query?: string;
  filters?: Record<string, string>;
  sortKey?: string;
  sortDir?: SortDir;
};

// Everything <TableControls> needs to render the toolbar and report state back.
export type ControlsProps = {
  query: string;
  setQuery: (q: string) => void;
  searchPlaceholder?: string;
  filterDefs: { key: string; label: string; options: readonly string[] }[];
  filterValues: Record<string, string>;
  setFilter: (key: string, value: string) => void;
  sortDefs: { key: string; label: string }[];
  sortKey: string;
  sortDir: SortDir;
  setSortKey: (key: string) => void;
  toggleSortDir: () => void;
  // Click-to-sort a column: sort by `key`, or flip direction if it's already the sort.
  sortBy: (key: string) => void;
  shown: number; // rows after filtering
  total: number; // rows before filtering
  isActive: boolean; // any search/filter applied? (controls the "Clear" button)
  reset: () => void;
};

// The hook. Give it the full rows and a config; get back the rows to render plus the
// props to spread onto <TableControls>.
export function useTableControls<T>(
  rows: T[],
  config: ControlsConfig<T>,
  initial?: ControlsInitial,
) {
  // Lazy initial state so a deep-link's preset search/filter/sort applies on mount.
  const [query, setQuery] = useState(() => initial?.query ?? "");
  const [filterValues, setFilterValues] = useState<Record<string, string>>(
    () => initial?.filters ?? {},
  );
  const [sortKey, setSortKey] = useState(
    () => initial?.sortKey ?? config.defaultSortKey ?? "",
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    () => initial?.sortDir ?? config.defaultSortDir ?? "asc",
  );

  // Filter then sort. Recomputed when the rows or any control changes. (At a couple
  // of hundred rows this is instant, so we keep it simple and don't memoise harder.)
  const filtered = useMemo(() => {
    // Normalise whitespace (collapse any run of spaces/tabs to one) as well as case.
    // The LinkedIn export leaves stray leading/trailing/double spaces in some names
    // and orgs, so without this a contact like "Mohammed  M Alqahtani" (two spaces)
    // would never match a typed "Mohammed M Alqahtani". We apply the SAME squashing to
    // both the query and the row text so they line up.
    const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const q = squash(query);

    const out = rows.filter((row) => {
      // Free-text search: case-insensitive substring over the row's searchable text.
      if (q && !squash(config.searchText(row)).includes(q)) return false;
      // Every active filter must match exactly. A blank filter ("") is ignored.
      for (const f of config.filters ?? []) {
        const chosen = filterValues[f.key];
        if (chosen && f.get(row) !== chosen) return false;
      }
      return true;
    });

    const sort = (config.sorts ?? []).find((s) => s.key === sortKey);
    if (sort) {
      const dir = sortDir === "asc" ? 1 : -1;
      out.sort((a, b) => {
        const av = sort.get(a);
        const bv = sort.get(b);
        if (typeof av === "number" && typeof bv === "number") {
          return (av - bv) * dir;
        }
        return String(av).localeCompare(String(bv)) * dir;
      });
    }
    return out;
    // config is rebuilt each render (inline object); including it is correct and the
    // cost is negligible at this data size.
  }, [rows, query, filterValues, sortKey, sortDir, config]);

  function setFilter(key: string, value: string) {
    setFilterValues((prev) => ({ ...prev, [key]: value }));
  }
  function toggleSortDir() {
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  }
  // Click-to-sort: a new column sorts ascending; clicking the active column flips it.
  function sortBy(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }
  function reset() {
    setQuery("");
    setFilterValues({});
    setSortKey(config.defaultSortKey ?? "");
    setSortDir(config.defaultSortDir ?? "asc");
  }

  const isActive =
    query.trim() !== "" || Object.values(filterValues).some((v) => v !== "");

  const controlsProps: ControlsProps = {
    query,
    setQuery,
    searchPlaceholder: config.searchPlaceholder,
    filterDefs: (config.filters ?? []).map((f) => ({
      key: f.key,
      label: f.label,
      options: f.options,
    })),
    filterValues,
    setFilter,
    sortDefs: (config.sorts ?? []).map((s) => ({ key: s.key, label: s.label })),
    sortKey,
    sortDir,
    setSortKey,
    toggleSortDir,
    sortBy,
    shown: filtered.length,
    total: rows.length,
    isActive,
    reset,
  };

  return { filtered, controlsProps };
}
