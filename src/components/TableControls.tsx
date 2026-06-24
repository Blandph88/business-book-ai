// The shared list toolbar: a search box + the "showing N of M" count + a Clear button.
// Per-column filtering and sorting now live in the clickable column headers
// (./ColumnHeader.tsx), so the toolbar no longer renders filter or sort dropdowns.
// Purely presentational — all state lives in useTableControls (../data/tableControls.ts).

import type { ControlsProps } from "../data/tableControls";
import "./TableControls.css";

export function TableControls(props: ControlsProps) {
  const { query, setQuery, searchPlaceholder, shown, total, isActive, reset } =
    props;

  return (
    <div className="table-controls">
      <input
        className="tc-search"
        type="search"
        placeholder={searchPlaceholder ?? "Search…"}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

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
