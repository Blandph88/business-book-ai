// Relationship-warmth sentiment pass. Reads each contact's INBOUND messages (their own words, captured at
// import) and asks the LLM how warm/keen they are — a language judgment we precompute ONCE into a stored
// score, so the deterministic warmth() ranker can use it without running sentiment per query.
//
// Speed/accuracy design (2026-07-02, after a slow first run):
//  • SKIP the noise — don't spend a model call on a contact whose only signal is a one-line "thanks for
//    connecting". Those have no warmth to extract; leaving them unscored = neutral in warmth() (no loss).
//    Only contacts with real signal (a real back-and-forth, agreed-to-meet, or a substantive/keen single
//    reply) go to the model. This is the biggest speed win and costs ~no accuracy.
//  • PRIORITISE the warm cohort first (met/agreed/most messages) so the warmest-leads ranking is correct
//    within the first few batches; the long tail fills in behind it.
//  • GENEROUS payload (first 2 + last 3 messages, 320 chars each) — captures the arc + current tone without
//    starving the judgment. We took the speed from skipping + parallelism, so we don't cut context here.
//  • PARALLELISE only on fast backends (BYOK / local Ollama). On the in-browser model (WebLLM) it's one GPU,
//    so we stay sequential there — the orchestrator sets concurrency from the backend.
//  • Batch ~12 contacts/call + schema-constrained JSON — both kept (they protect accuracy).
// Resumable (skips already-scored), incremental-persist, cancellable.

import type { Contact, WarmthSentiment } from "../data/contacts";
import { aiJson, aiAvailability, isCapableBackend } from "./ai";
import { loadImportedContacts, mergeImportedContacts } from "../storage/importedContacts";
import { warmthSentimentPrompt, type WarmthScore } from "./prompts";

const BATCH = 12;             // contacts per model call
const HEAD = 2, TAIL = 3;     // keep first 2 + last 3 inbound messages (the arc + current tone)
const MAX_CHARS = 320;        // per-message cap
const CONC_CAPABLE = 5;       // parallel batches on fast backends; WebLLM/on-device stays 1 (single GPU)
// On a slow single-GPU browser model, scoring thousands sequentially takes hours. Cap the on-device run to
// the top-priority relationships (agreed/met/most-engaged are scored first) — that covers the leads that
// matter for ranking — and tell the user a faster backend does the whole book. No cap on fast backends.
const ONDEVICE_CAP = 300;

// Keen/affirmation cues that make even a SHORT single reply worth scoring (so we don't skip the warm one-liner).
const AFFIRM = /\b(happy to|would love|love to|sounds (?:great|good)|looking forward|let'?s (?:meet|set|do|catch|grab)|absolutely|for sure|delighted|keen|of course|great to (?:meet|connect|hear)|call me|my number|whatsapp)\b/i;

// Does this contact carry enough signal to be worth a model call? (Otherwise they're neutral by default.)
export function hasWarmthSignal(c: Contact): boolean {
  const msgs = c.inbound ?? [];
  if (!msgs.length) return false;
  if (c.agreed_to_meet || c.met) return true;   // funnel already says warm
  if (msgs.length > 1) return true;             // a real back-and-forth from their side
  const only = (msgs[0]?.text || "").trim();
  return only.length > 80 || AFFIRM.test(only); // a substantive or keen single reply
}

// A contact needs (re)scoring if never scored, OR new inbound has arrived since the last score (their
// thread grew on a later import) — so an active conversation's warmth doesn't drift stale.
export function warmthStale(c: Contact): boolean {
  const s = c.warmthSentiment;
  if (!s) return true;
  const now = c.thread?.inboundCount ?? c.inbound?.length ?? 0;
  return (s.inbound ?? 0) < now;
}

// Warm cohort first: agreed/met outrank a bare reply; more of their own messages = more engaged.
function priority(c: Contact): number {
  // inbound is capped to the arc at import, so use the true count from thread meta for engagement ranking.
  const msgCount = c.thread?.inboundCount ?? c.inbound?.length ?? 0;
  return (c.met ? 400 : c.agreed_to_meet ? 300 : 0) + Math.min(msgCount, 40) * 2;
}

// Redact identifiers before a message ever leaves the machine (cloud scans): emails, phone-ish numbers,
// links, and the contact's OWN name. The scan judges tone/intent, so this barely affects the score. Names
// stay in the local book — only the transmitted snippet is scrubbed.
function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
export function redactPII(text: string, names: string[] = []): string {
  let t = text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]");
  for (const n of names) { const w = (n || "").trim(); if (w.length >= 2) t = t.replace(new RegExp(`\\b${escapeRe(w)}\\b`, "gi"), "[name]"); }
  return t;
}

// The snippets we feed the model: first 2 + last 3 (or all, if ≤5), capped — the arc + the latest tone.
// `redact` scrubs identifiers first (used when the model is a cloud provider — data leaves the machine).
function snippets(c: Contact, redact = false): string[] {
  const m = c.inbound ?? [];
  const picked = m.length <= HEAD + TAIL ? m : [...m.slice(0, HEAD), ...m.slice(-TAIL)];
  return picked.map((x) => { const body = (x.text || "").slice(0, MAX_CHARS); return redact ? redactPII(body, [c.first, c.last]) : body; });
}

const approxTokens = (s: string) => Math.round(s.length / 4);

export type SentimentProgress = { done: number; total: number; tokens: number; current?: string };
export type SentimentOpts = {
  force?: boolean;                              // re-score even contacts that already have a score
  onProgress?: (p: SentimentProgress) => void;
  onBatch?: (scoresSoFar: Map<string, WarmthSentiment>) => void | Promise<void>; // incremental persistence
  signal?: { aborted: boolean };                // cooperative cancel (checked between batches)
  concurrency?: number;                         // parallel batches (1 on WebLLM, ~5 on fast backends)
  maxContacts?: number;                         // cap the number scored this run (on-device); undefined = all
  batchSize?: number;                           // contacts per call (smaller = shorter GPU bursts on-device)
  pauseMs?: number;                             // idle gap between batches so the GPU can breathe (on-device)
  redact?: boolean;                             // scrub identifiers from snippets before sending (cloud only)
  onMeta?: (m: { scoreable: number; capped: boolean }) => void; // fired once up-front (enrich): the full picture
};

// Redaction is on by default when a scan sends to a CLOUD provider (data leaves the machine); the user can
// turn it off in Insights. On-device/local models keep everything local, so redaction there is moot.
export function scanRedactEnabled(): boolean { try { return localStorage.getItem("bb.scanRedact") !== "off"; } catch { return true; } }
export function setScanRedact(on: boolean): void { try { localStorage.setItem("bb.scanRedact", on ? "on" : "off"); } catch { /* ignore */ } }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function scoreWarmthSentiment(contacts: Contact[], opts: SentimentOpts = {}): Promise<Map<string, WarmthSentiment>> {
  const out = new Map<string, WarmthSentiment>();
  let todo = contacts
    .filter((c) => hasWarmthSignal(c) && (opts.force || warmthStale(c)))
    .sort((a, b) => priority(b) - priority(a));
  if (opts.maxContacts && todo.length > opts.maxContacts) todo = todo.slice(0, opts.maxContacts); // top-priority only
  const total = todo.length;
  const size = Math.max(1, opts.batchSize ?? BATCH);
  const batches: Contact[][] = [];
  // A TINY first batch (2) so the first scores + progress land fast — even a slow local model returns 2 in a
  // fraction of a full batch, so the user sees it's working within seconds instead of staring at 0/N. Then
  // full-size batches for throughput.
  let start = 0;
  if (todo.length > 2) { batches.push(todo.slice(0, 2)); start = 2; }
  for (let i = start; i < todo.length; i += size) batches.push(todo.slice(i, i + size));

  let done = 0, tokens = 0, failed = 0;
  let firstError: unknown = null;
  const at = new Date().toISOString().slice(0, 10);
  opts.onProgress?.({ done, total, tokens });

  const runBatch = async (batch: Contact[]) => {
    if (opts.signal?.aborted) return;
    const refToUrl = new Map<string, string>();
    const refToInbound = new Map<string, number>(); // inbound count at scoring time → detect stale scores later
    const items = batch.map((c, j) => {
      const ref = `c${j}`;
      refToUrl.set(ref, c.url);
      refToInbound.set(ref, c.thread?.inboundCount ?? c.inbound?.length ?? 0);
      return { ref, messages: snippets(c, opts.redact) }; // no name; snippets redacted for cloud (data minimisation)
    });
    // Surface WHO is being scored so the banner shows live movement even mid-batch.
    opts.onProgress?.({ done, total, tokens, current: batch[0] ? `${batch[0].first} ${batch[0].last}`.trim() : undefined });
    const args = warmthSentimentPrompt(items);
    try {
      const res = await aiJson<{ scores: WarmthScore[] }>(args);
      tokens += approxTokens((args.system || "") + args.prompt + JSON.stringify(res ?? {}));
      for (const s of res?.scores ?? []) {
        const url = s && typeof s.ref === "string" ? refToUrl.get(s.ref) : undefined;
        if (!url) continue;
        const score = Math.max(0, Math.min(10, Number(s.score)));
        if (!Number.isFinite(score)) continue;
        out.set(url, { score, at, inbound: refToInbound.get(s.ref) ?? 0 }); // label derived from score at display time
      }
    } catch (e) {
      // Batch failed — leave unscored (a later run retries it), but REMEMBER why: if EVERY batch fails
      // we surface the reason instead of reporting a silent, misleading "done (0)".
      failed++;
      if (!firstError) { firstError = e; console.warn("[Business Book] warmth scan batch failed:", e); }
    }
    done += batch.length;
    opts.onProgress?.({ done, total, tokens });
    await opts.onBatch?.(out);
  };

  // Concurrency pool: `conc` runners pull batches off a shared index. conc=1 → sequential (WebLLM).
  const conc = Math.max(1, opts.concurrency ?? 1);
  let idx = 0;
  const runners = Array.from({ length: Math.min(conc, batches.length) }, async () => {
    while (idx < batches.length) {
      if (opts.signal?.aborted) return;
      await runBatch(batches[idx++]);
      // Idle gap so the GPU can service the browser's compositor (keeps the UI painting) between bursts.
      if (opts.pauseMs && idx < batches.length) await sleep(opts.pauseMs);
    }
  });
  await Promise.all(runners);
  // Nothing scored AND batches actually failed (not merely an empty/aborted run) → a real error
  // (broker unavailable, prompt rejected, or unparseable output), so throw with the reason instead of
  // pretending the scan completed. A PARTIAL result (some scored) still returns gracefully.
  if (out.size === 0 && failed > 0 && !opts.signal?.aborted) {
    const why = firstError instanceof Error ? firstError.message : String(firstError ?? "unknown error");
    throw new Error(`AI produced no usable scores across ${failed} batch${failed === 1 ? "" : "es"} — ${why}`);
  }
  return out;
}

// Apply scores back onto a contact list (returns a new array; leaves unscored contacts untouched).
export function applyWarmthScores(contacts: Contact[], scores: Map<string, WarmthSentiment>): Contact[] {
  if (!scores.size) return contacts;
  return contacts.map((c) => (scores.has(c.url) ? { ...c, warmthSentiment: scores.get(c.url) } : c));
}

// How many contacts a pass WOULD score (the signal set) — for a pre-run estimate.
export function countScoreable(contacts: Contact[], force = false): number {
  return contacts.filter((c) => hasWarmthSignal(c) && (force || warmthStale(c))).length;
}

// Orchestrator: score the owner's IMPORTED book and persist incrementally (so an interrupted run keeps what
// it finished). Parallelism is chosen from the backend — fast backends run batches concurrently; the
// in-browser model stays sequential. Requires a set-up AI backend (caller checks first). Safe to re-run.
export async function enrichImportedContactsWarmth(opts: SentimentOpts = {}): Promise<{ scored: number; scoreable: number; backend?: string; capped: boolean }> {
  const contacts = await loadImportedContacts();
  const avail = await aiAvailability();
  // Capable backends (cloud OR a local server like LM Studio/Ollama) run batches CONCURRENTLY — local servers
  // do continuous batching, so 5-wide is ~3× the throughput of sequential (measured). They also do the WHOLE
  // book (uncapped). Only the in-browser model (WebLLM/Nano) is sequential + capped to the top cohort.
  const capable = isCapableBackend(avail.backend);
  const concurrency = capable ? CONC_CAPABLE : 1;
  const maxContacts = capable ? undefined : ONDEVICE_CAP;
  const batchSize = 6; // small batches → progress lands quickly instead of sitting at 0/N while a big batch generates
  const pauseMs = capable ? undefined : 1200; // GPU-breathing gap only for the in-browser model (a local server is its own process)
  const scoreable = countScoreable(contacts, opts.force);
  const capped = !!maxContacts && scoreable > maxContacts;
  const redact = capable && !avail.local && scanRedactEnabled(); // scrub identifiers only when sending to a CLOUD provider
  opts.onMeta?.({ scoreable, capped }); // let the banner explain "top N of M" from the start of the run
  // Merge scores onto the CURRENT stored book (not the snapshot loaded at scan start), so a re-import that
  // lands mid-scan isn't clobbered by a stale write — scores only ever attach to contacts that still exist.
  const persist = async (soFar: Map<string, WarmthSentiment>) => { await mergeImportedContacts((cur) => applyWarmthScores(cur, soFar)); };
  // Persisting re-serialises the WHOLE book (thousands of contacts + their message text) — a heavy main-thread
  // write. Do it every few batches, not every one, so it doesn't add its own jank. The final save always runs.
  let sinceSave = 0;
  const scores = await scoreWarmthSentiment(contacts, {
    ...opts,
    concurrency,
    maxContacts,
    batchSize,
    pauseMs,
    redact,
    onBatch: async (s) => { if (++sinceSave >= 4) { sinceSave = 0; await persist(s); } await opts.onBatch?.(s); },
  });
  await persist(scores);
  return { scored: scores.size, scoreable, backend: avail.backend, capped };
}
