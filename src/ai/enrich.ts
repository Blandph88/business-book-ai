// AI classification fallback for the LinkedIn import (#1). The deterministic classifier handles the
// bulk; this mops up the "Other / Smaller firms" tail. It works at the COMPANY level (dedupe →
// classify each unique firm once → apply to all its contacts), which is what makes it feasible
// on-device: a few dozen unique companies, not thousands of per-contact calls. Owned mode only.

import { loadImportedContacts, saveImportedContacts } from "../storage/importedContacts";
import { OTHER_INDUSTRY_LABEL } from "../config/markets";
import { SECTOR_GROUPS } from "../data/vocab";
import { aiJson, searchAvailable, searchEntity, aiAvailability, isCapableBackend } from "./ai";
import type { Contact } from "../data/contacts";

export type EnrichResult = { updated: number; companies: number; contacts: Contact[]; grounded: boolean };

const BATCH = 20; // classify this many companies per prompt
const CAP = 60; // don't process an unbounded tail on-device

type Entry = { name: string; hint?: string };

async function classifyCompanies(entries: Entry[], grounded: boolean): Promise<Record<string, string>> {
  const groups = SECTOR_GROUPS.filter((g) => g !== OTHER_INDUSTRY_LABEL);
  const lines = entries.map((e) => (e.hint ? `${e.name} — ${e.hint}` : e.name)).join("\n");
  return aiJson<Record<string, string>>({
    system: grounded
      ? "You classify companies into one industry group each, using the short description provided for each. " +
        "Base the group on the description. If a line has no description and you don't recognise the company, leave it unclassified. " +
        "Reply with ONLY a JSON object keyed by the company NAME (the text before any dash)."
      : "You classify companies into one industry group each, using ONLY firms you genuinely recognise. You have no internet access — " +
        "answer only from what you actually know. It is much better to leave a company unclassified than to guess wrong. " +
        "Reply with ONLY a JSON object mapping each company name to one group.",
    prompt:
      `Groups: ${JSON.stringify(groups)}.\n` +
      `For each line, return the best group, or "${OTHER_INDUSTRY_LABEL}" if unsure — do NOT guess.\n` +
      `Return JSON keyed by the exact company name: {"<company>": "<group>"}.\n\n${lines}`,
  });
}

export async function enrichOtherCompanies(opts: { onProgress?: (done: number, total: number, current?: string) => void; signal?: { aborted: boolean } } = {}): Promise<EnrichResult> {
  const onProgress = opts.onProgress;
  const contacts = await loadImportedContacts();
  if (!contacts.length) return { updated: 0, companies: 0, contacts, grounded: false };

  // Unique unclassified companies, most-common first (most leverage per AI call).
  const freq = new Map<string, number>();
  for (const c of contacts) {
    const org = c.organisation?.trim();
    if (org && c.sector_group === OTHER_INDUSTRY_LABEL) freq.set(org, (freq.get(org) ?? 0) + 1);
  }
  // A capable backend (cloud or local server) does the WHOLE unknown-firm tail; the in-browser model stays
  // capped so it doesn't grind. Most-common firms first either way (most leverage per call).
  const capable = isCapableBackend((await aiAvailability()).backend);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const companies = capable ? sorted : sorted.slice(0, CAP);
  if (!companies.length) return { updated: 0, companies: 0, contacts, grounded: false };

  // Ramped batches: a tiny FIRST batch so progress + the banner move within seconds (the 20-firm batch +
  // web lookups is otherwise a slow first step), then full-size batches.
  const batches: string[][] = [];
  let s0 = 0;
  if (companies.length > 4) { batches.push(companies.slice(0, 4)); s0 = 4; }
  for (let i = s0; i < companies.length; i += BATCH) batches.push(companies.slice(i, i + BATCH));

  // If web search is granted, ground each firm in a one-line Wikipedia description before classifying
  // (far more accurate than the model guessing from the name alone). Otherwise fall back to recall.
  const grounded = await searchAvailable();
  const mapping: Record<string, string> = {};
  let done = 0;
  for (const batch of batches) {
    if (opts.signal?.aborted) break; // cancelled → stop; whatever we've mapped so far is still applied + saved below
    let entries: Entry[] = batch.map((name) => ({ name }));
    if (grounded) {
      const facts = await Promise.all(batch.map((c) => searchEntity(c).catch(() => ({ found: false }) as Awaited<ReturnType<typeof searchEntity>>)));
      entries = batch.map((name, k) => {
        const f = facts[k];
        const hint = f.found ? (f.description || f.extract || "").slice(0, 160) : "";
        return { name, hint: hint || undefined };
      });
    }
    try {
      Object.assign(mapping, await classifyCompanies(entries, grounded));
    } catch {
      /* skip a failed batch rather than abort the whole run */
    }
    done += batch.length;
    onProgress?.(done, companies.length, batch[0]);
  }

  const valid = new Set<string>(SECTOR_GROUPS);
  let updated = 0;
  const next = contacts.map((c) => {
    const org = c.organisation?.trim();
    const g = org && c.sector_group === OTHER_INDUSTRY_LABEL ? mapping[org] : undefined;
    if (g && g !== OTHER_INDUSTRY_LABEL && valid.has(g)) {
      updated++;
      return { ...c, sector_group: g, sub_group: "" };
    }
    return c;
  });
  await saveImportedContacts(next);
  return { updated, companies: companies.length, contacts: next, grounded };
}

// How many contacts are still unclassified — drives whether to offer the enrichment action.
export function countUnclassified(contacts: Contact[]): number {
  return contacts.filter((c) => c.sector_group === OTHER_INDUSTRY_LABEL).length;
}
