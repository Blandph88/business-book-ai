// A single labelled horizontal bar: a category name, its count, and a fill whose
// width is proportional to `max` (the largest value in the same chart, so bars are
// comparable within a chart). Used by the Dashboard's plain (non-stacked) charts.
//
// Optional props make the bar match the EY report and become interactive:
//   color   — the fill colour (the dashboard passes an EY-ramp colour per bar)
//   pct     — a percentage to show next to the count, like the report's labels
//   onClick — makes the whole row a button that drills into the underlying rows
//
// `muted` flags the de-emphasised "Other Functions" bucket (CLAUDE.md §6 rule 3):
// it renders italic/greyed so real categories visually lead.

type BarRowProps = {
  label: string;
  count: number;
  max: number;
  muted?: boolean;
  color?: string;
  pct?: number;
  // Override the displayed value (e.g. a formatted money figure) while `count` still
  // drives the bar width. Defaults to showing `count`.
  valueLabel?: string;
  onClick?: () => void;
};

export function BarRow({
  label,
  count,
  max,
  muted = false,
  color,
  pct,
  valueLabel,
  onClick,
}: BarRowProps) {
  // Width as a percentage of the largest bar in this chart. Guard divide-by-zero.
  const widthPct = max === 0 ? 0 : Math.round((count / max) * 100);

  const className = muted ? "bar-row bar-row--muted" : "bar-row";
  const fillStyle = {
    width: `${widthPct}%`,
    ...(color ? { background: color } : {}),
  };

  const inner = (
    <>
      <span className="bar-label" title={label}>
        {label}
      </span>
      <span className="bar-track">
        <span className="bar-fill" style={fillStyle} />
      </span>
      <span className="bar-value">
        {valueLabel ?? count}
        {pct !== undefined && <span className="bar-pct">{pct}%</span>}
      </span>
    </>
  );

  // Clickable bars are real buttons (keyboard accessible); static bars are a div.
  if (onClick) {
    return (
      <button
        type="button"
        className={`${className} bar-row--clickable`}
        onClick={onClick}
        aria-label={`${label}: ${count}. Show contacts.`}
      >
        {inner}
      </button>
    );
  }

  return <div className={className}>{inner}</div>;
}
