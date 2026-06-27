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
  return Math.round(usableTokens * 3.6 * 0.55);
}
