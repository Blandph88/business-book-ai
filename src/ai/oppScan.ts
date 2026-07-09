// Opportunity scan — the opt-in pass that reads each contact's inbound messages and spots a LATENT
// opportunity (a need/project not yet in the pipeline). Same speed discipline as the warmth pass: skip the
// noise, batch, parallelise only on fast backends, cap the on-device run, breathe between batches, resumable
// (a contact with a `latentOpp` — even an empty "none" — is skipped). Stores one signal per contact.

import type { Contact, LatentOpp } from "../data/contacts";
import { aiJson, aiAvailability, isCapableBackend } from "./ai";
import { loadImportedContacts, mergeImportedContacts } from "../storage/importedContacts";
import { opportunityScanPrompt, type OppScore } from "./prompts";
import { hasWarmthSignal, redactPII, scanRedactEnabled } from "./sentiment";

const BATCH = 12;
const HEAD = 2, TAIL = 4;      // opportunities can surface late in a thread — keep a few more recent messages
const MAX_CHARS = 360;
const CONC_CAPABLE = 5;
const ONDEVICE_CAP = 300;

const snippets = (c: Contact, redact = false): string[] => {
  const m = c.inbound ?? [];
  const picked = m.length <= HEAD + TAIL ? m : [...m.slice(0, HEAD), ...m.slice(-TAIL)];
  return picked.map((x) => { const body = (x.text || "").slice(0, MAX_CHARS); return redact ? redactPII(body, [c.first, c.last]) : body; });
};
const approxTokens = (s: string) => Math.round(s.length / 4);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function countOppScoreable(contacts: Contact[], force = false): number {
  return contacts.filter((c) => hasWarmthSignal(c) && (force || !c.latentOpp)).length;
}

export type OppScanProgress = { done: number; total: number; tokens: number; current?: string };
export type OppScanOpts = {
  force?: boolean;
  onProgress?: (p: OppScanProgress) => void;
  onBatch?: (found: Map<string, LatentOpp>) => void | Promise<void>;
  onMeta?: (m: { scoreable: number; capped: boolean }) => void;
  signal?: { aborted: boolean };
  concurrency?: number;
  maxContacts?: number;
  batchSize?: number;
  pauseMs?: number;
  redact?: boolean;
};

export async function scanOpportunities(contacts: Contact[], opts: OppScanOpts = {}): Promise<Map<string, LatentOpp>> {
  const out = new Map<string, LatentOpp>();
  let todo = contacts
    .filter((c) => hasWarmthSignal(c) && (opts.force || !c.latentOpp))
    // inbound is capped to the arc at import; rank by the true count from thread meta (most conversation first).
    .sort((a, b) => (b.thread?.inboundCount ?? b.inbound?.length ?? 0) - (a.thread?.inboundCount ?? a.inbound?.length ?? 0));
  if (opts.maxContacts && todo.length > opts.maxContacts) todo = todo.slice(0, opts.maxContacts);
  const total = todo.length;
  const size = Math.max(1, opts.batchSize ?? BATCH);
  const batches: Contact[][] = [];
  // Tiny first batch so progress lands fast on a slow local model; then full-size batches.
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
    const items = batch.map((c, j) => {
      const ref = `c${j}`;
      refToUrl.set(ref, c.url);
      return { ref, messages: snippets(c, opts.redact) }; // no name; redacted for cloud (data minimisation)
    });
    opts.onProgress?.({ done, total, tokens, current: batch[0] ? `${batch[0].first} ${batch[0].last}`.trim() : undefined });
    const args = opportunityScanPrompt(items);
    try {
      const res = await aiJson<{ opps: OppScore[] }>(args);
      tokens += approxTokens((args.system || "") + args.prompt + JSON.stringify(res ?? {}));
      // Mark each ref the model ACTUALLY returned (the prompt asks for one entry per ref; empty string =
      // scanned, no opportunity). A ref the model OMITTED is deliberately left unscanned so a later pass
      // retries it — otherwise a single omission would be permanently recorded as "nothing found" and never
      // re-scanned (the resume filter skips any contact that already has a latentOpp).
      for (const o of res?.opps ?? []) {
        const url = o && typeof o.ref === "string" ? refToUrl.get(o.ref) : undefined;
        if (!url) continue;
        out.set(url, { at, text: typeof o.opp === "string" ? o.opp.trim() : "" });
      }
    } catch (e) {
      // Batch failed — leave unscanned (a re-run retries it), but remember why: if EVERY batch fails we
      // surface the reason rather than reporting a silent "found (0)" that looks like "no opportunities".
      failed++;
      if (!firstError) { firstError = e; console.warn("[Business Book] opportunity scan batch failed:", e); }
    }
    done += batch.length;
    opts.onProgress?.({ done, total, tokens });
    await opts.onBatch?.(out);
  };

  const conc = Math.max(1, opts.concurrency ?? 1);
  let idx = 0;
  const runners = Array.from({ length: Math.min(conc, batches.length) }, async () => {
    while (idx < batches.length) {
      if (opts.signal?.aborted) return;
      await runBatch(batches[idx++]);
      if (opts.pauseMs && idx < batches.length) await sleep(opts.pauseMs);
    }
  });
  await Promise.all(runners);
  // Nothing recorded AND batches actually failed → a real error, not "scanned everyone, found none"
  // (a clean run pre-records every contact with empty text, so out is non-empty on success).
  if (out.size === 0 && failed > 0 && !opts.signal?.aborted) {
    const why = firstError instanceof Error ? firstError.message : String(firstError ?? "unknown error");
    throw new Error(`AI produced no usable results across ${failed} batch${failed === 1 ? "" : "es"} — ${why}`);
  }
  return out;
}

export function applyOpps(contacts: Contact[], found: Map<string, LatentOpp>): Contact[] {
  if (!found.size) return contacts;
  return contacts.map((c) => (found.has(c.url) ? { ...c, latentOpp: found.get(c.url) } : c));
}

// Orchestrator: scan the imported book + persist incrementally. Returns how many real opportunities were
// FOUND (non-empty), how many were scoreable, and whether the on-device run was capped.
export async function scanImportedContactsForOpportunities(opts: OppScanOpts = {}): Promise<{ found: number; scoreable: number; capped: boolean; backend?: string }> {
  const contacts = await loadImportedContacts();
  const avail = await aiAvailability();
  // Capable backends (cloud OR local server) run 5-wide (local servers continuous-batch → ~3× throughput);
  // whole book (uncapped). Only the in-browser model is sequential + capped.
  const capable = isCapableBackend(avail.backend);
  const concurrency = capable ? CONC_CAPABLE : 1;
  const maxContacts = capable ? undefined : ONDEVICE_CAP;
  const batchSize = 6; // small batches → progress lands quickly instead of sitting at 0/N while a big batch generates
  const pauseMs = capable ? undefined : 1200; // GPU-breathing gap only for the in-browser model
  const scoreable = countOppScoreable(contacts, opts.force);
  const capped = !!maxContacts && scoreable > maxContacts;
  const redact = capable && !avail.local && scanRedactEnabled(); // scrub identifiers only for a CLOUD provider
  opts.onMeta?.({ scoreable, capped });
  // Merge onto the CURRENT stored book (not the scan-start snapshot) so a re-import mid-scan isn't clobbered.
  const persist = async (soFar: Map<string, LatentOpp>) => { await mergeImportedContacts((cur) => applyOpps(cur, soFar)); };
  let sinceSave = 0;
  const found = await scanOpportunities(contacts, {
    ...opts, concurrency, maxContacts, batchSize, pauseMs, redact,
    onBatch: async (s) => { if (++sinceSave >= 4) { sinceSave = 0; await persist(s); } await opts.onBatch?.(s); },
  });
  await persist(found);
  const realCount = [...found.values()].filter((v) => v.text).length;
  return { found: realCount, scoreable, capped, backend: avail.backend };
}
