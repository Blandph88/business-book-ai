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

// Set when any store hit corrupt data this session; the UI can read it to warn the owner + point at the
// ".corrupt" backup, instead of the data appearing to have vanished.
export const STORE_CORRUPT_FLAG = "bb.storeCorrupt.v1";
export function corruptStoreKey(): string | null {
  try { return localStorage.getItem(STORE_CORRUPT_FLAG); } catch { return null; }
}
