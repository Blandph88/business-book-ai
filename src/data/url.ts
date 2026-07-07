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
