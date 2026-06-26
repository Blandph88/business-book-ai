// AI classification fallback for the LinkedIn import (#1). The deterministic classifier handles the
// bulk; this mops up the "Other / Smaller firms" tail. It works at the COMPANY level (dedupe →
// classify each unique firm once → apply to all its contacts), which is what makes it feasible
// on-device: a few dozen unique companies, not thousands of per-contact calls. Owned mode only.

import { loadImportedContacts, saveImportedContacts } from "../storage/importedContacts";
import { OTHER_INDUSTRY_LABEL } from "../config/markets";
import { SECTOR_GROUPS } from "../data/vocab";
import { aiJson } from "./ai";
import type { Contact } from "../data/contacts";

export type EnrichResult = { updated: number; companies: number; contacts: Contact[] };

const BATCH = 20; // classify this many companies per prompt
const CAP = 60; // don't process an unbounded tail on-device

async function classifyCompanies(companies: string[]): Promise<Record<string, string>> {
  const groups = SECTOR_GROUPS.filter((g) => g !== OTHER_INDUSTRY_LABEL);
  return aiJson<Record<string, string>>({
    system: "You classify companies into one industry group each. Reply with ONLY a JSON object mapping each company name to one group.",
    prompt:
      `Groups: ${JSON.stringify(groups)}.\n` +
      `Classify each company into exactly one group. Use "${OTHER_INDUSTRY_LABEL}" only if genuinely unknown.\n` +
      `Return JSON of the form {"<company>": "<group>"}.\n\nCompanies:\n${companies.join("\n")}`,
  });
}

export async function enrichOtherCompanies(onProgress?: (done: number, total: number) => void): Promise<EnrichResult> {
  const contacts = await loadImportedContacts();
  if (!contacts.length) return { updated: 0, companies: 0, contacts };

  // Unique unclassified companies, most-common first (most leverage per AI call).
  const freq = new Map<string, number>();
  for (const c of contacts) {
    const org = c.organisation?.trim();
    if (org && c.sector_group === OTHER_INDUSTRY_LABEL) freq.set(org, (freq.get(org) ?? 0) + 1);
  }
  const companies = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, CAP).map((e) => e[0]);
  if (!companies.length) return { updated: 0, companies: 0, contacts };

  const mapping: Record<string, string> = {};
  for (let i = 0; i < companies.length; i += BATCH) {
    try {
      Object.assign(mapping, await classifyCompanies(companies.slice(i, i + BATCH)));
    } catch {
      /* skip a failed batch rather than abort the whole run */
    }
    onProgress?.(Math.min(i + BATCH, companies.length), companies.length);
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
  return { updated, companies: companies.length, contacts: next };
}

// How many contacts are still unclassified — drives whether to offer the enrichment action.
export function countUnclassified(contacts: Contact[]): number {
  return contacts.filter((c) => c.sector_group === OTHER_INDUSTRY_LABEL).length;
}
