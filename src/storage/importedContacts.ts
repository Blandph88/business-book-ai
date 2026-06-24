// The buyer's own contacts, imported from their LinkedIn export (owned mode). Stored in
// IndexedDB, NOT localStorage: a real consultant's network can be tens of thousands of
// connections, which blows past localStorage's ~5 MB cap. IndexedDB has no practical limit.
// Scoped by app mode so a demo and a purchased copy never share data.

import type { Contact } from "../data/contacts";
import { getAppMode } from "../lib/appMode";

const DB_NAME = "bob-imported";
const STORE = "contacts";
const recordKey = () => (getAppMode() === "owned" ? "owned" : "demo");

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadImportedContacts(): Promise<Contact[]> {
  try {
    const db = await openDb();
    return await new Promise<Contact[]>((resolve, reject) => {
      const q = db.transaction(STORE, "readonly").objectStore(STORE).get(recordKey());
      q.onsuccess = () => resolve(Array.isArray(q.result) ? (q.result as Contact[]) : []);
      q.onerror = () => reject(q.error);
    });
  } catch {
    return [];
  }
}

// Replace the imported set (a re-import is "latest export wins"). Owner edits live in their
// own store keyed by URL, so they overlay and survive a re-import.
export async function saveImportedContacts(contacts: Contact[]): Promise<Contact[]> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(contacts, recordKey());
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return contacts;
}

export async function hasImportedContacts(): Promise<boolean> {
  return (await loadImportedContacts()).length > 0;
}
