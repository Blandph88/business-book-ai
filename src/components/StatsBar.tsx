import "./StatsBar.css";

// A row of headline stats shown at the top of a record tab — one value over its label,
// with an optional highlighted (brand) stat. Shared by every tab so they look identical.
//
// A stat can also act as a one-click FILTER: give it `onSelect` and it renders as a button
// that applies that filter to the list below. When its filter is the one currently applied,
// pass `active` — it then renders highlighted and is NOT clickable (you're already there).
export type Stat = {
  label: string;
  value: string | number;
  highlight?: boolean;
  onSelect?: () => void;
  active?: boolean;
};

export function StatsBar({
  stats,
  variant = "cards",
}: {
  stats: Stat[];
  // "cards" = the big number-over-label headline row; "chips" = a compact pill row
  // (used under the cards on the Revenue tab for its status filters).
  variant?: "cards" | "chips";
}) {
  return (
    <div className={variant === "chips" ? "statsbar statsbar--chips" : "statsbar"}>
      {stats.map((s) => {
        const cls = [
          "statsbar-stat",
          s.highlight ? "statsbar-stat--hl" : "",
          s.onSelect ? "statsbar-stat--selectable" : "",
          s.active ? "statsbar-stat--active" : "",
        ]
          .filter(Boolean)
          .join(" ");
        // Clickable only when it has a handler AND isn't already the active filter.
        if (s.onSelect && !s.active) {
          return (
            <button
              key={s.label}
              type="button"
              className={cls}
              onClick={s.onSelect}
              title={`Filter to ${s.label}`}
            >
              <span className="statsbar-value">{s.value}</span>
              <span className="statsbar-label">{s.label}</span>
            </button>
          );
        }
        return (
          <div key={s.label} className={cls} aria-current={s.active ? "true" : undefined}>
            <span className="statsbar-value">{s.value}</span>
            <span className="statsbar-label">{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}
