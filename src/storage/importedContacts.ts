// The buyer's own contacts, imported from their LinkedIn export (owned mode). Scoped by app mode
// so a demo and a purchased copy never share data.
//
// Storage: IndexedDB WHEN AVAILABLE (a real network can be tens of thousands of connections, which
// blows past localStorage's ~5 MB cap; IndexedDB has no practical limit). But IndexedDB is DENIED
// in some contexts — notably a sandboxed null-origin iframe, which is how Freehold seals an app
// (indexedDB.open() throws "access to the Indexed Database API is denied in this context"). There
// we FALL BACK to localStorage, which the seal shims to the buyer's persistent vault. Probed
// lazily: the first time IndexedDB throws we remember it and use localStorage from then on.

import type { Contact } from "../data/contacts";
import { getAppMode } from "../lib/appMode";

const DB_NAME = "bob-imported";
const STORE = "contacts";
const recordKey = () => (getAppMode() === "owned" ? "owned" : "demo");
const lsKey = () => `bob.imported.${recordKey()}`;

// Once IndexedDB has failed (denied in this context), don't keep retrying it.
let idbDenied = false;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // indexedDB.open can THROW synchronously when denied — the Promise executor turns that into a
    // rejection, which callers catch to fall back to localStorage.
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function lsLoad(): Contact[] {
  try {
    const raw = localStorage.getItem(lsKey());
    return raw ? (JSON.parse(raw) as Contact[]) : [];
  } catch {
    return [];
  }
}

export async function loadImportedContacts(): Promise<Contact[]> {
  if (!idbDenied) {
    try {
      const db = await openDb();
      return await new Promise<Contact[]>((resolve, reject) => {
        const q = db.transaction(STORE, "readonly").objectStore(STORE).get(recordKey());
        q.onsuccess = () => resolve(Array.isArray(q.result) ? (q.result as Contact[]) : []);
        q.onerror = () => reject(q.error);
      });
    } catch {
      idbDenied = true; // fall through to localStorage
    }
  }
  return lsLoad();
}

// Replace the imported set (a re-import is "latest export wins"). Owner edits live in their own
// store keyed by URL, so they overlay and survive a re-import.
export async function saveImportedContacts(contacts: Contact[]): Promise<Contact[]> {
  if (!idbDenied) {
    try {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(contacts, recordKey());
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return contacts;
    } catch {
      idbDenied = true; // fall through to localStorage
    }
  }
  try {
    localStorage.setItem(lsKey(), JSON.stringify(contacts));
  } catch {
    throw new Error(
      "Couldn't save your import — your browser's storage may be full. Try a smaller export.",
    );
  }
  return contacts;
}

export async function hasImportedContacts(): Promise<boolean> {
  return (await loadImportedContacts()).length > 0;
}
