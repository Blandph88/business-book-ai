// A compact, factual snapshot of the whole book — the GROUNDING for the copilot's "ask about your
// data" chat. It's plain numbers computed locally from the user's own records, handed to the model so
// it answers from real facts (network size, pipeline, recent activity) instead of guessing or — the
// bug this fixes — forcing every question into a record filter and returning "No matches". Only counts
// and aggregates are sent, never the raw contact list (privacy: the model sees what the task needs).

import type { Contact } from "../data/contacts";
import type { MeetingRow } from "../data/meetings";
import type { Opportunity } from "../storage/opportunities";
import type { Sow } from "../storage/revenue";
import { activityStats, winLossStats } from "../data/dashboard";
import { weightedValue, opportunityStatus } from "../data/opportunities";
import { formatMoney } from "../data/format";

function monthsBetween(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T00:00:00`).getTime();
  const b = new Date(`${toISO}T00:00:00`).getTime();
  if (!isFinite(a) || !isFinite(b) || b < a) return 0;
  return Math.max(0, Math.round((b - a) / (86_400_000 * 30.44)));
}

export type BookStats = {
  network: number;
  messaged: number;
  responded: number;
  agreed: number;
  met: number;
  meetingsHeld: number;
  metThisMonth: number;
  metLastMonth: number;
  oppsOpen: number;
  pipelineWeighted: number;
  won: number;
  lost: number;
  winRatePct: number | null;
  contracts: number;
  topCompanies: { org: string; count: number }[];
  tenureMonths: number;
};

export function computeBookStats(contacts: Contact[], meetingRows: MeetingRow[], opps: Opportunity[], sows: Sow[], today: string): BookStats {
  const act = activityStats(meetingRows, opps, today);
  const wl = winLossStats(opps);
  const open = opps.filter((o) => opportunityStatus(o) === "Open");
  const pipeline = open.reduce((s, o) => s + weightedValue(o), 0);

  const orgCount = new Map<string, number>();
  for (const c of contacts) {
    const o = c.organisation?.trim();
    if (o) orgCount.set(o, (orgCount.get(o) || 0) + 1);
  }
  const topCompanies = [...orgCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([org, count]) => ({ org, count }));

  // Tenure: earliest real activity date we can see (the first held meeting).
  const dates: string[] = [];
  for (const m of meetingRows) if (m.date_held) dates.push(m.date_held);
  const earliest = dates.sort()[0];

  return {
    network: contacts.length,
    messaged: contacts.filter((c) => c.messaged).length,
    responded: contacts.filter((c) => c.responded).length,
    agreed: contacts.filter((c) => c.agreed_to_meet).length,
    met: contacts.filter((c) => c.met).length,
    meetingsHeld: meetingRows.filter((m) => m.date_held).length,
    metThisMonth: act.peopleMet.thisMonth,
    metLastMonth: act.peopleMet.lastMonth,
    oppsOpen: open.length,
    pipelineWeighted: pipeline,
    won: wl.won,
    lost: wl.lost,
    winRatePct: wl.winRate == null ? null : Math.round(wl.winRate * 100),
    contracts: sows.length,
    topCompanies,
    tenureMonths: earliest ? monthsBetween(earliest, today) : 0,
  };
}

// Render the stats as a short labelled block the model reads as ground truth.
export function buildBookSummary(contacts: Contact[], meetingRows: MeetingRow[], opps: Opportunity[], sows: Sow[], today: string): string {
  const s = computeBookStats(contacts, meetingRows, opps, sows, today);
  const lines = [
    `Network size: ${s.network} contacts`,
    `Outreach funnel: messaged ${s.messaged}, replied ${s.responded}, agreed to meet ${s.agreed}, met ${s.met}`,
    `Meetings held (all time): ${s.meetingsHeld}`,
    `People met this month: ${s.metThisMonth} (last month: ${s.metLastMonth})`,
    `Open opportunities: ${s.oppsOpen}; weighted pipeline ${formatMoney(s.pipelineWeighted)}`,
    `Won/Lost: ${s.won} won, ${s.lost} lost${s.winRatePct == null ? "" : ` (win rate ${s.winRatePct}%)`}`,
    `Signed contracts/SOWs: ${s.contracts}`,
    s.topCompanies.length ? `Top companies by people known: ${s.topCompanies.map((c) => `${c.org} (${c.count})`).join(", ")}` : "",
    s.tenureMonths ? `Activity history spans about ${s.tenureMonths} month${s.tenureMonths === 1 ? "" : "s"}` : "",
    `Today: ${today}`,
  ].filter(Boolean);
  return lines.join("\n");
}
