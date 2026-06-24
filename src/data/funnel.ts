// Loads the pipeline's funnel-level outputs that the contacts CSV can't carry.
//
// `contacts_enriched.csv` holds only the TARGET pipeline (one row per target contact),
// so the two top-of-funnel stages — how many invitations were sent, and how many became
// connections — and the list of people who haven't accepted yet aren't in it. The
// pipeline writes those to two small companion files in web/public:
//   • funnel_summary.csv   — one row of funnel totals (counts only)
//   • pending_invites.csv  — outgoing invites that never became connections (name + url)
// Both are gitignored PII, refreshed by re-running the pipeline (same as the enriched CSV).

import Papa from "papaparse";

// The funnel totals, one row. Field names mirror the pipeline's funnel_summary.csv.
export type FunnelSummary = {
  invitations: number; // requests_sent — outgoing connection invitations
  connections: number; // accepted — invitees who became connections
  target: number; // target_pipeline — in-scope (non-consulting) connections
  messaged: number;
  responded: number;
  agreed: number;
  met: number;
  pendingInvites: number; // invitations not yet accepted (= invitations − connections)
};

// One person we invited who hasn't accepted yet. We only get name + URL (LinkedIn doesn't
// export a non-connection's company), plus when the invite was sent (to show how long
// it's been pending).
export type PendingInvite = {
  name: string;
  url: string;
  sent_at: string;
};

// Parse one number out of a raw CSV cell, defaulting to 0 so a missing/blank column
// never yields NaN downstream.
function num(value: string | undefined): number {
  const n = Number((value ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

// Fetch and parse the funnel totals. Returns null (not an error) if the file isn't there
// yet — the dashboard then falls back to the 5 stages it can derive from the contacts CSV
// alone, rather than failing to render.
export async function loadFunnelSummary(): Promise<FunnelSummary | null> {
  const response = await fetch("funnel_summary.csv");
  if (!response.ok) return null;
  const text = await response.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  const row = parsed.data[0];
  if (!row) return null;
  return {
    invitations: num(row.requests_sent),
    connections: num(row.accepted),
    target: num(row.target_pipeline),
    messaged: num(row.messaged),
    responded: num(row.responded),
    agreed: num(row.agreed_to_meet),
    met: num(row.met),
    pendingInvites: num(row.pending_invites),
  };
}

// Fetch and parse the pending-invites nudge list. Returns [] if the file isn't present.
export async function loadPendingInvites(): Promise<PendingInvite[]> {
  const response = await fetch("pending_invites.csv");
  if (!response.ok) return [];
  const text = await response.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  return parsed.data.map((row) => ({
    name: row.name ?? "",
    url: row.url ?? "",
    sent_at: row.sent_at ?? "",
  }));
}
