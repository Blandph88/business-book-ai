// FLAGGED-ANSWER STORE (the no-telemetry learning loop, part a). When the user flags a bad AI answer,
// we compose a LOCAL, user-reviewed bug report and keep a copy here so their flags aren't lost after
// they copy one out. Unlike the ambient failure log (metadata only), a flag report DOES contain the
// question + answer — that's the user's OWN book content, shown to them in full and shared only by
// their explicit copy action (consent per event). Nothing is ever sent anywhere automatically.

import { persistLocal, scopedKey } from "./persist";

export type FlagRecord = { at: number; question: string; answer: string; report: string };

const KEY = scopedKey("bob.flags.v1");
const CAP = 100;

export function listFlags(): FlagRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as FlagRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveFlag(rec: FlagRecord): void {
  try {
    const list = listFlags();
    list.push(rec);
    persistLocal(KEY, JSON.stringify(list.slice(-CAP))); // mirrored to disk like chats/memory
  } catch {
    /* best-effort */
  }
}

export function clearFlags(): void {
  try { persistLocal(KEY, JSON.stringify([])); } catch { /* best-effort */ }
}
