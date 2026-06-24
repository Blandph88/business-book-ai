// The shared list toolbar: a search box + categorical filter dropdowns + the "showing N of M"
// count + a Clear button. Sorting lives in the clickable column headers (./ColumnHeader.tsx);
// filtering lives HERE (the headers are sort-only). Which filters appear is decided by the
// per-list config — a `toolbar: false` filter is hidden here (it's driven by a stat-bar
// quick-filter instead). Purely presentational — all state lives in useTableControls.

import type { ControlsProps } from "../data/tableControls";
import "./TableControls.css";

export function TableControls(props: ControlsProps) {
  const {
    query,
    setQuery,
    searchPlaceholder,
    filterDefs,
    filterValues,
    setFilter,
    shown,
    total,
    isActive,
    reset,
  } = props;

  return (
    <div className="table-controls">
      <input
        className="tc-search"
        type="search"
        placeholder={searchPlaceholder ?? "Search…"}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {filterDefs.map((f) => (
        <label key={f.key} className="tc-control">
          <span className="tc-label">{f.label}</span>
          <select
            value={filterValues[f.key] ?? ""}
            onChange={(e) => setFilter(f.key, e.target.value)}
            aria-label={`Filter by ${f.label}`}
          >
            <option value="">All</option>
            {f.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      ))}

      {/* "showing N of M" — also a quick reconciliation sanity check. */}
      <span className="tc-count">
        {shown === total ? `${total}` : `${shown} of ${total}`}
      </span>

      {isActive && (
        <button type="button" className="tc-reset" onClick={reset}>
          Clear
        </button>
      )}
    </div>
  );
}
