// Full-book backup & restore — the buyer's own data, exported to a single portable file so a browser
// reset or a new laptop can't lose it. This module is PURE (serialise + optional encryption + restore);
// the actual file I/O (a download, or a connected file via the Freehold broker) is the caller's job,
// because the sealed iframe has no direct file access — see storage/backupFile + the parent broker.
//
// What's in a backup: EVERY owner-scoped store (meetings, opportunities, engagements, owner edits,
// manually-added contacts, targets, AND the copilot chats + its distilled memory) plus the full imported
// contact network. Nothing about the buyer's book is left out.
//
// Encryption: optional passphrase → AES-256-GCM with a PBKDF2-derived key (Web Crypto, no dependencies).
// If a passphrase is set the file is ciphertext, so it's safe to keep in a synced cloud folder (Dropbox
// etc.) — only the holder of the passphrase can read it. Lose the passphrase and the backup is unrecoverable
// (that's the point — it's zero-knowledge). This is the seed of the E2EE vault's crypto.

import { scopedKey } from "./persist";
import { loadImportedContacts, saveImportedContacts } from "./importedContacts";
import type { Contact } from "../data/contacts";

// The BASE keys of every owner store (scopedKey maps these to the "bob.owned.*" namespace at read/write).
// Stored un-scoped in the file so a backup is legible and portable; re-scoped on restore.
const STORE_KEYS = [
  "bob.contactOwnerEdits.v1",
  "bob.meetings.v2",
  "bob.opportunities.v2",
  "bob.revenue.v1",
  "bob.chats.v1", // copilot conversations
  "bob.memory.v1", // copilot distilled memory
  "bob.ownedContacts.v1", // manually-added contacts
  "bob.targets.v1",
] as const;

export const BACKUP_FORMAT = "freehold-book-backup";
export const BACKUP_APP = "business-book-ai";
export const BACKUP_SCHEMA = 1;

// The in-memory shape of a full book.
export type BookBackup = {
  exportedAt: string;
  stores: Record<string, unknown>; // baseKey → parsed store value (omits empty/corrupt stores)
  contacts: Contact[];
};

// ── gather / apply the owner stores ──────────────────────────────────────────────────────────────
function gatherStores(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const base of STORE_KEYS) {
    const raw = localStorage.getItem(scopedKey(base));
    if (raw == null) continue;
    try { out[base] = JSON.parse(raw); } catch { /* skip a corrupt store rather than back up garbage */ }
  }
  return out;
}

function applyStores(stores: Record<string, unknown>): void {
  for (const base of STORE_KEYS) {
    if (!(base in stores)) continue;
    localStorage.setItem(scopedKey(base), JSON.stringify(stores[base]));
  }
}

/** Snapshot the whole book into a plain object (no file I/O). */
export async function exportBook(): Promise<BookBackup> {
  const contacts = await loadImportedContacts();
  return { exportedAt: new Date().toISOString(), stores: gatherStores(), contacts };
}

/**
 * Restore a book, REPLACING the current one. Caller must confirm with the user first, and must re-render
 * in-app afterwards — NEVER location.reload() (a sealed reload replays the stale launch seed; the
 * seal-reload gotcha that has eaten data before). Validate before calling: a bad file must not reach here.
 */
export async function importBook(book: BookBackup): Promise<void> {
  applyStores(book.stores);
  await saveImportedContacts(book.contacts || []);
}

// ── serialise / parse (with optional passphrase encryption) ──────────────────────────────────────
const b64 = {
  enc: (buf: ArrayBuffer | Uint8Array): string => {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  },
  dec: (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

const PBKDF2_ITERATIONS = 210_000; // OWASP-ish floor for SHA-256

// Coerce a Uint8Array to BufferSource — newer TS parameterises Uint8Array over ArrayBufferLike, which the
// Web Crypto DOM types (BufferSource = ArrayBufferView<ArrayBuffer>) reject; the runtime is fine.
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", bs(new TextEncoder().encode(passphrase)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bs(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Serialise a book to the file text. With a passphrase → an encrypted envelope (safe for a cloud folder);
 * without → readable JSON (label it clearly to the user as unencrypted).
 */
export async function serializeBackup(book: BookBackup, passphrase?: string): Promise<string> {
  const head = { format: BACKUP_FORMAT, app: BACKUP_APP, schema: BACKUP_SCHEMA, exportedAt: book.exportedAt };
  if (!passphrase) {
    return JSON.stringify({ ...head, encrypted: false, stores: book.stores, contacts: book.contacts });
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify({ stores: book.stores, contacts: book.contacts }));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(plaintext));
  return JSON.stringify({
    ...head, encrypted: true,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS, salt: b64.enc(salt) },
    cipher: { name: "AES-GCM", iv: b64.enc(iv) },
    payload: b64.enc(cipher),
  });
}

export class BackupError extends Error {}

/**
 * Parse a backup file back into a book. Throws a BackupError with a user-facing message on: not a Freehold
 * backup, wrong app, needs-a-passphrase, or wrong passphrase. Validate-before-restore: this never touches
 * live data, so a bad file fails cleanly instead of half-wiping the book.
 */
export async function parseBackup(text: string, passphrase?: string): Promise<BookBackup> {
  let doc: Record<string, unknown>;
  try { doc = JSON.parse(text); } catch { throw new BackupError("That doesn't look like a backup file."); }
  if (doc.format !== BACKUP_FORMAT) throw new BackupError("That's not a Freehold backup file.");
  if (doc.app !== BACKUP_APP) throw new BackupError(`That backup is for a different app (${String(doc.app)}), not Business Book.`);
  const exportedAt = typeof doc.exportedAt === "string" ? doc.exportedAt : "";

  if (!doc.encrypted) {
    return { exportedAt, stores: (doc.stores as Record<string, unknown>) || {}, contacts: (doc.contacts as Contact[]) || [] };
  }
  if (!passphrase) throw new BackupError("This backup is encrypted — enter the passphrase you set when you exported it.");
  const kdf = doc.kdf as { iterations?: number; salt?: string } | undefined;
  const cipherMeta = doc.cipher as { iv?: string } | undefined;
  if (!kdf?.salt || !cipherMeta?.iv || typeof doc.payload !== "string") throw new BackupError("This backup file is corrupt or incomplete.");
  const salt = b64.dec(kdf.salt);
  const base = await crypto.subtle.importKey("raw", bs(new TextEncoder().encode(passphrase)), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bs(salt), iterations: kdf.iterations || PBKDF2_ITERATIONS, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
  );
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bs(b64.dec(cipherMeta.iv)) }, key, bs(b64.dec(doc.payload)));
  } catch {
    throw new BackupError("Wrong passphrase — that didn't unlock the backup."); // GCM auth-tag failure
  }
  const inner = JSON.parse(new TextDecoder().decode(plain)) as { stores: Record<string, unknown>; contacts: Contact[] };
  return { exportedAt, stores: inner.stores || {}, contacts: inner.contacts || [] };
}

/** A stable, human-friendly filename for a downloaded backup. */
export function backupFilename(exportedAt = new Date().toISOString()): string {
  return `business-book-backup-${exportedAt.slice(0, 10)}.fbk.json`;
}
