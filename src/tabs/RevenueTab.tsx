import { useEffect, useMemo, useRef, useState } from "react";
import "./RevenueTab.css";
import {
  loadAllSows,
  saveSow,
  deleteSow,
  type Sow,
  type SowsById,
} from "../storage/revenue";
import {
  loadAllOpportunities,
  type OpportunitiesById,
} from "../storage/opportunities";
import {
  contractedRevenue,
  pctRecognised,
  totalContractedRevenue,
  totalRecognised,
  myBook,
  sowFromOpportunity,
} from "../data/revenue";
import { formatMoney, formatPct } from "../data/format";
import { SERVICE_LINE, REVENUE_STATUS } from "../data/vocab";
import type { TabIntent, Navigate } from "../components/TabNav";
import { TableControls } from "../components/TableControls";
import { useTableControls, type ControlsConfig } from "../data/tableControls";
import { RevenueForm, type RevenueFormTarget } from "./RevenueForm";
import { StatsBar } from "../components/StatsBar";

// What the Revenue list can be searched, filtered, and sorted by. Default sort keeps
// the previous behaviour — biggest contracted value first.
const REVENUE_CONTROLS: ControlsConfig<Sow> = {
  searchPlaceholder: "Search engagement or organisation…",
  searchText: (s) => `${s.engagement_name} ${s.organisation}`,
  filters: [
    { key: "service_line", label: "Service line", options: SERVICE_LINE, get: (s) => s.service_line },
    { key: "status", label: "Status", options: REVENUE_STATUS, get: (s) => s.status },
  ],
  sorts: [
    { key: "contracted", label: "Contracted value", get: (s) => contractedRevenue(s) },
    { key: "pct", label: "% recognised", get: (s) => pctRecognised(s) },
    { key: "name", label: "Engagement", get: (s) => s.engagement_name },
  ],
  defaultSortKey: "contracted",
  defaultSortDir: "desc",
};

// The Revenue & SoW tab (CLAUDE.md §4): signed work, one row per Statement of Work.
// Same shape as the other CRM tabs — read-only summary table + slide-in edit form,
// persisted to browser localStorage (../storage/revenue.ts).
//
// Contracted revenue (= chargeable_hours / 8 × day_rate) and % recognised are always
// calculated, never hand-entered (§6 rule 4). A SoW may optionally link to the
// opportunity it came from (the form offers a dropdown of existing opportunities).

function newSowId(): string {
  return `sow:${crypto.randomUUID()}`;
}

export function RevenueTab({
  intent,
  onNavigate,
  onOpenAccount,
  onReturn,
}: {
  // Deep link: createSowFor opens a new SoW pre-filled from that opportunity.
  intent?: TabIntent | null;
  // Jump to another tab (the form's link to the source opportunity).
  onNavigate?: Navigate;
  // Open the organisation "account" overlay (clicking an org name).
  onOpenAccount?: (org: string) => void;
  // Return to the originating overview tab after save/close.
  onReturn?: () => void;
}) {
  const [saved, setSaved] = useState<SowsById>({});
  const [opps, setOpps] = useState<OpportunitiesById>({});
  const [justSaved, setJustSaved] = useState(false);
  const [formTarget, setFormTarget] = useState<RevenueFormTarget | null>(null);

  // Load saved SoWs and opportunities (for the link dropdown + name lookup) once.
  useEffect(() => {
    setSaved(loadAllSows());
    setOpps(loadAllOpportunities());
  }, []);

  // Consume a deep link once data has loaded: createSowFor opens a new SoW pre-filled
  // from that opportunity; openId opens an existing SoW.
  const handled = useRef<TabIntent | null>(null);
  useEffect(() => {
    if (!intent || intent === handled.current) return;
    if (intent.createSowFor && opps[intent.createSowFor]) {
      setFormTarget({
        mode: "new",
        prefill: sowFromOpportunity(opps[intent.createSowFor]),
      });
      handled.current = intent;
    } else if (intent.openId && saved[intent.openId]) {
      setFormTarget({ mode: "edit", sow: saved[intent.openId] });
      handled.current = intent;
    }
  }, [intent, opps, saved]);

  // All saved SoWs. Ordering is handled by the controls below (default: contracted
  // value descending — the previous behaviour).
  const rows = useMemo(() => Object.values(saved), [saved]);

  // Search / filter / sort state and the rows to actually render.
  const { filtered, controlsProps } = useTableControls(rows, REVENUE_CONTROLS);

  // Opportunities as a sorted list for the form's dropdown.
  const oppList = useMemo(
    () =>
      Object.values(opps).sort((a, b) =>
        a.opportunity_name.localeCompare(b.opportunity_name),
      ),
    [opps],
  );

  // Headline figures: total contracted, total recognised, and YOUR book (recognised
  // revenue on work credited to you — the number the whole app builds toward).
  const totalContracted = useMemo(() => totalContractedRevenue(rows), [rows]);
  const totalRec = useMemo(() => totalRecognised(rows), [rows]);
  const book = useMemo(() => myBook(rows, opps), [rows, opps]);

  // The money totals above are aggregates (not list subsets), so they stay display-only.
  // Below them, a chip per SoW status acts as a one-click filter; "All" clears it.
  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of rows) m[s.status] = (m[s.status] ?? 0) + 1;
    return m;
  }, [rows]);
  const statusFilter = controlsProps.filterValues.status ?? "";
  const selectStatus = (status: string) => controlsProps.setFilter("status", status);
  const statusChips = [
    { label: "All", value: rows.length, onSelect: () => selectStatus(""), active: statusFilter === "" },
    ...REVENUE_STATUS.map((st) => ({
      label: st,
      value: statusCounts[st] ?? 0,
      onSelect: () => selectStatus(st),
      active: statusFilter === st,
    })),
  ];

  // Look up a linked opportunity's name for display in the table.
  function linkedName(sow: Sow): string {
    if (!sow.linked_opportunity_id) return "—";
    const opp = opps[sow.linked_opportunity_id];
    return opp ? opp.opportunity_name || opp.organisation : "—";
  }

  function flashSaved() {
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 1200);
  }

  function handleSave(sow: Sow) {
    const toSave: Sow = sow.id === "" ? { ...sow, id: newSowId() } : sow;
    setSaved(saveSow(toSave));
    setFormTarget(null);
    flashSaved();
    onReturn?.();
  }

  function handleDelete(id: string) {
    setSaved(deleteSow(id));
    setFormTarget(null);
    flashSaved();
  }

  return (
    <section className="rev">
      <div className="rev-toolbar">
        <h2>Revenue &amp; SoW</h2>
        <span className="rev-count">{rows.length} SoWs</span>
        <button
          type="button"
          className="rev-add"
          onClick={() => setFormTarget({ mode: "new" })}
        >
          + Add SoW
        </button>
        <span className={justSaved ? "rev-saved rev-saved--on" : "rev-saved"}>
          Saved ✓
        </span>
      </div>

      <p className="rev-hint">
        Signed statements of work. Contracted revenue (chargeable hours ÷ 8 × day
        rate) and % recognised are calculated automatically. Click any row to edit.
      </p>

      {rows.length > 0 && (
        <>
          <StatsBar
            stats={[
              { label: "My book (recognised, credited to me)", value: formatMoney(book), highlight: true },
              { label: "Recognised (all)", value: formatMoney(totalRec) },
              { label: "Contracted (all)", value: formatMoney(totalContracted) },
            ]}
          />
          <StatsBar variant="chips" stats={statusChips} />
        </>
      )}

      {rows.length === 0 ? (
        <p className="rev-empty">
          No signed work yet. Add a SoW when an opportunity converts.
        </p>
      ) : (
        <>
          <TableControls {...controlsProps} />
          {filtered.length === 0 ? (
            <p className="rev-empty">No SoWs match these filters.</p>
          ) : (
            <div className="rev-table-wrap">
              <table className="rev-table">
            <thead>
              <tr>
                <th>Engagement</th>
                <th>Organisation</th>
                <th>Service line</th>
                <th>Linked opportunity</th>
                <th className="cell-num">Contracted</th>
                <th className="cell-num">% rec.</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((sow) => (
                <tr
                  key={sow.id}
                  className="rev-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => setFormTarget({ mode: "edit", sow })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setFormTarget({ mode: "edit", sow });
                    }
                  }}
                >
                  <td>{sow.engagement_name || "—"}</td>
                  <td>
                    {onOpenAccount && sow.organisation ? (
                      <button
                        type="button"
                        className="org-link"
                        title="View this organisation’s account"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenAccount(sow.organisation);
                        }}
                      >
                        {sow.organisation}
                      </button>
                    ) : (
                      sow.organisation || "—"
                    )}
                  </td>
                  <td>{sow.service_line}</td>
                  <td>
                    {sow.linked_opportunity_id && onNavigate ? (
                      <button
                        type="button"
                        className="org-link"
                        title="Open the linked opportunity"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigate("opportunities", {
                            openId: sow.linked_opportunity_id!,
                          });
                        }}
                      >
                        {linkedName(sow)}
                      </button>
                    ) : (
                      linkedName(sow)
                    )}
                  </td>
                  <td className="cell-num">
                    {formatMoney(contractedRevenue(sow))}
                  </td>
                  <td className="cell-num">{formatPct(pctRecognised(sow))}</td>
                  <td>{sow.status}</td>
                  <td className="cell-actions">
                    <button
                      type="button"
                      className="rev-remove"
                      title="Remove this SoW"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(sow.id);
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {formTarget && (
        <RevenueForm
          target={formTarget}
          opportunities={oppList}
          onSave={handleSave}
          onDelete={formTarget.mode === "edit" ? handleDelete : undefined}
          onOpenOpportunity={
            onNavigate
              ? (id) => onNavigate("opportunities", { openId: id })
              : undefined
          }
          onClose={() => {
            setFormTarget(null);
            onReturn?.();
          }}
        />
      )}
    </section>
  );
}
