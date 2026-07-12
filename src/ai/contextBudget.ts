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

// A holistic per-call char budget, sized to the ACTIVE tier's window and split across the three portions of
// the prompt that scale with the book/conversation: retrieved book records, the conversation transcript, and
// ambient memory notes. Sizing all three TOGETHER (rather than a fixed 8-turn / 8-note count) is what makes a
// model switch clean: a small window gets a little of each and can't overflow; a large window uses far more of
// the history it can hold instead of throwing it away. Char-based (token counts are model-specific); ~3.6
// chars/token, reserving headroom for the system prompt, question and the model's own answer.
export type ContextBudget = {
  tokens: number;
  backend?: string;
  grounding: number; // retrieved book records (the summary + relevant records)
  history: number; // the flattened conversation transcript
  memory: number; // ambient memory notes distilled from past chats
};

export async function contextBudget(): Promise<ContextBudget> {
  const info = await aiAvailability();
  const tokens = info.contextTokens && info.contextTokens > 0 ? info.contextTokens : backendDefaultTokens(info.backend);
  const usableTokens = Math.max(1_200, tokens - 1_500);
  const totalChars = Math.round(usableTokens * 3.6);
  // Small in-browser / built-in models PREFILL slowly on a laptop GPU — a big prompt is the main cause of a long
  // "Thinking…". Keep every portion tight so answers start fast; capable backends can hold much more.
  const small = info.backend === "webllm" || info.backend === "builtin";
  const grounding = small ? Math.min(Math.round(totalChars * 0.55), 1_600) : Math.min(Math.round(totalChars * 0.55), 16_000);
  // History gets a real slice of the window instead of an arbitrary last-8 clip: enough that a long chat on a
  // big model is remembered, and only what fits on a small one (budgetedHistory in prompts.ts trims to fit).
  const history = small ? Math.min(Math.round(totalChars * 0.25), 1_200) : Math.min(Math.round(totalChars * 0.3), 24_000);
  const memory = small ? Math.min(Math.round(totalChars * 0.12), 600) : Math.min(Math.round(totalChars * 0.12), 4_000);
  return { tokens, backend: info.backend, grounding, history, memory };
}

// The grounding (retrieved-records) budget alone — the original entry point, kept byte-identical for any
// caller that only sizes records (e.g. the eval harness). New callers should prefer contextBudget().
export async function retrievalCharBudget(): Promise<number> {
  return (await contextBudget()).grounding;
}
