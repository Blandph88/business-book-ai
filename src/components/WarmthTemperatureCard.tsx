// The relationship-temperature card for the Overview: how warm your relationships are, from the tone of
// their messages (the LLM sentiment pass). Two views in one card — the overall distribution (keen → cold)
// and a by-sector breakdown. Clicking a level (or a sector's segment) opens the SAME detailed matrix the
// other stacked charts use (organisation × seniority), via `onPick` — so drill-down is consistent.
//
// GATED: renders nothing until the sentiment pass has scored someone, so a non-AI / pre-analysis home is
// unchanged (no empty AI chart). Reads the same `warmthSentiment` signal the ranking + filter use.

import { useMemo } from "react";
import { BarRow } from "./BarRow";
import { StackedBarRow, type Segment } from "./StackedBarRow";
import { warmthLabelFor, WARMTH_LEVELS } from "../ai/compute";
import type { Contact } from "../data/contacts";
import { rampColor } from "../data/palette";
import "./WarmthTemperatureCard.css";

// The same single blue ramp every other chart uses — reversed so KEEN is the darkest blue and COLD the
// lightest (rampColor goes light→dark with index, so we map Keen to the dark end).
const WARMTH_COLORS: Record<string, string> = Object.fromEntries(
  WARMTH_LEVELS.map((l, i) => [l, rampColor(WARMTH_LEVELS.length - 1 - i, WARMTH_LEVELS.length)]),
);

export function WarmthTemperatureCard({
  contacts,
  onPick,
}: {
  contacts: Contact[];
  // Open the detailed matrix (organisation × seniority) for a set of contacts — same drill-down as the
  // funnel / seniority / function charts.
  onPick: (rows: Contact[], title: string) => void;
}) {
  // Gate on a REAL AI score (so a pre-analysis home is unchanged), but once shown, bucket the WHOLE book:
  // never-replied contacts are deterministically Cold via warmthLabelFor, so the chart reflects all
  // relationships, not just the scanned few. `covered` = everyone with a category (scored + cold-default).
  const aiScored = useMemo(() => contacts.filter((c) => c.warmthSentiment), [contacts]);
  const coldDefault = useMemo(() => contacts.filter((c) => !c.warmthSentiment && (c.inbound?.length ?? 0) === 0).length, [contacts]);

  // Overall distribution: the contacts at each warmth level.
  const dist = useMemo(() => {
    const byLevel = new Map<string, Contact[]>(WARMTH_LEVELS.map((l) => [l, [] as Contact[]]));
    for (const c of contacts) { const l = warmthLabelFor(c); if (l) byLevel.get(l)?.push(c); }
    return WARMTH_LEVELS.map((label) => ({ label, contacts: byLevel.get(label) ?? [] }));
  }, [contacts]);

  // By sector: each sector's contacts split across the warmth levels (segments), keeping the contact sets
  // so a segment click can open its matrix.
  const sectors = useMemo(() => {
    const bySector = new Map<string, Map<string, Contact[]>>();
    for (const c of contacts) {
      const l = warmthLabelFor(c);
      if (!l) continue;
      const s = c.sector_group || "Other";
      if (!bySector.has(s)) bySector.set(s, new Map(WARMTH_LEVELS.map((x) => [x, [] as Contact[]])));
      bySector.get(s)!.get(l)?.push(c);
    }
    return [...bySector.entries()]
      .map(([sector, byLevel]) => ({
        sector,
        byLevel,
        total: [...byLevel.values()].reduce((a, arr) => a + arr.length, 0),
        segments: WARMTH_LEVELS.map((l) => ({ label: l, count: byLevel.get(l)?.length ?? 0, color: WARMTH_COLORS[l] })) as Segment[],
      }))
      .sort((a, b) => b.total - a.total);
  }, [contacts]);

  if (!aiScored.length) return null; // gated — nothing until the pass has scored someone real

  const covered = dist.reduce((a, d) => a + d.contacts.length, 0);
  const max = Math.max(1, ...dist.map((d) => d.contacts.length));
  const sectorMax = Math.max(1, ...sectors.map((s) => s.total));

  return (
    <div className="dash-card" data-tour="met-warmth">
      <h3>Relationship temperature</h3>
      <p className="dash-card-note">
        How warm your relationships are, judged from the tone of their messages — click a level for its detailed matrix (organisation × seniority). ({aiScored.length.toLocaleString()} scored from replies{coldDefault > 0 ? ` · ${coldDefault.toLocaleString()} cold — no conversation yet` : ""})
      </p>
      <div className="warmth-legend">
        {WARMTH_LEVELS.map((l) => (
          <span key={l} className="warmth-legend-item"><span className="warmth-swatch" style={{ background: WARMTH_COLORS[l] }} />{l}</span>
        ))}
      </div>
      <div className="bars">
        {dist.map((d) => (
          <BarRow
            key={d.label}
            label={d.label}
            count={d.contacts.length}
            max={max}
            color={WARMTH_COLORS[d.label]}
            pct={covered ? Math.round((d.contacts.length / covered) * 100) : 0}
            onClick={d.contacts.length ? () => onPick(d.contacts, `Relationship temperature · ${d.label}`) : undefined}
          />
        ))}
      </div>
      {sectors.length > 1 && (
        <>
          <h4 className="warmth-sub">By sector</h4>
          <div className="stack">
            {sectors.map((s) => (
              <StackedBarRow
                key={s.sector}
                label={s.sector}
                segments={s.segments}
                total={s.total}
                max={sectorMax}
                onSegmentClick={(level) => onPick(s.byLevel.get(level) ?? [], `${s.sector} · ${level}`)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
