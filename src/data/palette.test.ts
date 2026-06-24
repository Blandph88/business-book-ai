import { describe, it, expect } from "vitest";
import {
  BLUE_LIGHT,
  BLUE_DARK,
  NEUTRAL_GREY,
  rampColor,
  SECTOR_GROUP_COLORS,
  heatColor,
  heatTextColor,
} from "./palette";
import { SECTOR_GROUPS } from "./vocab";

const HEX = /^#[0-9a-f]{6}$/i;

// ── constants ───────────────────────────────────────────────────────────────────────────────
describe("palette constants", () => {
  it("exposes well-formed hex endpoints", () => {
    expect(BLUE_LIGHT).toMatch(HEX);
    expect(BLUE_DARK).toMatch(HEX);
    expect(NEUTRAL_GREY).toMatch(HEX);
  });
});

// ── rampColor ───────────────────────────────────────────────────────────────────────────────
describe("rampColor", () => {
  it("returns BLUE_LIGHT for a single-item ramp (n <= 1)", () => {
    expect(rampColor(0, 1)).toBe(BLUE_LIGHT);
    expect(rampColor(0, 0)).toBe(BLUE_LIGHT);
  });

  it("anchors the ends of a multi-item ramp to the endpoints", () => {
    // Interpolated output is lowercase hex; compare case-insensitively against the
    // (uppercase) endpoint constants.
    expect(rampColor(0, 5).toLowerCase()).toBe(BLUE_LIGHT.toLowerCase());
    expect(rampColor(4, 5).toLowerCase()).toBe(BLUE_DARK.toLowerCase());
  });

  it("produces valid hex for every interpolated step", () => {
    for (let i = 0; i < 10; i++) {
      expect(rampColor(i, 10)).toMatch(HEX);
    }
  });

  it("is deterministic / stable for the same inputs", () => {
    expect(rampColor(3, 7)).toBe(rampColor(3, 7));
  });

  it("darkens monotonically along the ramp", () => {
    // Brightness measured as the sum of channels; light end should be brighter.
    const sum = (hex: string) => {
      const h = hex.replace("#", "");
      return parseInt(h.slice(0, 2), 16) + parseInt(h.slice(2, 4), 16) + parseInt(h.slice(4, 6), 16);
    };
    let prev = sum(rampColor(0, 8));
    for (let i = 1; i < 8; i++) {
      const cur = sum(rampColor(i, 8));
      expect(cur).toBeLessThanOrEqual(prev);
      prev = cur;
    }
  });
});

// ── SECTOR_GROUP_COLORS ─────────────────────────────────────────────────────────────────────
describe("SECTOR_GROUP_COLORS", () => {
  it("defines a colour for every sector group it claims to cover", () => {
    for (const group of SECTOR_GROUPS) {
      expect(SECTOR_GROUP_COLORS[group]).toMatch(HEX);
    }
  });

  it("has exactly one entry per sector group (no extras)", () => {
    expect(Object.keys(SECTOR_GROUP_COLORS).sort()).toEqual([...SECTOR_GROUPS].sort());
  });

  it("maps the first group to the lightest and the last to the darkest", () => {
    expect(SECTOR_GROUP_COLORS[SECTOR_GROUPS[0]].toLowerCase()).toBe(BLUE_LIGHT.toLowerCase());
    expect(SECTOR_GROUP_COLORS[SECTOR_GROUPS[SECTOR_GROUPS.length - 1]].toLowerCase()).toBe(
      BLUE_DARK.toLowerCase(),
    );
  });
});

// ── heatColor ───────────────────────────────────────────────────────────────────────────────
describe("heatColor", () => {
  it("returns white for non-positive value or max", () => {
    expect(heatColor(0, 10)).toBe("#ffffff");
    expect(heatColor(-5, 10)).toBe("#ffffff");
    expect(heatColor(5, 0)).toBe("#ffffff");
    expect(heatColor(5, -1)).toBe("#ffffff");
  });

  it("returns the light-blue anchor at the half-way point", () => {
    expect(heatColor(5, 10).toLowerCase()).toBe(BLUE_LIGHT.toLowerCase());
  });

  it("returns the dark navy anchor at the maximum", () => {
    expect(heatColor(10, 10).toLowerCase()).toBe(BLUE_DARK.toLowerCase());
  });

  it("produces valid hex across the full range", () => {
    for (let v = 0; v <= 10; v++) {
      expect(heatColor(v, 10)).toMatch(HEX);
    }
  });

  it("is deterministic for the same inputs", () => {
    expect(heatColor(3, 10)).toBe(heatColor(3, 10));
  });
});

// ── heatTextColor ───────────────────────────────────────────────────────────────────────────
describe("heatTextColor", () => {
  it("returns dark ink on the light end of the scale", () => {
    expect(heatTextColor(0, 10)).toBe(BLUE_DARK);
    expect(heatTextColor(5, 10)).toBe(BLUE_DARK); // exactly 0.5 → not > 0.5
  });

  it("returns white once the cell is dark enough", () => {
    expect(heatTextColor(6, 10)).toBe("#ffffff");
    expect(heatTextColor(10, 10)).toBe("#ffffff");
  });

  it("returns dark ink (not NaN-driven) when max <= 0", () => {
    expect(heatTextColor(5, 0)).toBe(BLUE_DARK);
    expect(heatTextColor(5, -1)).toBe(BLUE_DARK);
  });
});
