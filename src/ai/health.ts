// HONEST-FAILURE LAYER (Batch 2, Phil's product call from the retest). Every stall/error message is
// derived from what we actually KNOW about the backend — never a canned excuse. The retest logged the
// "on-device model warming up" apology on a warm LM Studio (backend-inaccurate) and 179–507s "Almost
// there…" spirals. Buyers running LM Studio inherit TTL eviction + slow prompt-processing; the right
// response is diagnosis and instruction, not a shrug.

import { aiAvailability, type AiAvailability } from "./ai";

export type FailReason = "no-first-token" | "mid-stream-stall" | "error" | "turn-budget";

// The honest label for what the user is actually running.
export function backendNoun(avail: AiAvailability): string {
  if (avail.backend === "webllm" || avail.backend === "builtin") return "the on-device model";
  if (avail.backend === "ollama" || avail.local) return "your local model";
  if (avail.backend === "byok") return "the AI service";
  return "the model";
}

// A user-facing explanation + instruction for a failed/stalled turn, from live state.
export async function explainFailure(reason: FailReason, availAtStart?: AiAvailability): Promise<string> {
  // Re-probe: the situation may have changed since the turn started (server closed, key revoked…).
  let now: AiAvailability | null = null;
  try { now = await aiAvailability(); } catch { now = null; }
  const avail = now ?? availAtStart ?? { willRun: false };
  const noun = backendNoun(avail);
  if (!avail.willRun) {
    if (avail.local || avail.backend === "ollama") {
      return "I can't reach your local model any more — the server (LM Studio or Ollama) looks closed or stopped. Open it, make sure the server is running, and try again; I'll pick right up.";
    }
    return "I can't reach the AI right now — check the AI setup in Settings and try again.";
  }
  const isLocal = avail.local || avail.backend === "ollama" || avail.backend === "webllm" || avail.backend === "builtin";
  switch (reason) {
    case "no-first-token":
      return isLocal
        ? `That one timed out before ${noun} started answering — usually it's reloading into memory (local servers unload idle models) or still reading the context. It should be quicker if you ask again now.`
        : `That request timed out before ${noun} responded — a connection blip, most likely. Give it another go.`;
    case "mid-stream-stall":
      return `${noun[0].toUpperCase()}${noun.slice(1)} stopped mid-answer — likely under memory pressure${isLocal ? " (closing other heavy apps can help)" : ""}. Try again; I'll keep it shorter.`;
    case "turn-budget":
      return isLocal
        ? `I stopped waiting — ${noun} was taking too long on this one (big question, modest hardware). Try a narrower ask, or ask again now it's warmed up.`
        : `I stopped waiting on ${noun} — that's unusually slow. Try again in a moment.`;
    case "error":
    default:
      return `Something went wrong talking to ${noun}. Try again — and if it keeps happening${isLocal ? ", restart the local server (LM Studio/Ollama)" : ", check the AI setup in Settings"}.`;
  }
}

// KEEPALIVE: local servers evict idle models (LM Studio's default TTL is 60 minutes), so the first
// question after a break pays a cold reload. While the app is open on a LOCAL backend, a featherweight
// prompt every ~25 minutes keeps the model resident. No-op elsewhere; stops when the tab is hidden.
export function startKeepalive(promptFn: (text: string) => Promise<unknown>): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const tick = async () => {
    try {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const a = await aiAvailability();
      if (!a.willRun || !(a.local || a.backend === "ollama")) return;
      await promptFn("ok"); // one-token ping; keeps the model loaded
    } catch { /* keepalive is best-effort by definition */ }
  };
  timer = setInterval(tick, 25 * 60 * 1000);
  return () => { if (timer) clearInterval(timer); };
}
