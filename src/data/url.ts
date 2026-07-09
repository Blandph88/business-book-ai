// The single canonical contact key. LinkedIn URLs vary by www vs country subdomain (uk./de.), case,
// trailing slash, and tracking query — all of which must collapse to ONE key so a person's meetings,
// opportunities, owner edits and a manual-add all attach to the same record (and survive a re-import).
// A LinkedIn profile reduces to `https://www.linkedin.com/in/<slug>`; anything else is lowercased with
// query/fragment/trailing-slash stripped. Dependency-free so both data/ and storage/ can share it (no
// import cycle via linkedinImport → classify).
export function normalizeUrl(url: string | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  const m = trimmed.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  if (m) return `https://www.linkedin.com/in/${m[1].toLowerCase()}`;
  return trimmed.toLowerCase().split("?")[0].split("#")[0].replace(/\/+$/, "");
}

// A stable, deterministic key for a contact whose LinkedIn profile URL is missing (restricted profiles),
// derived from their name — so they're KEPT (not dropped) and a re-import collapses them onto the same
// record instead of duplicating. Returns "" if there's no name to key on. Passes through normalizeUrl
// unchanged (no ?#/ chars), so it can live in the same `url` field as a real URL.
export function syntheticContactKey(first?: string, last?: string): string {
  // Keep ANY Unicode letter/number (\p{L}\p{N}), not just ASCII, so a fully non-Latin name (e.g. Chinese,
  // Arabic, Cyrillic) still produces a stable key instead of collapsing to "" and dropping the contact.
  // Separators (spaces, punctuation, and any ?#/ that would confuse normalizeUrl) collapse to "-".
  const slug = `${first ?? ""} ${last ?? ""}`.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  return slug ? `name:${slug}` : "";
}
