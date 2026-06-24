import "./StatsBar.css";

// A row of headline stats shown at the top of a record tab — one value over its label,
// with an optional highlighted (EY-blue) stat. Shared by every tab so they look identical.
export type Stat = { label: string; value: string | number; highlight?: boolean };

export function StatsBar({ stats }: { stats: Stat[] }) {
  return (
    <div className="statsbar">
      {stats.map((s) => (
        <div
          key={s.label}
          className={s.highlight ? "statsbar-stat statsbar-stat--hl" : "statsbar-stat"}
        >
          <span className="statsbar-value">{s.value}</span>
          <span className="statsbar-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
