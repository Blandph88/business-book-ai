// Durable disk mirror for all owner-entered data (CLAUDE.md §3 "local file").
//
// Background: every store in this folder keeps the owner's hand-typed data in the
// browser's localStorage. localStorage is fast and simple but fragile — it is scoped
// to the exact origin and is wiped if you clear browser data or switch browser/machine.
// To make the data genuinely safe we ALSO mirror it to a real file on disk
// (data/owner_data.json), written by a tiny dev-server endpoint (see
// ../../owner-data-plugin.ts). localStorage stays the working copy; the file is the
// durable record you can back up.
//
// Model (single user, single machine):
//   • Write — after any store writes localStorage, we POST a snapshot of ALL stores to
//     the file. So the file is never more than a moment behind.
//   • Startup — we GET the file and, for any store that is MISSING locally, restore it
//     from the file (this is what recovers a cleared/fresh browser). If localStorage
//     already has a store, the live browser copy wins (it's the most current), and we
//     immediately re-seed the file from it. The first ever run therefore migrates the
//     existing localStorage data onto disk.
//
// If the endpoint is absent (e.g. a production `vite build`, which has no dev server),
// every call degrades silently to localStorage-only — the app keeps working.

// The localStorage keys we persist. Kept in sync with each store's own STORAGE_KEY;
// these are stable/versioned, so they rarely change. If you add a store, add its key.
import { getAppMode } from "../lib/appMode";

// Owned mode keeps the buyer's data in a SEPARATE localStorage namespace from the demo seeds,
// so a purchased copy never inherits demo data and the two can't collide on one origin. Demo
// keeps the canonical "bob.*" keys; owned uses "bob.owned.*".
export function scopedKey(base: string): string {
  if (getAppMode() !== "owned") return base;
  return base.startsWith("bob.") ? `bob.owned.${base.slice(4)}` : `owned.${base}`;
}

const KEYS = [
  "bob.contactOwnerEdits.v1", // ownerEdits.ts
  "bob.meetings.v2", // meetings.ts
  "bob.opportunities.v2", // opportunities.ts
  "bob.revenue.v1", // revenue.ts
  "bob.chats.v1", // chats.ts — the AI conversations (memory travels with the book)
  "bob.memory.v1", // memory.ts — durable facts the AI distils from past chats
  "bob.ownedContacts.v1", // ownedContacts.ts — contacts added manually (not from LinkedIn)
  // (the imported LinkedIn network lives in IndexedDB, not here — too large for localStorage)
].map(scopedKey);

const ENDPOINT = "/api/owner-data";

// Gather the current contents of every persisted store as a plain object
// { storageKey: parsedValue }. Unset/corrupt stores are simply omitted.
function snapshot(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of KEYS) {
    const raw = localStorage.getItem(key);
    if (raw == null) continue;
    try {
      out[key] = JSON.parse(raw);
    } catch {
      /* skip a corrupt store rather than write garbage to disk */
    }
  }
  return out;
}

// POST the whole snapshot to disk. Best-effort and fire-and-forget: a missing endpoint
// or a network error must never break an owner edit, so we swallow failures.
function postSnapshot(): void {
  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot()),
  }).catch(() => {
    /* dev endpoint absent (prod build) → localStorage-only; that's fine */
  });
}

// Debounce so a burst of rapid edits collapses into a single disk write.
let timer: ReturnType<typeof setTimeout> | undefined;

// Call after writing any store to localStorage — mirrors the change to disk.
export function syncToDisk(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(postSnapshot, 300);
}

// Write a value to localStorage AND mirror it to disk. Stores use this in place of a
// bare localStorage.setItem, so no save can forget to persist.
export function persistLocal(key: string, value: string): void {
  localStorage.setItem(key, value);
  syncToDisk();
}

// Run ONCE at startup, before the app reads localStorage. Restores any missing store
// from disk, then re-seeds the file from whatever we now hold. Best-effort: if the
// endpoint is unreachable we just continue on localStorage alone.
export async function hydrateFromDisk(): Promise<void> {
  let fileData: Record<string, unknown> = {};
  try {
    const res = await fetch(ENDPOINT);
    if (!res.ok) return; // no endpoint (e.g. prod) → skip; keep localStorage as-is
    fileData = (await res.json()) as Record<string, unknown>;
  } catch {
    return;
  }
  // Recover any store the browser is missing (fresh/cleared browser → restore from disk).
  for (const key of KEYS) {
    if (localStorage.getItem(key) == null && fileData[key] != null) {
      localStorage.setItem(key, JSON.stringify(fileData[key]));
    }
  }
  // Re-seed the file from the now-current local state (first run migrates existing data).
  postSnapshot();
}
