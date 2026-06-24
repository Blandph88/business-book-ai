// Detects owner-entered data that has been "orphaned" by a pipeline refresh.
//
// Owner data (contact notes, meetings, opportunities) lives in localStorage keyed by a
// contact's LinkedIn url. If a re-run of the pipeline drops a contact (e.g. they fall
// out of the target universe, or their url changes), that owner data is still saved but
// no longer shows on the Contacts tab — it's silently stranded. Rather than let it
// vanish unseen (CLAUDE.md §6 rule 5: surface, don't paper over), we detect it on load
// and show a dismissable notice so the owner can recover or re-link it.
//
// This is READ-ONLY detection — nothing is deleted.

import type { Contact } from "./contacts";
import type { OwnerEdits } from "../storage/ownerEdits";
import type { Meeting } from "../storage/meetings";
import type { Opportunity } from "../storage/opportunities";

export type Orphan = {
  kind: "Contact note" | "Meeting" | "Opportunity";
  label: string; // best human label we have for it
  url: string; // the missing contact's url (so the owner can find them on LinkedIn)
};

// True if an owner-edits record holds anything worth keeping (so we don't flag an
// empty {} that some earlier interaction may have left behind).
function hasAnyEdit(e: OwnerEdits): boolean {
  return Object.values(e).some((v) => v !== undefined && v !== "");
}

// Records keyed to the synthetic sample fixture (data/sample_contacts.csv uses
// example.com URLs) are leftover from running the app on demo data — never real
// stranded work — so we ignore them rather than nag about them.
function isSampleUrl(url: string): boolean {
  return url.includes("example.com");
}

// Find every owner record pointing at a contact url that's no longer in the CSV.
export function detectOrphans(
  contacts: Contact[],
  edits: Record<string, OwnerEdits>,
  meetings: Meeting[],
  opps: Opportunity[],
): Orphan[] {
  const present = new Set(contacts.map((c) => c.url));
  const orphans: Orphan[] = [];

  for (const [url, e] of Object.entries(edits)) {
    if (!present.has(url) && !isSampleUrl(url) && hasAnyEdit(e)) {
      orphans.push({ kind: "Contact note", label: url, url });
    }
  }

  for (const m of meetings) {
    if (m.contact_url && !present.has(m.contact_url) && !isSampleUrl(m.contact_url)) {
      orphans.push({
        kind: "Meeting",
        label: `Meeting #${m.meeting_no}`,
        url: m.contact_url,
      });
    }
  }

  // Only opportunities explicitly LINKED to a contact can be orphaned; a manual,
  // free-text opportunity was never tied to a contact url, so it can't strand.
  for (const o of opps) {
    if (o.contact_url && !present.has(o.contact_url) && !isSampleUrl(o.contact_url)) {
      orphans.push({
        kind: "Opportunity",
        label: o.opportunity_name || o.organisation || o.contact_url,
        url: o.contact_url,
      });
    }
  }

  return orphans;
}
