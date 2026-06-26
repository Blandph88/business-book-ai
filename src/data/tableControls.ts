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
  // Whether this filter renders as a toolbar dropdown. Default true. Set false for a
  // dimension already covered by a stat-bar quick-filter (e.g. the Contacts funnel
  // booleans) — it stays filterable (the stat sets it) but doesn't clutter the toolbar.
  toolbar?: boolean;
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
  searchText: (row: T) => string; // concatenated text the search box matches against ("All" scope)
  searchPlaceholder?: string;
  // Optional named search SCOPES. When present, the toolbar shows a "search in" selector so a query
  // can target one field (e.g. Company) instead of the whole row — which is what makes "who works at
  // EY" return people AT EY, not people NAMED ey. "All" (searchText) is always the default.
  searchFields?: { key: string; label: string; get: (row: T) => string }[];
  filters?: FilterDef<T>[];
  sorts?: SortDef<T>[];
  defaultSortKey?: string; // preselected sort (e.g. Opportunities → weighted)
  defaultSortDir?: SortDir; // default "asc"
};

// Optional initial control state — used to seed the controls from a cross-tab deep link
// (e.g. the Dashboard sends "filter Agreed = Yes"). Applied once on mount only.
export type ControlsInitial = {
  query?: string;
  searchField?: string; // which named scope to search in (a searchFields key, or "all")
  filters?: Record<string, string>;
  sortKey?: string;
  sortDir?: SortDir;
};

// Everything <TableControls> needs to render the toolbar and report state back.
export type ControlsProps = {
  query: string;
  setQuery: (q: string) => void;
  searchPlaceholder?: string;
  searchFields: { key: string; label: string }[]; // [] when the list has no scope selector
  searchField: string;
  setSearchField: (key: string) => void;
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
  const [searchField, setSearchField] = useState(() => initial?.searchField ?? "all");
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
    // Match by WORD PREFIX, not raw substring: each typed term must begin a word in the haystack.
    // So "EY" matches the firm EY (and "EY Parthenon") but NOT "Foley"/"Disney"/"Berkeley"; "morg"
    // still matches "Morgan" (prefix); "ernst" matches "Ernst & Young". Tokenise on any
    // non-alphanumeric so spaces, "&", "-", "/" all act as word breaks — this also folds the old
    // double-space normalisation in (a run of separators collapses to one boundary).
    const tokenize = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const qTokens = tokenize(query);

    // Which haystack the query searches: a specific named field, or the whole row ("all").
    const scope = searchField !== "all" ? config.searchFields?.find((f) => f.key === searchField) : undefined;
    const out = rows.filter((row) => {
      // Free-text search: every typed term must be a word-prefix in the chosen scope.
      if (qTokens.length) {
        const hay = tokenize(scope ? scope.get(row) : config.searchText(row));
        if (!qTokens.every((qt) => hay.some((ht) => ht.startsWith(qt)))) return false;
      }
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
  }, [rows, query, searchField, filterValues, sortKey, sortDir, config]);

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
    setSearchField("all");
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
    searchFields: config.searchFields ? [{ key: "all", label: "All" }, ...config.searchFields.map((f) => ({ key: f.key, label: f.label }))] : [],
    searchField,
    setSearchField,
    // Only filters with toolbar !== false render as toolbar dropdowns (the rest stay
    // filterable via the stat-bar quick-filters, which set the same keys).
    filterDefs: (config.filters ?? [])
      .filter((f) => f.toolbar !== false)
      .map((f) => ({ key: f.key, label: f.label, options: f.options })),
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
