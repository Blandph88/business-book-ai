// Renders a deterministic compute result (see ai/compute.ts) as a scannable table whose rows DEEP-LINK
// to the underlying record — so it's both readable and clickable, with no duplicated card list. Used for
// "meetings last two weeks" / "warmest leads" / "gone cold" answers.
import type { ComputeResult } from "../ai/compute";
import type { Navigate, TabId } from "./TabNav";
import "./ComputeTable.css";

export function ComputeTable({ data, onNavigate, onClose }: { data: ComputeResult; onNavigate: Navigate; onClose: () => void }) {
  const go = (tab: TabId, id: string) => { onNavigate(tab, { openId: id }); onClose(); };
  return (
    <div className="ctab">
      {data.intro && <p className="ctab-intro">{data.intro}</p>}
      {data.rows.length > 0 && (
        <div className="ctab-wrap">
          <table className="ctab-table">
            <thead><tr>{data.columns.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>
              {data.rows.map((row, ri) => {
                const rec = row.record;
                return (
                  <tr
                    key={ri}
                    className={rec ? "ctab-row ctab-row--click" : "ctab-row"}
                    onClick={rec ? () => go(rec.tab, rec.id) : undefined}
                    tabIndex={rec ? 0 : undefined}
                    role={rec ? "button" : undefined}
                    onKeyDown={rec ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(rec.tab, rec.id); } } : undefined}
                  >
                    {row.cells.map((c, ci) => <td key={ci}>{c}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data.more && (
        <button type="button" className="ctab-more" onClick={() => { onNavigate(data.more!.tab, data.more!.intent); onClose(); }}>
          View all {data.more.count} in {data.more.tab === "revenue" ? "contracts" : data.more.tab} →
        </button>
      )}
    </div>
  );
}
