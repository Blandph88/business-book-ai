// Live LinkedIn import (owned mode). Parses the buyer's real export ENTIRELY in the browser:
//   • Connections.csv → the network (classified with the same deterministic classifier the demo uses)
//   • messages.csv    → derives the outreach funnel (messaged → responded → agreed-to-meet)
// Nothing is uploaded anywhere — there is no server. Produces Contact rows for the owned store.

import Papa from "papaparse";
import { classifyContact } from "./classify";
import type { Contact } from "./contacts";

// Stable key across both files (LinkedIn URLs vary by trailing slash / query / case).
export function normalizeUrl(url: string | undefined): string {
  if (!url) return "";
  return url.trim().toLowerCase().split("?")[0].split("#")[0].replace(/\/+$/, "");
}

// ── Connections.csv ─────────────────────────────────────────────────────────────────────
// LinkedIn prepends a "Notes:" line, a quoted note, and a blank line before the real header.
// Start parsing at the header row (the line beginning with "First Name").
function stripPreamble(text: string): string {
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /^"?First Name"?\s*,/i.test(l));
  return headerIdx > 0 ? lines.slice(headerIdx).join("\n") : text;
}

type RawConn = { first: string; last: string; company: string; title: string; url: string };

export function parseConnections(text: string): RawConn[] {
  const parsed = Papa.parse<Record<string, string>>(stripPreamble(text), {
    header: true,
    skipEmptyLines: true,
  });
  const out: RawConn[] = [];
  for (const row of parsed.data) {
    const url = (row["URL"] ?? row["Url"] ?? "").trim();
    if (!url) continue;
    out.push({
      first: (row["First Name"] ?? "").trim(),
      last: (row["Last Name"] ?? "").trim(),
      company: (row["Company"] ?? "").trim(),
      title: (row["Position"] ?? "").trim(),
      url,
    });
  }
  return out;
}

// ── messages.csv → funnel ───────────────────────────────────────────────────────────────
// Same proposal/affirmation keyword logic the demo generator uses (ported from pipeline.py).
const PROPOSE = ["coffee", "grab a coffee", "catch up", "meet up", "lunch", "get together", "jump on a call", "hop on a call", "let's meet", "lets meet", "set up a call", "set up a chat"];
const AFFIRM = ["sounds great", "sounds good", "would love to", "happy to", "let's do it", "lets do it", "for sure", "that works", "looking forward", "great idea", "absolutely", "let's set", "lets set", "yes please", "love to"];

function hasKeyword(text: string, words: string[]): boolean {
  const t = (text || "").toLowerCase();
  return words.some((w) => t.includes(w));
}

export type FunnelSets = { messaged: Set<string>; responded: Set<string>; agreed: Set<string> };

export function parseMessages(text: string): FunnelSets {
  const sets: FunnelSets = { messaged: new Set(), responded: new Set(), agreed: new Set() };
  if (!text || !text.trim()) return sets;
  const rows = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true }).data;

  // Detect the account OWNER: their profile URL appears in (nearly) every message, as
  // sender or recipient. The most frequent profile URL across all rows is the owner.
  const tally = new Map<string, number>();
  const bump = (u: string) => { const n = normalizeUrl(u); if (n) tally.set(n, (tally.get(n) ?? 0) + 1); };
  for (const r of rows) {
    bump(r["SENDER PROFILE URL"] ?? "");
    for (const u of (r["RECIPIENT PROFILE URLS"] ?? "").split(/[\s,;]+/)) bump(u);
  }
  let owner = "", max = -1;
  for (const [u, n] of tally) if (n > max) { max = n; owner = u; }
  if (!owner) return sets;

  const proposedTo = new Set<string>();   // contacts the owner proposed a meeting to
  const affirmedBy = new Set<string>();   // contacts who affirmed in a reply
  for (const r of rows) {
    const sender = normalizeUrl(r["SENDER PROFILE URL"] ?? "");
    const recipients = (r["RECIPIENT PROFILE URLS"] ?? "").split(/[\s,;]+/).map(normalizeUrl).filter(Boolean);
    const content = r["CONTENT"] ?? "";
    if (sender === owner) {
      for (const c of recipients) {
        if (!c || c === owner) continue;
        sets.messaged.add(c);
        if (hasKeyword(content, PROPOSE)) proposedTo.add(c);
      }
    } else if (sender) {
      sets.responded.add(sender);
      if (hasKeyword(content, AFFIRM)) affirmedBy.add(sender);
    }
  }
  for (const c of sets.responded) {
    if (proposedTo.has(c) && affirmedBy.has(c)) sets.agreed.add(c);
  }
  return sets;
}

// ── full import ─────────────────────────────────────────────────────────────────────────
export type ImportResult = {
  contacts: Contact[];
  counts: { total: number; messaged: number; responded: number; agreed: number };
};

export function importLinkedIn(connectionsText: string, messagesText: string): ImportResult {
  const raw = parseConnections(connectionsText);
  const funnel = parseMessages(messagesText);
  const byUrl = new Map<string, Contact>();
  for (const r of raw) {
    const key = normalizeUrl(r.url);
    if (!key || byUrl.has(key)) continue; // dedupe by profile URL
    try {
      const e = classifyContact({ first: r.first, last: r.last, company: r.company, title: r.title, url: r.url });
      byUrl.set(key, {
        ...e,
        messaged: funnel.messaged.has(key),
        responded: funnel.responded.has(key),
        two_way: funnel.responded.has(key),
        agreed_to_meet: funnel.agreed.has(key),
        met: false, // a real "met" is only ever a meeting the buyer logs themselves
        phone: "",
      });
    } catch {
      /* skip a single unparseable row rather than failing the whole import */
    }
  }
  const contacts = [...byUrl.values()];
  return {
    contacts,
    counts: {
      total: contacts.length,
      messaged: contacts.filter((c) => c.messaged).length,
      responded: contacts.filter((c) => c.responded).length,
      agreed: contacts.filter((c) => c.agreed_to_meet).length,
    },
  };
}
