// LOCAL FAILURE LOG (the no-telemetry learning loop, part b). A sealed product ships with no usage
// telemetry — improvement rides on reported bugs. This is the ambient half: an on-device, append-only
// record of FAILURES ONLY (a turn stalled, a narration was dropped as unfaithful, the router fell
// back), so the user can "export diagnostics" into a bug report instead of failures vanishing silently.
//
// METADATA ONLY — never a question, answer, name or any book content (that stays in the user-initiated,
// user-reviewed flag report). Capped ring buffer in localStorage; nothing leaves the machine on its own.

export type FailureReason =
  | "no-first-token" | "mid-stream-stall" | "turn-budget" | "error"
  | "narration-dropped" | "router-fallback";

export type FailureEntry = { at: number; surface: string; reason: FailureReason; backend?: string; ms?: number };

const KEY = "bob.failures.v1";
const CAP = 200; // a ring buffer — the newest CAP failures, older ones drop off

export function listFailures(): FailureEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as FailureEntry[]) : [];
  } catch {
    return [];
  }
}

export function logFailure(e: Omit<FailureEntry, "at">): void {
  try {
    const list = listFailures();
    list.push({ at: Date.now(), ...e });
    localStorage.setItem(KEY, JSON.stringify(list.slice(-CAP)));
  } catch {
    /* diagnostics are best-effort — a full/blocked store must never break a turn */
  }
}

export function clearFailures(): void {
  try { localStorage.removeItem(KEY); } catch { /* best-effort */ }
}

// Human-readable reasons for the exported report.
const REASON_LABEL: Record<FailureReason, string> = {
  "no-first-token": "timed out before the model answered",
  "mid-stream-stall": "stalled mid-answer",
  "turn-budget": "took too long (turn budget hit)",
  "error": "errored talking to the model",
  "narration-dropped": "narration dropped (failed the faithfulness check)",
  "router-fallback": "router couldn't decide (fell back)",
};

// A compact, content-free diagnostics block for a bug report. `nowMs` is passed in so the header
// timestamp is caller-controlled (the app owns its one impure clock read).
export function failuresReportText(nowMs: number): string {
  const list = listFailures();
  if (!list.length) return "No failures recorded on this device.";
  const isoDate = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
  const lines = list.slice(-40).reverse().map((f) => {
    const ago = Math.max(0, Math.round((nowMs - f.at) / 60000));
    const meta = [f.backend, f.ms != null ? `${Math.round(f.ms / 1000)}s` : ""].filter(Boolean).join(" · ");
    return `- ${isoDate(f.at)} (${ago}m ago) · ${f.surface}: ${REASON_LABEL[f.reason] || f.reason}${meta ? ` [${meta}]` : ""}`;
  });
  return `Recent failures on this device (${list.length} total, newest first):\n${lines.join("\n")}`;
}
