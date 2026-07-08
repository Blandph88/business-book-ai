// Global, app-level runner for the background AI enrichment scans (relationship warmth, opportunity scan).
// Lives OUTSIDE the React tree (a tiny external store) so a scan keeps running when the modal / Insights /
// any tab closes — the top BANNER shows progress. SINGLE-SLOT: only one scan at a time (they'd fight over
// the on-device GPU).
//
// PERSISTS ACROSS REFRESH: a page reload kills the JS (so the async loop stops), but we save an "active
// scan" marker; on the next load `resumeIfInterrupted()` picks it back up — a running scan auto-resumes
// (it's resumable — skips what's already scored), a paused one comes back paused with a Resume button. So
// the banner "stays" and the work continues. It's Pausable / Cancellable, never silently dismissed mid-run.

import { enrichImportedContactsWarmth, type SentimentProgress } from "./sentiment";
import { scanImportedContactsForOpportunities, type OppScanProgress } from "./oppScan";
import { enrichOtherCompanies } from "./enrich";
import { aiAvailability } from "./ai";

export type AnalysisJob = "warmth" | "opportunities" | "classify";

export type WarmthTaskState = {
  status: "idle" | "running" | "paused" | "done" | "error";
  job?: AnalysisJob;
  label: string;
  done: number;
  total: number;
  tokens: number;
  current?: string;
  startedAt: number;
  scored: number;
  scoreable: number;
  capped: boolean;
  backend?: string;
  error?: string; // set when status === "error" — the reason the scan couldn't run (surfaced in the banner)
};

const JOB_LABEL: Record<AnalysisJob, string> = { warmth: "Relationship warmth", opportunities: "Opportunity scan", classify: "Company sectors" };
const MARKER_KEY = "bb.activeScan.v1";

let state: WarmthTaskState = { status: "idle", label: "", done: 0, total: 0, tokens: 0, startedAt: 0, scored: 0, scoreable: 0, capped: false };
let abort = { aborted: false };
let running = false; // an ACTUAL in-flight flag — status can be 'paused'/'idle' while a batch is still awaiting
let runId = 0; // bumped per run; a stale loop's callbacks compare against it and no-op
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }
function syncMarker() {
  try {
    if (state.status === "running" || state.status === "paused") localStorage.setItem(MARKER_KEY, JSON.stringify({ job: state.job, status: state.status }));
    else localStorage.removeItem(MARKER_KEY);
  } catch { /* storage may be unavailable */ }
}
function set(patch: Partial<WarmthTaskState>) { state = { ...state, ...patch }; syncMarker(); emit(); }

export function getWarmthState(): WarmthTaskState { return state; }
export function subscribeWarmth(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
export function isAnalysisRunning(): boolean { return state.status === "running"; }

// Resolve once NO scan batch is in flight (the real `running` flag, not the status — a batch can still be
// awaiting after a cancel flipped the status to idle). Callers await this before mutating the book (e.g. a
// re-import) so a scan's in-flight persist can't land after the new data is written. The timeout is a safety
// valve only: merge-on-persist already prevents a stale write from clobbering, so proceeding is safe even if a
// slow on-device batch outlives the wait.
export function awaitAnalysisStopped(timeoutMs = 20000): Promise<void> {
  if (!running) return Promise.resolve();
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (!running || Date.now() - startedAt > timeoutMs) resolve();
      else setTimeout(tick, 100);
    };
    setTimeout(tick, 100);
  });
}

// Pause: stop the loop but KEEP the banner (with a Resume button). Scores so far are already persisted.
export function pauseWarmthAnalysis(): void {
  if (state.status !== "running") return;
  abort.aborted = true;
  set({ status: "paused", current: undefined });
}
// Cancel: stop and clear (banner goes; re-run later from Insights).
export function cancelWarmthAnalysis(): void {
  abort.aborted = true;
  set({ status: "idle", current: undefined });
}
// Dismiss the FINISHED banner only (can't hide a running/paused scan — you must pause or cancel it).
export function dismissWarmth(): void {
  if (state.status === "done" || state.status === "error") set({ status: "idle" });
}

async function run(job: AnalysisJob, force = false): Promise<void> {
  // Single-slot. `running` (not just status) catches the window where a batch is STILL awaiting after a
  // pause/cancel flipped the status — without it, Pause→Resume (or Cancel→re-run) starts a 2nd GPU loop.
  if (running || state.status === "running") return;
  const avail = await aiAvailability();
  if (!avail.willRun) { set({ status: "idle" }); return; }
  running = true;
  const myId = ++runId;
  abort = { aborted: false };
  // Run-scoped set: if a stale prior loop's callbacks resolve after a newer run started, they no-op
  // instead of clobbering the new run's progress.
  const rset = (patch: Partial<WarmthTaskState>) => { if (myId === runId) set(patch); };
  rset({ status: "running", job, label: JOB_LABEL[job], done: 0, total: 0, tokens: 0, current: undefined, startedAt: Date.now(), scored: 0, scoreable: 0, capped: false, backend: avail.backend, error: undefined });
  try {
    if (job === "warmth") {
      const { scored, scoreable, capped } = await enrichImportedContactsWarmth({
        force, signal: abort,
        onMeta: (m) => rset({ scoreable: m.scoreable, capped: m.capped }),
        onProgress: (p: SentimentProgress) => rset({ done: p.done, total: p.total, tokens: p.tokens, current: p.current }),
      });
      if (!abort.aborted) rset({ status: "done", scored, scoreable, capped });
    } else if (job === "opportunities") {
      const { found, scoreable, capped } = await scanImportedContactsForOpportunities({
        force, signal: abort,
        onMeta: (m) => rset({ scoreable: m.scoreable, capped: m.capped }),
        onProgress: (p: OppScanProgress) => rset({ done: p.done, total: p.total, tokens: p.tokens, current: p.current }),
      });
      if (!abort.aborted) rset({ status: "done", scored: found, scoreable, capped });
    } else {
      // classify — LLM sector classification of the unknown-firm tail (company-level, quick).
      const { updated, companies } = await enrichOtherCompanies({
        signal: abort,
        onProgress: (done, total, current) => rset({ done, total, tokens: 0, current }),
      });
      if (!abort.aborted) rset({ status: "done", scored: updated, scoreable: companies, capped: false });
    }
  } catch (e) {
    rset({ status: "error", error: e instanceof Error ? e.message : String(e) });
  } finally {
    running = false;
  }
}

export function startWarmthAnalysis(opts: { force?: boolean } = {}): void { void run("warmth", opts.force); }
export function startOpportunityScan(opts: { force?: boolean } = {}): void { void run("opportunities", opts.force); }
export function startClassifyScan(): void { void run("classify"); }

// Resume a paused scan (continues the remaining — the pass skips what's already done).
export function resumeWarmthAnalysis(): void {
  if (state.status !== "paused" || !state.job) return;
  void run(state.job);
}

// Called once on app boot: if a scan was mid-flight when the page unloaded, pick it back up.
export function resumeIfInterrupted(): void {
  let marker: { job?: AnalysisJob; status?: string } | null = null;
  try { const raw = localStorage.getItem(MARKER_KEY); marker = raw ? JSON.parse(raw) : null; } catch { marker = null; }
  try { localStorage.removeItem(MARKER_KEY); } catch { /* ignore */ } // cleared; a real resume re-persists it
  if (!marker?.job) return;
  if (marker.status === "running") {
    void run(marker.job); // interrupted mid-run → keep going
  } else if (marker.status === "paused") {
    set({ status: "paused", job: marker.job, label: JOB_LABEL[marker.job] }); // restore the paused banner
  }
}
