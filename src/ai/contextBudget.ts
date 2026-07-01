// How much of the book we may hand the model as grounding context, sized to the ACTIVE AI tier. A
// small on-device model has a tiny window, so we send the summary + a focused slice of relevant
// records; a local 7B/Ollama model gets much more; a BYOK frontier model can get everything (all
// records + recent chat memory). The broker reports the tier via the availability call; if it doesn't
// (older host), we assume a conservative on-device budget. Returned as a CHARACTER budget for the
// retrieved-records portion of the prompt (the summary + question + answer are budgeted separately).

import { aiAvailability } from "./ai";

// Default context windows (tokens) by backend, used only when the host doesn't report contextTokens.
function backendDefaultTokens(backend?: string): number {
  switch (backend) {
    case "byok": return 128_000; // frontier cloud — effectively "everything"
    case "ollama": return 32_768; // local runtime, mid/large models
    case "stub": return 8_192; // dev stub — generous so tests exercise retrieval
    case "builtin": return 4_096; // Chrome Gemini Nano
    case "webllm": return 4_096; // small in-browser model (default demo)
    default: return 4_096; // unknown host → conservative
  }
}

// ~3.6 chars per token; reserve headroom for the system prompt, the question, the conversation and the
// model's own answer; give the retrieved records ~55% of what's left.
export async function retrievalCharBudget(): Promise<number> {
  const info = await aiAvailability();
  const tokens = info.contextTokens && info.contextTokens > 0 ? info.contextTokens : backendDefaultTokens(info.backend);
  const usableTokens = Math.max(1_200, tokens - 1_500);
  const chars = Math.round(usableTokens * 3.6 * 0.55);
  // Small in-browser / built-in models PREFILL slowly on a laptop GPU — a big prompt is the main cause of a
  // long "Thinking…" before the first token. Cap their grounding hard so answers start fast.
  const small = info.backend === "webllm" || info.backend === "builtin";
  if (small) return Math.min(chars, 1_600);
  // Capable backends (BYOK/Ollama) have huge context windows, but a FOCUSED slice beats dumping the whole
  // book: a quarter-million-char grounding (≈44k tokens) is slow, costly, and drowns the relevant records in
  // noise (it once blew up here). The retriever surfaces the records that matter; ~16k chars (≈4–5k tokens)
  // is plenty for any specific query, and broad "summarise my book" asks are served by the compact summary.
  return Math.min(chars, 16_000);
}
