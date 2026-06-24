// One detailed pipeline matrix — the report's back-section tables (section 6).
//
// Rows are entities (e.g. NDF, SNB, or a company name for General Corporates),
// columns are the five seniorities, plus a Total column and a Total row. Cells are
// heat-shaded like the report (white → EY yellow → EY black). EVERY non-zero number
// is a button: clicking it opens the exact contacts behind that number — e.g.
// "NDF × Executive Leadership = 2" drills to those two people.
//
// Reconciliation is by construction (CLAUDE.md §6): each total is the union of the
// cells it sums, computed in metrics.ts, so the printed Total row/column always adds
// up to the cells above/beside it.

import { Fragment, useEffect, useState } from "react";
import type { Contact } from "../data/contacts";
import type {
  PipelineMatrix as Matrix,
  MatrixRow,
  MatrixSection,
} from "../data/metrics";
import { heatColor, heatTextColor } from "../data/palette";

type Props = {
  matrix: Matrix;
  // Open the contact drill-down for a set of people behind one number.
  onPick: (title: string, contacts: Contact[]) => void;
};

export function PipelineMatrix({ matrix, onPick }: Props) {
  // Scale heat by the largest single CELL value, so colour differences are visible.
  const maxCell = matrix.rows.reduce(
    (m, r) => Math.max(m, ...r.cells.map((c) => c.length)),
    0,
  );

  // Sub-group bands are dropdowns. They start OPEN (all visible on first view); the user
  // can collapse any of them. Reset to all-open whenever a different matrix is shown.
  const [openBands, setOpenBands] = useState<Set<string>>(
    () => new Set(matrix.sections.map((s) => s.label)),
  );
  useEffect(
    () => setOpenBands(new Set(matrix.sections.map((s) => s.label))),
    [matrix],
  );
  const toggleBand = (label: string) =>
    setOpenBands((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });

  // A clickable number cell (heat-shaded). Renders an empty muted cell for zero.
  const cell = (key: string, contacts: Contact[], title: string) => {
    const n = contacts.length;
    if (n === 0)
      return (
        <td key={key} className="mx-cell mx-cell--zero">
          ·
        </td>
      );
    return (
      <td key={key} className="mx-cell">
        <button
          type="button"
          className="mx-num"
          style={{
            background: heatColor(n, maxCell),
            color: heatTextColor(n, maxCell),
          }}
          onClick={() => onPick(title, contacts)}
          aria-label={`${title}: ${n}. Show contacts.`}
        >
          {n}
        </button>
      </td>
    );
  };

  // A total cell uses a neutral grey background (like the report's total band).
  const totalCell = (key: string, contacts: Contact[], title: string) => {
    const n = contacts.length;
    return (
      <td key={key} className="mx-cell mx-cell--total">
        {n === 0 ? (
          <span className="mx-num mx-num--flat">0</span>
        ) : (
          <button
            type="button"
            className="mx-num mx-num--flat"
            onClick={() => onPick(title, contacts)}
            aria-label={`${title}: ${n}. Show contacts.`}
          >
            {n}
          </button>
        )}
      </td>
    );
  };

  const metricName = matrix.label;

  // One entity row (org/bucket × the column dimension + its row total).
  const dataRow = (row: MatrixRow) => (
    <tr key={row.label}>
      <th className="mx-rowhead" title={row.label}>
        {row.label}
      </th>
      {row.cells.map((contacts, i) =>
        cell(
          matrix.colLabels[i],
          contacts,
          `${metricName} · ${row.label} · ${matrix.colLabels[i]}`,
        ),
      )}
      {totalCell(
        "__rowtotal",
        row.total,
        `${metricName} · ${row.label} (all seniorities)`,
      )}
    </tr>
  );

  // A totals row (a per-band subtotal or the grand total): per-column unions + the total.
  const totalsRow = (
    key: string,
    rowLabel: string,
    rowClass: string,
    colTotals: Contact[][],
    total: Contact[],
    titlePrefix: string,
  ) => (
    <tr key={key} className={rowClass}>
      <th className="mx-rowhead mx-rowhead--total">{rowLabel}</th>
      {colTotals.map((contacts, i) =>
        totalCell(
          matrix.colLabels[i],
          contacts,
          `${titlePrefix} · ${matrix.colLabels[i]}`,
        ),
      )}
      {totalCell("__total", total, `${titlePrefix} (all)`)}
    </tr>
  );

  // One sub-group band: a collapsible header (dropdown), and — when open — its rows
  // plus a reconciling subtotal.
  const sectionRows = (section: MatrixSection, first: boolean) => {
    const isOpen = openBands.has(section.label);
    return (
      <Fragment key={`sec-${section.label}`}>
        <tr
          className={`mx-bandhead${first ? " mx-bandhead--first" : ""}${isOpen ? " mx-bandhead--open" : ""}`}
        >
          <th colSpan={matrix.colLabels.length + 2}>
            <button
              type="button"
              className="mx-bandtoggle"
              onClick={() => toggleBand(section.label)}
              aria-expanded={isOpen}
            >
              <span className="mx-bandlabel">{section.label}</span>
              <span className="mx-bandcount">· {section.total.length}</span>
              <span className="mx-bandcaret" aria-hidden="true">
                ▾
              </span>
            </button>
          </th>
        </tr>
        {isOpen && section.rows.map(dataRow)}
        {isOpen &&
          totalsRow(
            `sub-${section.label}`,
            `${section.label} total`,
            "mx-subtotalrow",
            section.colTotals,
            section.total,
            `${metricName} · ${section.label}`,
          )}
      </Fragment>
    );
  };

  // Only show sub-group sections when there's more than one band — a single band
  // (e.g. Government Entities, which isn't sub-grouped) renders as a flat list.
  const sectioned = matrix.sections.length > 1;

  return (
    <div className="mx">
      <table className="mx-table">
        <thead>
          <tr>
            <th className="mx-rowhead" />
            {matrix.colLabels.map((c) => (
              <th key={c} className="mx-colhead" title={c}>
                {c}
              </th>
            ))}
            <th className="mx-colhead mx-colhead--total">Total</th>
          </tr>
        </thead>
        <tbody>
          {sectioned
            ? matrix.sections.map((s, i) => sectionRows(s, i === 0))
            : matrix.rows.map(dataRow)}
          {/* Grand total row (per column) + grand total. */}
          {totalsRow(
            "grand",
            "Total",
            "mx-totalrow",
            matrix.colTotals,
            matrix.grandTotal,
            metricName,
          )}
        </tbody>
      </table>
    </div>
  );
}
