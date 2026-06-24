// Persistence for the owner-maintained contact columns (CLAUDE.md §4).
//
// Per CLAUDE.md §3 we start with browser storage — no database yet. Everything the
// owner types/selects on the Contacts tab is saved to localStorage, keyed by the
// contact's LinkedIn `url` (the only stable unique field the pipeline gives us).
//
// Keeping owner edits in their OWN store — separate from the pipeline CSV — means
// re-running the pipeline never overwrites the owner's notes, and vice versa.

import type {
  RelationshipStrength,
  Priority,
  DecisionRole,
} from "../data/vocab";
import { persistLocal, scopedKey } from "./persist";

// The eight owner-editable fields (CLAUDE.md §4). All optional: a brand-new contact
// has none of these set yet. Dropdown fields use the vocab union types; free-text and
// date fields are plain strings (dates as ISO "YYYY-MM-DD" from <input type="date">).
export type OwnerEdits = {
  based_in?: string;
  relationship_strength?: RelationshipStrength;
  priority?: Priority;
  decision_role?: DecisionRole;
  last_contact_date?: string;
  next_action?: string;
  next_action_date?: string;
  notes?: string;
  // A manually-entered phone/WhatsApp number. Overrides the pipeline's `phone` (which
  // is auto-extracted from messages) so the owner can add a number for any contact.
  // Left unset (not "") when blank, so it never clobbers the pipeline number on merge.
  phone?: string;
};

// A map of contact url → that contact's edits. We store the whole map under one
// localStorage key (small data set; one read/write is simpler than per-row keys).
type EditsByUrl = Record<string, OwnerEdits>;

const STORAGE_KEY = scopedKey("bob.contactOwnerEdits.v1");

// Normalise a LinkedIn URL before using it as the edit key, so a future re-export
// that writes the same profile slightly differently (trailing slash, different
// casing, a tracking query string) still matches edits saved earlier. This protects
// the owner's hand-entered data from silently orphaning across pipeline refreshes.
export function normalizeUrl(url: string): string {
  return (url ?? "").trim().toLowerCase().split("?")[0].replace(/\/+$/, "");
}

// Look up one contact's edits by (normalised) url. Use this everywhere instead of
// indexing the map directly, so every read goes through the same normalisation.
export function editsFor(
  all: EditsByUrl,
  url: string,
): OwnerEdits | undefined {
  return all[normalizeUrl(url)];
}

// Read every saved edit. Returns an empty map if nothing is stored yet or if the
// stored value is somehow corrupt (we fail safe rather than crash the tab).
export function loadAllEdits(): EditsByUrl {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as EditsByUrl;
  } catch {
    console.warn("Could not parse saved contact edits; starting fresh.");
    return {};
  }
}

// Save one contact's edits, merged into the existing map, and return the new map so
// the caller can update React state from the same source of truth.
export function saveEdits(url: string, edits: OwnerEdits): EditsByUrl {
  const all = loadAllEdits();
  all[normalizeUrl(url)] = edits;
  persistLocal(STORAGE_KEY, JSON.stringify(all));
  return all;
}
