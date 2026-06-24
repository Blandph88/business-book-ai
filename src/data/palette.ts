// The single source of chart colours for the Dashboard.
//
// One sequential blue ramp, light → dark, used everywhere. Keeping every colour
// here means a sector group is the SAME colour wherever it appears — the funnel
// segments, the legend, the summary charts, and the matrices — so the eye can track
// a category across charts. Light→dark also gives the §6 rule 3 behaviour for free:
// the last category on the function chart ("Other Functions") lands on the DARKEST
// blue, i.e. the most de-emphasised end of the ramp.

import { SECTOR_GROUPS } from "./vocab";

// Blue ramp endpoints. BLUE_LIGHT is the lightest readable bar colour (we don't
// start at near-white, so even the first segment is visible); BLUE_DARK is a deep
// navy. Every other colour is interpolated between these two.
export const BLUE_LIGHT = "#BDD7E7";
export const BLUE_DARK = "#08306B";
// A neutral grey kept for any genuinely "off-scale" UI (not part of the ramp).
export const NEUTRAL_GREY = "#747480";

// Parse "#rrggbb" → [r, g, b].
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to2 = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n)))
      .toString(16)
      .padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

// Linear interpolation between two hex colours, t in [0, 1]. A plain straight-line
// RGB blend — same idea as seaborn's blend_palette.
function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

// The i-th of `n` colours along the light→dark blue ramp. Used for plain bars so
// the bars in a chart shade consistently from light to dark.
export function rampColor(i: number, n: number): string {
  if (n <= 1) return BLUE_LIGHT;
  return lerpHex(BLUE_LIGHT, BLUE_DARK, i / (n - 1));
}

// Fixed colour per sector group, in the canonical §5 order, along the same ramp.
// One object so every chart looks up the identical colour by group name.
export const SECTOR_GROUP_COLORS: Record<string, string> = Object.fromEntries(
  SECTOR_GROUPS.map((group, i) => [group, rampColor(i, SECTOR_GROUPS.length)]),
);

// Heatmap cell colour for a matrix: white (0) → light blue → dark navy (max). A
// single-hue sequential colormap, so a busier cell simply reads as a deeper blue.
// Returns the background colour; pair with `heatTextColor` for a readable foreground.
export function heatColor(value: number, max: number): string {
  if (value <= 0 || max <= 0) return "#ffffff";
  const t = value / max; // 0..1
  // First half white→light blue, second half light blue→dark navy.
  return t < 0.5
    ? lerpHex("#ffffff", BLUE_LIGHT, t / 0.5)
    : lerpHex(BLUE_LIGHT, BLUE_DARK, (t - 0.5) / 0.5);
}

// Readable text colour over a heat cell: dark ink on the light end, white once the
// background blue is dark enough to need it.
export function heatTextColor(value: number, max: number): string {
  if (max <= 0) return BLUE_DARK;
  return value / max > 0.5 ? "#ffffff" : BLUE_DARK;
}
