// A table column header that is click-to-sort and (for categorical columns) carries an
// inline filter dropdown. Used by the Contacts / Meetings / Opportunities tables so every
// column behaves the same: click the label to sort (toggles asc/desc), pick a value in the
// dropdown to filter. Free-text / date columns pass no `filter` (search + sort cover them).
//
// Reads/writes the shared table-control state via the `controls` props from
// useTableControls (../data/tableControls.ts), so it stays a pure view component.

import type { ControlsProps } from "../data/tableControls";
import "./ColumnHeader.css";

type Props = {
  label: string;
  controls: ControlsProps;
  sortKey?: string; // omit for a non-sortable column
  filter?: { key: string; options: readonly string[] }; // omit for non-categorical columns
  className?: string; // extra <th> class, e.g. "cell-num"
};

export function ColumnHeader({ label, controls, sortKey, filter, className }: Props) {
  const sorted = sortKey !== undefined && controls.sortKey === sortKey;
  const arrow = sorted ? (controls.sortDir === "asc" ? " ↑" : " ↓") : "";
  const value = filter ? (controls.filterValues[filter.key] ?? "") : "";

  return (
    <th className={className}>
      <div className="ch">
        {sortKey !== undefined ? (
          <button
            type="button"
            className={sorted ? "ch-label ch-label--sorted" : "ch-label"}
            onClick={() => controls.sortBy(sortKey)}
            title="Click to sort"
          >
            {label}
            <span className="ch-arrow">{arrow}</span>
          </button>
        ) : (
          <span className="ch-label ch-label--plain">{label}</span>
        )}
        {filter && (
          <select
            className={value ? "ch-filter ch-filter--active" : "ch-filter"}
            value={value}
            onChange={(e) => controls.setFilter(filter.key, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Filter by ${label}`}
            title={`Filter by ${label}`}
          >
            <option value="">All</option>
            {filter.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
      </div>
    </th>
  );
}
