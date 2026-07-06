// Loads the pipeline's enriched contacts CSV and turns it into typed rows.
//
// IMPORTANT (CLAUDE.md §2): the app reads the pipeline's OUTPUT, never the raw
// LinkedIn files. The file lives at web/public/contacts_enriched.csv and is served
// as a static asset, so we just fetch it. When the owner runs the real pipeline,
// they overwrite that one file — no code change needed here.

import Papa from "papaparse";
import { getAppMode } from "../lib/appMode";
import { loadImportedContacts } from "../storage/importedContacts";
import { loadOwnedContacts } from "../storage/ownedContacts";
import { seedDemoEnrichment } from "./demoEnrichment";
import { SECTOR_GROUPS } from "./vocab";
import { OTHER_INDUSTRY_LABEL } from "../config/markets";

// One contact, exactly the read-only columns the pipeline produces (CLAUDE.md §4).
// Owner-maintained columns are kept SEPARATE (see storage/ownerEdits.ts) so the two
// data sources never get muddled: re-running the pipeline can't clobber owner notes.
export type Contact = {
  first: string;
  last: string;
  organisation: string;
  position: string;
  sector_detail: string;
  sector_group: string;
  // A finer band WITHIN a sector group (e.g. Commercial Banks / Digital Banks / Fintech
  // & Payments), used to section the detailed matrix. Empty/equal to sector_group for
  // groups that aren't sub-banded. Comes from the pipeline (never derived in JS — §3).
  sub_group: string;
  seniority: string;
  function: string;
  // The funnel flags, normalised to real booleans. `met` is a heuristic from the
  // pipeline (owner sent a post-meeting thank-you); the app unions it with meetings
  // manually marked "Held" to decide the funnel's "Met" stage.
  messaged: boolean;
  responded: boolean;
  two_way: boolean;
  agreed_to_meet: boolean;
  met: boolean;
  // The LinkedIn URL. This is also our stable unique key for owner edits.
  url: string;
  // A mobile number the contact typed into their LinkedIn messages, as E.164 digits
  // (e.g. "966557312825"), or "" if none. Used to build a WhatsApp link. The owner can
  // override/add one per contact via OwnerEdits.phone (see storage/ownerEdits.ts).
  phone: string;
  // The messages THIS contact sent the owner (inbound), captured at import from messages.csv.
  // Their own words are the truest warmth signal — funnel stage only says they *agreed*, not how
  // keen they were. Feeds the LLM sentiment pass (ai/sentiment.ts) and stays for future analysis.
  inbound?: InboundMessage[];
  // The LLM-derived relationship warmth from `inbound`, precomputed once (not per query). score 0–10
  // (higher = warmer/keener); label a short read ("keen"/"warm"/"neutral"/"cool"). Folded into warmth().
  warmthSentiment?: WarmthSentiment;
  // Deterministic thread signal from import (BOTH sides, no LLM): who messaged last + when, counts each way.
  thread?: ThreadMeta;
  // A latent opportunity the LLM spotted in this contact's messages (a need/project not yet in the pipeline),
  // from the opt-in Opportunity Scan. `text` "" = scanned, nothing found (so a re-run can skip; resumable).
  latentOpp?: LatentOpp;
};

// A detected in-thread opportunity. `text` = a short description of the need ("" = scanned, none found).
export type LatentOpp = { at: string; text: string };

// One inbound message from a contact (their side of the thread only). `date` is ISO (YYYY-MM-DD) or "".
export type InboundMessage = { date: string; text: string };
// The precomputed sentiment read for a contact. `at` = when it was scored (ISO), so a re-import can tell
// which contacts are already done and skip them (the pass is resumable).
export type WarmthSentiment = { score: number; label?: string; at?: string };
// Deterministic thread signal. `lastFromOwner` true = owner sent last (the CONTACT owes a reply);
// false = the contact sent last (the OWNER owes the reply). Counts are messages each way.
export type ThreadMeta = { lastDate: string; lastFromOwner: boolean; inboundCount: number; outboundCount: number };

// The CSV stores booleans as the strings "True"/"False" (Python's str(bool)).
// Parse them defensively: trim, lowercase, and treat only "true" as true.
function toBool(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}

// Parse enriched-CSV text into Contact rows. We let PapaParse handle the messy parts
// (quoted fields with embedded commas, like "Capital, Insurance & Invest"). `header:
// true` maps each row to an object keyed by the header names, so column order doesn't
// matter — and a file missing some columns (e.g. connections_enriched.csv has no funnel
// flags) just yields the safe defaults below.
function parseContactRows(text: string): Contact[] {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  return parsed.data.map((row) => ({
    first: row.first ?? "",
    last: row.last ?? "",
    organisation: row.organisation ?? "",
    position: row.position ?? "",
    sector_detail: row.sector_detail ?? "",
    sector_group: row.sector_group ?? "",
    // Fall back to the broad group when absent, so a row is always in exactly one band.
    sub_group: row.sub_group || row.sector_group || "",
    seniority: row.seniority ?? "",
    function: row.function ?? "",
    messaged: toBool(row.messaged),
    responded: toBool(row.responded),
    two_way: toBool(row.two_way),
    agreed_to_meet: toBool(row.agreed_to_meet),
    // `met` is no longer a pipeline column — it's derived in the app from Held meetings.
    met: toBool(row.met),
    url: row.url ?? "",
    phone: row.phone ?? "",
  }));
}

// Fetch and parse the enriched (target pipeline) CSV.
// OWNED mode (a purchased copy) reads the buyer's own imported network instead of the
// baked-in demo sample — see storage/importedContacts.ts + components/ImportModal.tsx.
// Heal any contact whose sector_group isn't a current group — e.g. data imported BEFORE a
// label was renamed (old "Other Industries" → "Other / Smaller firms") — by folding it into
// the catch-all. Keeps already-imported books showing correctly without forcing a re-import.
const KNOWN_GROUPS = new Set<string>(SECTOR_GROUPS);
function normalizeGroups(contacts: Contact[]): Contact[] {
  return contacts.map((c) => {
    let n = c;
    if (n.sector_group && !KNOWN_GROUPS.has(n.sector_group))
      n = { ...n, sector_group: OTHER_INDUSTRY_LABEL };
    // Heal the "Head of" → "Head of / Director" seniority-band rename for data imported earlier.
    if (n.seniority === "Head of") n = { ...n, seniority: "Head of / Director" };
    return n;
  });
}

export async function loadContacts(): Promise<Contact[]> {
  const base = getAppMode() === "owned"
    ? normalizeGroups(await loadImportedContacts())
    : seedDemoEnrichment(normalizeGroups(parseContactRows(await loadDemoCsv()))); // sample book: pre-lit AI signals
  // Merge in any contacts the owner added manually (people not in their LinkedIn export). Keyed by url,
  // owner-added winning a collision — so they appear in every list/facet exactly like an imported contact.
  const owned = loadOwnedContacts();
  if (!owned.length) return base;
  const byUrl = new Map(base.map((c) => [c.url, c]));
  for (const c of normalizeGroups(owned)) byUrl.set(c.url, c);
  return [...byUrl.values()];
}

async function loadDemoCsv(): Promise<string> {
  const response = await fetch("contacts_enriched.csv");
  if (!response.ok) {
    throw new Error(
      `Could not load contacts CSV (HTTP ${response.status}). ` +
        `Expected it at web/public/contacts_enriched.csv.`,
    );
  }
  return response.text();
}

// Fetch and parse ALL accepted connections (incl. out-of-scope, where sector_group is
// "Out of Scope"). Used by the Connections/Invitations funnel stages + their matrices.
// Funnel flags aren't in this file, so they default false — only name/org/sector/
// seniority are used. Returns [] if the file isn't present yet.
export async function loadConnections(): Promise<Contact[]> {
  if (getAppMode() === "owned") return loadImportedContacts();
  const response = await fetch("connections_enriched.csv");
  if (!response.ok) return [];
  return parseContactRows(await response.text());
}
