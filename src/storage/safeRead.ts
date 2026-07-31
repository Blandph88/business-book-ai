// Safe JSON read for the owner-data stores. If a stored value is corrupt (can't parse), returning the
// fallback and letting the app carry on would let the NEXT save overwrite the corrupt-but-recoverable bytes,
// permanently destroying the data. Instead we BACK UP the raw bytes to a sibling "<key>.corrupt" slot (kept
// out of the app's write path) and set a flag the UI can surface — so nothing is silently lost.

export function readJsonSafe<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    try { localStorage.setItem(key + ".corrupt", raw); } catch { /* storage full/unavailable */ }
    try { localStorage.setItem(STORE_CORRUPT_FLAG, key); } catch { /* ignore */ }
    console.error(`[Business Book] Corrupt data in "${key}" — backed up to "${key}.corrupt" and NOT overwriting. Your data is recoverable.`);
    return fallback;
  }
}

// ── Type healing for the vault CSV round-trip ─────────────────────────────────────────────
// Older Freehold builds round-tripped an owned book through CSV with blind type coercion: a
// STRING that merely looks numeric/boolean reloaded as a number/boolean (a company literally
// named "54", every digits-only phone, a note saying "true") and then crashed any render that
// called a string method on it (F6). String() restores the original text exactly, so healing
// at read time is lossless. Freehold now guard-quotes such strings on write; these helpers
// heal books that were saved by the older code.
export function healStr(v: unknown): string {
  return v == null ? "" : typeof v === "string" ? v : String(v);
}
// For optional fields: preserves absent-ness (undefined) instead of inventing "".
export function healOptStr(v: unknown): string | undefined {
  return v == null ? undefined : typeof v === "string" ? v : String(v);
}

// Set when any store hit corrupt data this session; the UI can read it to warn the owner + point at the
// ".corrupt" backup, instead of the data appearing to have vanished.
export const STORE_CORRUPT_FLAG = "bb.storeCorrupt.v1";
export function corruptStoreKey(): string | null {
  try { return localStorage.getItem(STORE_CORRUPT_FLAG); } catch { return null; }
}
