// Demo-only, content-free product analytics for Business Book.
//
// WHY THIS SHAPE:
//  • The BOUGHT copy is sealed (null-origin iframe, connect-src 'none') and MUST never phone home — that's the
//    product promise. So this whole module is a NO-OP in owned mode (isDemo() gate). It only ever emits in the
//    hosted demo.
//  • Even in the demo, the sealed frame can't open a socket, so events are handed to the HOST via the capability
//    broker (window.freehold.request('track', 'event', …)); the parent validates + forwards to /api/track. In
//    dev the shim broker no-ops. If the broker has no 'track' capability, the call rejects and we swallow it.
//  • CONTENT NEVER LEAVES. A real prospect might paste their real book into the demo, so we log only EVENTS +
//    categorical METADATA (intent category, tier, counts, length buckets, booleans) — never query text, names,
//    records, or answers. `sanitizeProps` enforces this structurally: anything that isn't a short scalar is
//    dropped, so free text can't ride along even by mistake. Failures are always swallowed — analytics must
//    never break a user flow.
//
// The event names mirror Freehold's allowlist (src/lib/analytics.ts there / api/track.ts) — the server drops
// anything not on its list, so keep these in sync.
import { isDemo } from "./appMode";

export const EVENT_NAMES = [
  "app_launch",
  "conversation_start",
  "ai_prompt",
  "ai_declined",
  "ai_unavailable",
  "search",
  "filter_apply",
  "upload_start",
  "tour_step",
  "tour_complete",
  "tier_select",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

const ANON_KEY = "bob.demo.anon.v1";
const SESSION_KEY = "bob.demo.session.v1";
const FLUSH_MS = 2000;
const MAX_BUFFER = 20;
const MAX_PROP_STR = 32; // a categorical value, never a sentence

const hasWindow = typeof window !== "undefined";

// Only short scalars survive — a hard guarantee that no query text / name / record can be logged, even if a
// call site passes one by mistake. Strings are capped; objects/arrays/long strings are dropped entirely.
function sanitizeProps(p?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!p) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && v.length <= MAX_PROP_STR) out[k] = v;
    // anything else (long string, object, array, null) is intentionally dropped
  }
  return out;
}

function rid(prefix: string): string {
  try { return `${prefix}_${crypto.randomUUID()}`; }
  catch { return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`; }
}
function idIn(store: Storage | undefined, key: string, prefix: string): string {
  try {
    if (!store) return rid(prefix);
    let v = store.getItem(key);
    if (!v) { v = rid(prefix); store.setItem(key, v); }
    return v;
  } catch { return rid(prefix); }
}
const anonId = () => idIn(hasWindow ? window.localStorage : undefined, ANON_KEY, "anon");
const sessionId = () => idIn(hasWindow ? window.sessionStorage : undefined, SESSION_KEY, "sess");

type Queued = { event: EventName; props?: Record<string, unknown>; anonId: string; sessionId: string; ts: number };
let buffer: Queued[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let unloadBound = false;

// The broker forwards events to /api/track. Absent (e.g. a bare build) → we simply never emit.
function broker(): { request?: (c: string, m: string, a: unknown) => Promise<unknown> } | null {
  const f = (window as unknown as { freehold?: { request?: (c: string, m: string, a: unknown) => Promise<unknown> } }).freehold;
  return f && typeof f.request === "function" ? f : null;
}

function bindUnload(): void {
  if (unloadBound || !hasWindow) return;
  unloadBound = true;
  window.addEventListener("pagehide", () => void flush());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void flush(); });
}

function scheduleFlush(): void {
  if (buffer.length >= MAX_BUFFER) { void flush(); return; }
  if (flushTimer) return;
  flushTimer = setTimeout(() => void flush(), FLUSH_MS);
}

// Record a demo event. No-op in owned mode (the seal) and when there's no window. Never throws.
export function track(event: EventName, props?: Record<string, unknown>): void {
  if (!hasWindow || !isDemo()) return;
  try {
    buffer.push({ event, props: sanitizeProps(props), anonId: anonId(), sessionId: sessionId(), ts: Date.now() });
    bindUnload();
    scheduleFlush();
  } catch { /* analytics must never throw into a user flow */ }
}

async function flush(): Promise<void> {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!buffer.length) return;
  const f = broker();
  if (!f?.request) return; // no host to forward through — drop (owned/bare build)
  const batch = buffer.splice(0);
  try { await f.request("track", "event", { events: batch }); }
  catch { /* drop on failure — never retry-storm, never surface */ }
}

// Length bucket for a message — lets us learn "are people writing one-liners or paragraphs?" without EVER
// logging the text itself.
export function lenBucket(n: number): string {
  if (n <= 0) return "0";
  if (n <= 20) return "1-20";
  if (n <= 60) return "21-60";
  if (n <= 140) return "61-140";
  return "140+";
}
