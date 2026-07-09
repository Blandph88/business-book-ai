// Live LinkedIn import (owned mode). Parses the buyer's real export ENTIRELY in the browser:
//   • Connections.csv → the network (classified with the same deterministic classifier the demo uses)
//   • messages.csv    → derives the outreach funnel (messaged → responded → agreed-to-meet)
// Nothing is uploaded anywhere — there is no server. Produces Contact rows for the owned store.

import Papa from "papaparse";
import { classifyContact } from "./classify";
import type { Contact, InboundMessage, ThreadMeta } from "./contacts";

// The stable contact key — now the single canonical helper (imported for internal use + re-exported here
// for existing import sites/tests).
import { normalizeUrl, syntheticContactKey } from "./url";
export { normalizeUrl };

// ── Connections.csv ─────────────────────────────────────────────────────────────────────
// LinkedIn prepends a "Notes:" line, a quoted note, and a blank line before the real header.
// Start parsing at the header row (the line beginning with "First Name").
function stripPreamble(text: string): string {
  const clean = text.replace(/^\uFEFF/, ""); // a UTF-8 BOM would break header detection AND the first column
  const lines = clean.split(/\r?\n/);
  // The header row starts the real data. Detect it by a "First Name" column OR a "URL" column (case/quote
  // tolerant), so a BOM or a localized "First Name" header doesn't cause the whole import to silently fail.
  const isHeader = (l: string) => /(^|,)\s*"?first name"?\s*,/i.test(l) || /(^|,)\s*"?url"?\s*(,|$)/i.test(l);
  const headerIdx = lines.findIndex(isHeader);
  return headerIdx > 0 ? lines.slice(headerIdx).join("\n") : clean;
}

type RawConn = { first: string; last: string; company: string; title: string; url: string };

// ── Import hygiene ──────────────────────────────────────────────────────────────────────
// Real LinkedIn exports carry decoration people add to their names — an emoji ("☁️Jon White"), pronouns
// ("(he/him)"), and a string of post-nominal credentials ("Faisal Albaroudi, MBA, CIA, ICCGO", "Saad
// Alhummaidani ,RMFS"). Left in, they pollute name display, contact matching, and the copilot's chips. We
// strip the decoration but KEEP accents / non-Latin scripts (a José or 王 is a real name, not noise).
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F000}-\u{1FAFF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}️‍]/gu;
export function cleanName(raw: string): string {
  return (raw || "")
    .replace(EMOJI_RE, "")
    .replace(/\([^)]*\b(?:he|him|she|her|they|them)\b[^)]*\)/gi, "") // pronoun parenthetical
    .split(/[,|]/)[0] // drop trailing ", MBA, CIA, ICCGO" credentials or "| headline"
    .replace(/\s{2,}/g, " ")
    .trim();
}
// The company field is frequently NOT a company — it's a job-search status or a placeholder. Grouping every
// "Open to work" / "Self-employed"-style value into one giant fake account skews the sector breakdown and
// surfaces junk "companies" in the copilot. Blank the clear non-companies; keep genuine firm names (incl.
// small/unknown ones) untouched. "Self-employed"/"Freelance" ARE kept — they're a real working status.
const JUNK_COMPANY = /^(?:-+|—+|\.+|,+|n\/?a|none|null|#?\s*open\s*to\s*work|open\s+for\s+work|seeking\b.*|looking\s+for\s+(?:work|opportunit\w*|(?:a\s+)?\w+\s+role).*|actively\s+(?:seeking|looking).*|between\s+roles?|currently\s+.*|commencing\s+.*|starting\s+.*\bin\b.*|available\s+for\s+.*)$/i;
export function cleanCompany(raw: string): string {
  const s = (raw || "").replace(EMOJI_RE, "").replace(/\s{2,}/g, " ").trim();
  if (!s || JUNK_COMPANY.test(s)) return "";
  // A whole self-description sentence pasted into the company field ("…helping brands grow at scale") isn't a
  // company — drop obviously-headline values (long AND containing a linking preposition).
  if (s.length > 60 && /\s(?:at|for|with|to|helping|passionate)\s/i.test(s)) return "";
  return s;
}

export function parseConnections(text: string, warn?: (msg: string) => void): RawConn[] {
  const parsed = Papa.parse<Record<string, string>>(stripPreamble(text), {
    header: true,
    skipEmptyLines: true,
  });
  // Surface (don't swallow) structural parse problems — a mismatched-quote or ragged row otherwise silently
  // drops people from the book with no hint why.
  if (warn && parsed.errors.length) warn(`${parsed.errors.length} row(s) in Connections.csv couldn't be read and were skipped — if a lot are missing, re-download the export from LinkedIn.`);
  const out: RawConn[] = [];
  for (const row of parsed.data) {
    const first = cleanName(row["First Name"] ?? "");
    const last = cleanName(row["Last Name"] ?? "");
    // Keep connections whose profile URL LinkedIn omitted (restricted profiles): key them by a stable
    // name-based synthetic id (so a re-import collapses them onto the same record) instead of dropping them.
    // Key on the CLEANED name so decoration variants of the same person don't split into two records.
    const url = (row["URL"] ?? row["Url"] ?? "").trim() || syntheticContactKey(first, last);
    if (!url) continue; // no URL AND no name → nothing to key on
    out.push({
      first,
      last,
      company: cleanCompany(row["Company"] ?? ""),
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
// Full lexicographically-sortable timestamp: "2026-03-26 09:15:00 UTC" → "2026-03-26 09:15:00".
// Used ONLY to order messages within a thread so a same-day back-and-forth resolves by the actual
// time (who truly messaged last), not by the export's row order. Falls back to the date if no time.
function fullTs(raw: string): string {
  const m = (raw || "").match(/^\s*(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?)/);
  return m ? m[1] : "";
}

export function parseMessages(text: string, warn?: (msg: string) => void): FunnelSets {
  const sets: FunnelSets = { messaged: new Set(), responded: new Set(), agreed: new Set(), inbound: new Map(), thread: new Map() };
  if (!text || !text.trim()) return sets;
  // Track the latest message per contact + counts each way (deterministic thread signal). Ordering uses the
  // full timestamp (`ts`) so same-day exchanges resolve by clock time; `date` is the date-only display value.
  const lastTsByUrl = new Map<string, string>();
  const noteThread = (url: string, date: string, ts: string, fromOwner: boolean) => {
    const t = sets.thread.get(url) ?? { lastDate: "", lastFromOwner: false, inboundCount: 0, outboundCount: 0 };
    if (fromOwner) t.outboundCount++; else t.inboundCount++;
    const prevTs = lastTsByUrl.get(url) ?? "";
    if (ts >= prevTs) { lastTsByUrl.set(url, ts); t.lastDate = date; t.lastFromOwner = fromOwner; } // ties: last seen wins
    sets.thread.set(url, t);
  };
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  if (warn && parsed.errors.length) warn(`${parsed.errors.length} row(s) in messages.csv couldn't be read and were skipped — the outreach funnel may be incomplete.`);
  const rows = parsed.data;

  // Detect the account OWNER: their profile URL appears in (nearly) every conversation, as sender or
  // recipient. We rank by the number of DISTINCT conversations a URL appears in — not raw message count —
  // so a chatty single thread or a lopsided tiny export doesn't crown the wrong person. Rows with no
  // conversation id fall back to a per-row bucket so each still counts once.
  const convosPerUrl = new Map<string, Set<string>>();
  rows.forEach((r, i) => {
    const cid = (r["CONVERSATION ID"] ?? "").trim() || `__row${i}`;
    const add = (u: string) => { const n = normalizeUrl(u); if (!n) return; const s = convosPerUrl.get(n) ?? new Set<string>(); s.add(cid); convosPerUrl.set(n, s); };
    add(r["SENDER PROFILE URL"] ?? "");
    for (const u of (r["RECIPIENT PROFILE URLS"] ?? "").split(/[\s,;]+/)) add(u);
  });
  let owner = "", max = -1;
  for (const [u, s] of convosPerUrl) if (s.size > max) { max = s.size; owner = u; }
  if (!owner) return sets;

  // GROUP-CHAT GUARD: one message to a group thread must NOT mark every member as personally messaged /
  // agreed-to-meet — that poisons the 1:1 outreach funnel (the product's core value). Count distinct
  // participants per CONVERSATION ID; a thread with >2 people is a group and is skipped for the funnel +
  // inbound below. Falls back to the per-message recipient count when the export carries no conversation id.
  const convoParticipants = new Map<string, Set<string>>();
  for (const r of rows) {
    const cid = (r["CONVERSATION ID"] ?? "").trim();
    if (!cid) continue;
    const set = convoParticipants.get(cid) ?? new Set<string>();
    const s = normalizeUrl(r["SENDER PROFILE URL"] ?? ""); if (s) set.add(s);
    for (const u of (r["RECIPIENT PROFILE URLS"] ?? "").split(/[\s,;]+/).map(normalizeUrl)) if (u) set.add(u);
    convoParticipants.set(cid, set);
  }
  const isGroupConvo = (cid: string) => (convoParticipants.get(cid)?.size ?? 0) > 2;

  const proposedTo = new Set<string>();   // contacts the owner proposed a meeting to
  const affirmedBy = new Set<string>();   // contacts who affirmed in a reply
  for (const r of rows) {
    const sender = normalizeUrl(r["SENDER PROFILE URL"] ?? "");
    const recipients = (r["RECIPIENT PROFILE URLS"] ?? "").split(/[\s,;]+/).map(normalizeUrl).filter(Boolean);
    const content = r["CONTENT"] ?? "";
    const date = isoDate(r["DATE"] ?? "");
    const ts = fullTs(r["DATE"] ?? "");
    // Exclude group-thread messages from all funnel/inbound attribution.
    const cid = (r["CONVERSATION ID"] ?? "").trim();
    const nonOwnerRecipients = recipients.filter((c) => c && c !== owner);
    const group = cid ? isGroupConvo(cid) : (nonOwnerRecipients.length > 1 || (sender !== owner && nonOwnerRecipients.length >= 1));
    if (group) continue;
    if (sender === owner) {
      for (const c of recipients) {
        if (!c || c === owner) continue;
        sets.messaged.add(c);
        if (hasKeyword(content, PROPOSE)) proposedTo.add(c);
        noteThread(c, date, ts, true); // owner → contact (outbound)
      }
    } else if (sender) {
      sets.responded.add(sender);
      if (hasKeyword(content, AFFIRM)) affirmedBy.add(sender);
      noteThread(sender, date, ts, false); // contact → owner (inbound)
      // Capture their inbound message (their own words) for the sentiment pass.
      const body = content.trim();
      if (body) {
        const list = sets.inbound.get(sender) ?? [];
        list.push({ date, text: body });
        sets.inbound.set(sender, list);
      }
    }
  }
  // COLD-INBOUND GUARD: "responded" means they replied to the OWNER'S outreach. A cold inbound (a recruiter
  // InMail, a stranger's pitch) where the owner never messaged them first must not be counted as a response —
  // it would inflate the funnel's response/two-way rate. Require an outbound before crediting the reply.
  // (Their message is still captured in `inbound` for the sentiment read; it just isn't a funnel "response".)
  for (const c of [...sets.responded]) if (!sets.messaged.has(c)) sets.responded.delete(c);
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
  // Non-fatal problems worth showing the owner (unreadable rows, unrecognised headers, an unmatched
  // messages.csv). The import still succeeds; these explain why a number looks lower than expected.
  warnings: string[];
};

// Re-import preserves prior WORK the fresh export can't reproduce. LinkedIn's CSVs carry no LLM scan output,
// and messages.csv is OPTIONAL — so a naive re-import (importLinkedIn → save REPLACES the book) wipes two
// irreplaceable things:
//   1. The relationship-warmth + opportunity scores — potentially hours of scanning.
//   2. When messages.csv wasn't re-uploaded, the ENTIRE funnel: messaged/responded/agreed, who-owes-a-reply
//      (thread), and every captured inbound message — because those are derived purely from the new messages,
//      which are empty this import.
// For each URL-matched contact we therefore carry: warmthSentiment/latentOpp when the fresh import didn't
// recompute them; and the funnel flags (UNION — never regress a true→false) + thread/inbound/phone when the
// fresh import supplied none. A re-upload WITH a fuller messages.csv stays authoritative (it provides fresh
// flags/threads, so the fallbacks don't fire). Bonus: the warmth/opp passes skip already-scored contacts, so a
// re-import re-scans only the genuinely new/unscored ones.
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
    // Expensive AI analysis: carry when this import didn't recompute it.
    if (out.warmthSentiment === undefined && old.warmthSentiment !== undefined) out.warmthSentiment = old.warmthSentiment;
    if (out.latentOpp === undefined && old.latentOpp !== undefined) out.latentOpp = old.latentOpp;
    // Funnel progress: OR the flags so a Connections-only re-import (empty funnel) can never downgrade a
    // contact you'd already messaged/heard-back-from/agreed-to-meet.
    out.messaged = out.messaged || old.messaged;
    out.responded = out.responded || old.responded;
    out.two_way = out.two_way || old.two_way;
    out.agreed_to_meet = out.agreed_to_meet || old.agreed_to_meet;
    out.met = out.met || old.met;
    // Message-derived detail: keep the prior thread/inbound/phone when THIS import supplied none for them.
    if ((!out.inbound || !out.inbound.length) && old.inbound?.length) out.inbound = old.inbound;
    if (!out.thread && old.thread) out.thread = old.thread;
    if (!out.phone && old.phone) out.phone = old.phone;
    return out;
  });
}

export function importLinkedIn(connectionsText: string, messagesText: string): ImportResult {
  const warnings: string[] = [];
  const warn = (m: string) => { if (!warnings.includes(m)) warnings.push(m); };
  const raw = parseConnections(connectionsText, warn);
  const funnel = parseMessages(messagesText, warn);
  // Headers not recognised (localized export, wrong file, or all-blank columns): rows parsed but none had a
  // name OR a URL to key on, so nothing could be imported.
  if (connectionsText.trim() && raw.length === 0)
    warn("We couldn't read any connections from that file — check it's your LinkedIn Connections.csv (with First Name / Last Name / URL columns).");
  // Messages provided but not one matched a connection (owner mis-detected, or the two exports came from
  // different accounts) — the whole funnel would read empty and look like you'd done no outreach.
  if (messagesText.trim() && funnel.messaged.size === 0 && funnel.responded.size === 0)
    warn("Your messages file didn't match any of your connections, so the outreach funnel is empty — check both files were exported from the same LinkedIn account.");
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
    warnings,
  };
}
