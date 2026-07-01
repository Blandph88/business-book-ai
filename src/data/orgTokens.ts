// Data-derived "org-noise" for entity matching. Tokens that recur across MANY real organisation names
// ("bank", "group", "financial", "university", "technologies"…) carry almost no signal for identifying
// WHICH company a user means — so they must never single-handedly match a company (else "University of
// Oxford" in an answer matches the unrelated "Harvard University"). We DERIVE this set by document-
// frequency from the ~2,000-org dictionary (mined + pressure-tested against real LinkedIn data) rather
// than hand-maintaining a list, so it stays current as the dictionary grows — retiring a whole class of
// one-off "add another noise word" patches.
//
// This is DISTINCT from the small, stable COMMAND stoplist (open/list/my/who/chase/show…) — those are
// verbs and query words, not org-common words, and live next to the matcher in CopilotBar.
import { COMPANY_DICTIONARY } from "../config/markets";

// Lowercase, strip diacritics + legal suffixes + punctuation, then split — mirrors classify.ts's normCompany.
function tokenise(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|group|holdings|holding|sa|ag|gmbh|nv|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

// Document frequency: how many DISTINCT organisations contain each token (across names + aliases).
const df = new Map<string, number>();
for (const e of COMPANY_DICTIONARY) {
  const seen = new Set<string>();
  for (const raw of [e.name, ...(e.aliases ?? [])]) for (const t of tokenise(raw)) seen.add(t);
  for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
}

// A token appearing in ≥ this many distinct orgs is "common" → too low-signal to identify one company.
const COMMON_DF_THRESHOLD = 4;
export const COMMON_ORG_TOKENS: Set<string> = new Set(
  [...df.entries()].filter(([, n]) => n >= COMMON_DF_THRESHOLD).map(([t]) => t),
);

// Is this token too common across the org corpus to single-handedly identify a company?
export function isCommonOrgToken(token: string): boolean {
  return COMMON_ORG_TOKENS.has(token.toLowerCase());
}
