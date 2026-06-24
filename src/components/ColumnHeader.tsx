// A table column header. Click the label to sort (toggles asc/desc); that's all it does —
// filtering lives in the shared search toolbar (./TableControls.tsx). Used by every record
// table so columns behave the same. Reads/writes the shared control state via `controls`.

import type { ControlsProps } from "../data/tableControls";
import "./ColumnHeader.css";

type Props = {
  label: string;
  controls: ControlsProps;
  sortKey?: string; // omit for a non-sortable column (e.g. icon columns)
  className?: string; // extra <th> class, e.g. "cell-num"
};

export function ColumnHeader({ label, controls, sortKey, className }: Props) {
  const sorted = sortKey !== undefined && controls.sortKey === sortKey;
  const arrow = sorted ? (controls.sortDir === "asc" ? " ↑" : " ↓") : "";

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
      </div>
    </th>
  );
}
