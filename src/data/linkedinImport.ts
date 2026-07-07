// Live LinkedIn import (owned mode). Parses the buyer's real export ENTIRELY in the browser:
//   • Connections.csv → the network (classified with the same deterministic classifier the demo uses)
//   • messages.csv    → derives the outreach funnel (messaged → responded → agreed-to-meet)
// Nothing is uploaded anywhere — there is no server. Produces Contact rows for the owned store.

import Papa from "papaparse";
import { classifyContact } from "./classify";
import type { Contact, InboundMessage, ThreadMeta } from "./contacts";

// The stable contact key — now the single canonical helper (imported for internal use + re-exported here
// for existing import sites/tests).
import { normalizeUrl } from "./url";
export { normalizeUrl };

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

export type FunnelSets = {
  messaged: Set<string>;
  responded: Set<string>;
  agreed: Set<string>;
  // Each contact's INBOUND messages (their words, not the owner's) in send order — the sentiment signal.
  inbound: Map<string, InboundMessage[]>;
  // Per-contact thread meta, computed deterministically from BOTH sides (no LLM): who sent last + when, and
  // message counts each way. Powers "who owes a reply" + responsiveness with zero model cost.
  thread: Map<string, ThreadMeta>;
};

// "2026-03-26 09:15:00 UTC" → "2026-03-26" (or "" if not a leading ISO date).
function isoDate(raw: string): string {
  const m = (raw || "").match(/^\s*(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

export function parseMessages(text: string): FunnelSets {
  const sets: FunnelSets = { messaged: new Set(), responded: new Set(), agreed: new Set(), inbound: new Map(), thread: new Map() };
  if (!text || !text.trim()) return sets;
  // Track the latest message per contact + counts each way (deterministic thread signal).
  const noteThread = (url: string, date: string, fromOwner: boolean) => {
    const t = sets.thread.get(url) ?? { lastDate: "", lastFromOwner: false, inboundCount: 0, outboundCount: 0 };
    if (fromOwner) t.outboundCount++; else t.inboundCount++;
    if (date >= t.lastDate) { t.lastDate = date; t.lastFromOwner = fromOwner; } // ties: last seen wins
    sets.thread.set(url, t);
  };
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
    const date = isoDate(r["DATE"] ?? "");
    if (sender === owner) {
      for (const c of recipients) {
        if (!c || c === owner) continue;
        sets.messaged.add(c);
        if (hasKeyword(content, PROPOSE)) proposedTo.add(c);
        noteThread(c, date, true); // owner → contact (outbound)
      }
    } else if (sender) {
      sets.responded.add(sender);
      if (hasKeyword(content, AFFIRM)) affirmedBy.add(sender);
      noteThread(sender, date, false); // contact → owner (inbound)
      // Capture their inbound message (their own words) for the sentiment pass.
      const body = content.trim();
      if (body) {
        const list = sets.inbound.get(sender) ?? [];
        list.push({ date, text: body });
        sets.inbound.set(sender, list);
      }
    }
  }
  // Keep each contact's inbound thread in chronological order (recency matters to the read).
  for (const [, list] of sets.inbound) list.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  for (const c of sets.responded) {
    if (proposedTo.has(c) && affirmedBy.has(c)) sets.agreed.add(c);
  }
  return sets;
}

// Cap what we STORE per contact. The scans (sentiment.ts / oppScan.ts) only ever read the first 2 +
// last 3 inbound messages, and contactSignalsText reads the latest — so storing every message just
// bloats the data plane. Under the seal a purchased app's whole dataset is inlined into the frame's
// srcdoc seed on every boot (preamble.ts), so a heavy messager's full history makes each launch slow
// and memory-heavy for no gain. Keep only the arc the app uses; the true message count is preserved
// in thread.inboundCount (used for warm-cohort ranking), so nothing downstream is lost.
const KEEP_HEAD = 2, KEEP_TAIL = 3, MSG_MAX = 600;
export function capInbound(msgs: InboundMessage[] | undefined): InboundMessage[] | undefined {
  if (!msgs || !msgs.length) return msgs;
  const arc = msgs.length <= KEEP_HEAD + KEEP_TAIL ? msgs : [...msgs.slice(0, KEEP_HEAD), ...msgs.slice(-KEEP_TAIL)];
  return arc.map((m) => (m.text.length > MSG_MAX ? { ...m, text: m.text.slice(0, MSG_MAX) } : m));
}

// ── full import ─────────────────────────────────────────────────────────────────────────
export type ImportResult = {
  contacts: Contact[];
  counts: { total: number; messaged: number; responded: number; agreed: number };
};

// Re-import preserves expensive analysis. LinkedIn's CSVs carry no LLM scan output, so a naive
// re-import (importLinkedIn → saveImportedContacts REPLACES the book) wipes the relationship-warmth
// and opportunity scores — potentially hours of scanning. Carry `warmthSentiment` + `latentOpp` over
// for URL-matched contacts (the fresh import supplies up-to-date `thread`/`inbound` from the new
// messages). Bonus: the warmth/opp passes skip already-scored contacts, so a re-import re-scans only
// the genuinely new/unscored ones instead of the whole book.
export function carryOverEnrichment(fresh: Contact[], prev: Contact[]): Contact[] {
  if (!prev.length) return fresh;
  const prevByUrl = new Map<string, Contact>();
  for (const c of prev) {
    const k = normalizeUrl(c.url);
    if (k) prevByUrl.set(k, c);
  }
  return fresh.map((c) => {
    const old = prevByUrl.get(normalizeUrl(c.url));
    if (!old) return c;
    const out = { ...c };
    if (out.warmthSentiment === undefined && old.warmthSentiment !== undefined) out.warmthSentiment = old.warmthSentiment;
    if (out.latentOpp === undefined && old.latentOpp !== undefined) out.latentOpp = old.latentOpp;
    return out;
  });
}

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
        inbound: capInbound(funnel.inbound.get(key)), // their own words (arc only) — scored later by the sentiment pass
        thread: funnel.thread.get(key),   // deterministic who-owes-a-reply + responsiveness signal
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
