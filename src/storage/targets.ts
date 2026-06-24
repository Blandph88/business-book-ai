// Persistence for the owner's dashboard targets (a tiny settings object). Same
// localStorage + disk-mirror pattern as ../storage/ownerEdits.ts.

import { persistLocal, scopedKey } from "./persist";

export type Targets = {
  // Weighted open-pipeline target, in SAR.
  pipeline?: number;
  // Meetings-held-per-month target.
  meetingsPerMonth?: number;
};

const STORAGE_KEY = scopedKey("bob.targets.v1");

export function loadTargets(): Targets {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Targets;
  } catch {
    return {};
  }
}

export function saveTargets(t: Targets): Targets {
  persistLocal(STORAGE_KEY, JSON.stringify(t));
  return t;
}
