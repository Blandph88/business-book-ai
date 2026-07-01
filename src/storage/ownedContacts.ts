// Net-new contacts the owner adds MANUALLY (people met who aren't in their LinkedIn export — not every
// business contact is on LinkedIn). These live in their own store and get MERGED into loadContacts()
// alongside the imported/demo CSV rows, so they show up everywhere (lists, facets, the copilot, account
// views) exactly like an imported contact. Their `url` is a synthetic "manual:<id>" key — the same stable
// key meetings, opportunities and owner-edits hang off, so nothing else needs special-casing.
//
// (A later phase reconciles these against the NEXT LinkedIn import — if a manually-added person turns up in
// a fresh export, merge them. For now they simply coexist.)
import { persistLocal, scopedKey } from "./persist";
import type { Contact } from "../data/contacts";

const STORAGE_KEY = scopedKey("bob.ownedContacts.v1");

export function loadOwnedContacts(): Contact[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as Contact[]) : [];
  } catch {
    console.warn("Could not parse saved manual contacts; starting fresh.");
    return [];
  }
}

export function saveAllOwnedContacts(all: Contact[]): Contact[] {
  persistLocal(STORAGE_KEY, JSON.stringify(all));
  return all;
}

// Add or replace one manual contact (keyed by url), returning the new list.
export function saveOwnedContact(c: Contact): Contact[] {
  const all = loadOwnedContacts().filter((x) => x.url !== c.url);
  all.push(c);
  return saveAllOwnedContacts(all);
}

export function deleteOwnedContact(url: string): Contact[] {
  return saveAllOwnedContacts(loadOwnedContacts().filter((x) => x.url !== url));
}

// A fresh synthetic key for a manual contact (never collides with a LinkedIn url).
export function newManualContactId(): string {
  const rnd = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  return `manual:${rnd}`;
}

// The stable KEY (url) for a manual contact. If the owner pasted the person's LinkedIn URL, canonicalise it
// and use THAT as the key — so when they later re-import a refreshed LinkedIn export, the same person (same
// url) collapses onto this record automatically (their meetings/notes/opps stay attached, no duplicate). If
// no usable LinkedIn URL was given, fall back to a synthetic id.
export function contactKeyFromLinkedIn(linkedinUrl?: string): string {
  const m = (linkedinUrl || "").trim().match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  return m ? `https://www.linkedin.com/in/${m[1].toLowerCase()}` : newManualContactId();
}
