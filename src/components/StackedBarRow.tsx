// A horizontal bar split into coloured, clickable SEGMENTS — the Dashboard funnel,
// matching the EY report's "Networking Funnel by Segment" (stacked by sector group).
//
// Each segment is a real <button> so the owner can drill into exactly the contacts
// it represents. The segment widths are proportional to `max` (the largest stage
// total in the funnel), so the longest stage fills the track and shorter stages are
// comparable to it. The segments of a stage therefore visually sum to that stage's
// total — the §6 reconciliation made visible.

export type Segment = {
  label: string;
  count: number;
  color: string;
};

type StackedBarRowProps = {
  label: string;
  segments: Segment[];
  total: number;
  max: number; // largest total across the chart, for scaling
  pct?: number; // e.g. % of target, shown after the count
  caption?: string; // free-text shown instead of pct (e.g. "78% accepted") for plain stages
  onSegmentClick: (segmentLabel: string) => void;
};

export function StackedBarRow({
  label,
  segments,
  total,
  max,
  pct,
  caption,
  onSegmentClick,
}: StackedBarRowProps) {
  const scale = (n: number) => (max === 0 ? 0 : (n / max) * 100);

  return (
    <div className="stack-row">
      <span className="stack-label" title={label}>
        {label}
      </span>
      <span className="stack-track">
        {segments.map((seg) =>
          seg.count > 0 ? (
            <button
              key={seg.label}
              type="button"
              className="stack-seg"
              style={{ width: `${scale(seg.count)}%`, background: seg.color }}
              title={`${label} · ${seg.label}: ${seg.count}`}
              aria-label={`${label}, ${seg.label}: ${seg.count}. Show details.`}
              onClick={() => onSegmentClick(seg.label)}
            />
          ) : null,
        )}
      </span>
      <span className="stack-value">
        {total}
        {pct !== undefined && <span className="stack-pct">{pct}%</span>}
        {caption !== undefined && <span className="stack-pct">{caption}</span>}
      </span>
    </div>
  );
}
