// Thin client for the Freehold AI broker. Business Book runs as a SEALED Freehold app, so it never
// holds a model or an API key — it only asks the host via window.freehold.request('ai', …). In the
// marketplace the parent broker provides that (Freehold Phases 0–3); in local `npm run dev` the
// dev shim (devBroker.ts) installs an equivalent. Same contract either way.
//
// Everything here is human-in-the-loop by design: these helpers just FETCH a suggestion. Whether it
// gets used is always the user's click (see AiSuggest).

import { useEffect, useState } from "react";

type Broker = { request: (cap: string, method: string, args?: unknown) => Promise<unknown> };

function broker(): Broker | null {
  const f = (window as unknown as { freehold?: Broker }).freehold;
  return f && typeof f.request === "function" ? f : null;
}

export type PromptArgs = { prompt: string; system?: string; json?: boolean; temperature?: number };

// The broker's AI availability report. `backend` + `contextTokens` (when the host provides them) let
// the app SCALE how much of the book it sends as context to the active tier — a tiny on-device model
// gets a focused slice, a BYOK frontier model can get everything. Older hosts only return willRun.
export type AiAvailability = { willRun: boolean; backend?: string; contextTokens?: number; onDevice?: string; byok?: boolean; model?: string };

export async function aiAvailability(): Promise<AiAvailability> {
  const f = broker();
  if (!f) return { willRun: false };
  try {
    const a = (await f.request("ai", "availability")) as Partial<AiAvailability> | null;
    return { willRun: !!a?.willRun, backend: a?.backend, contextTokens: a?.contextTokens, onDevice: a?.onDevice, byok: a?.byok, model: a?.model };
  } catch {
    return { willRun: false };
  }
}

// Is AI usable right now? (a model or key is reachable). Never throws.
export async function aiAvailable(): Promise<boolean> {
  return (await aiAvailability()).willRun;
}

// Run one prompt through the broker and return the model's text.
export async function aiPrompt(args: PromptArgs): Promise<string> {
  const f = broker();
  if (!f) throw new Error("AI isn't available here.");
  const out = await f.request("ai", "prompt", args);
  return typeof out === "string" ? out : String(out ?? "");
}

// Run a prompt and STREAM the answer — `onToken` receives the accumulated text as it's generated, so the
// UI can show the reply forming. Falls back to a single one-shot call (onToken once at the end) when the
// broker doesn't support streaming. Returns the final text. Never throws past the broker's own errors.
type StreamBroker = Broker & { requestStream?: (cap: string, method: string, args: unknown, onToken: (full: string) => void) => Promise<unknown> };
export async function aiPromptStream(args: PromptArgs, onToken: (full: string) => void): Promise<string> {
  const f = broker() as StreamBroker | null;
  if (!f) throw new Error("AI isn't available here.");
  if (typeof f.requestStream === "function") {
    const out = await f.requestStream("ai", "prompt", args, onToken);
    return typeof out === "string" ? out : String(out ?? "");
  }
  const out = await aiPrompt(args);
  onToken(out);
  return out;
}

// Run a JSON-mode prompt and parse the result leniently — small on-device models sometimes wrap the
// object in prose or a ```json fence, so we extract the first {...} or [...] before parsing.
export async function aiJson<T>(args: PromptArgs): Promise<T> {
  const raw = await aiPrompt({ ...args, json: true });
  const start = raw.search(/[{[]/);
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  const slice = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  return JSON.parse(slice) as T;
}

// ── Brokered web search (network-egress capability) ───────────────────────────────────────────
export type EntityFacts = { found: boolean; title?: string; description?: string; extract?: string };
export type WebResult = { title: string; snippet: string; url: string };

export async function searchAvailable(): Promise<boolean> {
  const f = broker();
  if (!f) return false;
  const caps = (f as unknown as { capabilities?: string[] }).capabilities;
  if (Array.isArray(caps) && !caps.includes("search")) return false;
  try {
    const a = (await f.request("search", "availability")) as { ok?: boolean } | null;
    return !!a?.ok;
  } catch {
    return false;
  }
}

// Grounded facts about an organisation/thing (Wikipedia). Used to classify companies accurately.
export async function searchEntity(name: string): Promise<EntityFacts> {
  const f = broker();
  if (!f) throw new Error("Search isn't available here.");
  return (await f.request("search", "entity", { name })) as EntityFacts;
}

// General web results (Wikipedia by default, or the buyer's own search key).
export async function searchWeb(query: string, max = 5): Promise<WebResult[]> {
  const f = broker();
  if (!f) throw new Error("Search isn't available here.");
  const out = (await f.request("search", "web", { query, max })) as { results?: WebResult[] } | null;
  return out?.results ?? [];
}

export function useSearchAvailable(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    searchAvailable().then((v) => { if (live) setOk(v); });
    return () => { live = false; };
  }, []);
  return ok;
}

// ── AI tier (backend) detection + dev switching ───────────────────────────────────────────────
//
// ARCHITECTURE PRINCIPLES (codified 2026-06-29 after a long bug-bash — the robustness came from these,
// NOT from the individual patches; apply them to every new AI feature):
//
//  1. THE MODEL NARRATES, IT NEVER COMPUTES. All facts/counts/rankings/entities are computed
//     deterministically (src/ai/compute.ts tools); the model only routes + phrases. Every fabrication we
//     ever fixed ("30 contracts", invented names) was the model touching data it shouldn't. When a free-form
//     answer is unavoidable, GROUND it in retrieved facts (web/entity lookup), don't trust model memory.
//     → Prefer pushing a query into a deterministic tool over adding another "don't fabricate" prompt rule.
//
//  2. TWO INDEPENDENT GATING AXES — never conflate them:
//       • CAPABILITY (isCapableBackend / capabilityLevel) → gates persona richness + whether to TRUST the
//         model for LLM tool-routing or JSON. About what the model can do WELL.
//       • SPEED (isCapableBackend ≈ "fast tier") → gates EXTRA, BLOCKING round-trips: the LLM tool-router,
//         chip-generation, the enrichment model-fallback. WebLLM is slow at ANY size, so these are off there.
//     (We once gated the tool-router on capability="mid" and it HUNG WebLLM — it was a speed decision.)
//
//  3. SAFETY FLOOR — a miss must DEGRADE, never hang or fabricate: keyword router (every tier) → LLM
//     tool-router (fast tiers) → grounded free-form, with a hard time-to-first-token TIMEOUT so a stuck
//     on-device model falls back to records instead of an endless "Thinking…". Deterministic-first means
//     most queries never reach the model at all.
//
export type AiBackend = "webllm" | "builtin" | "byok" | "ollama" | "stub";

// A "capable" backend can be trusted with the full (long) persona, the extra chip-generation round-trip,
// AI field-extraction, and — later — LLM routing-to-tools. This is about MODEL capability, NOT which tier
// delivers it: BYOK cloud and a local Ollama runtime (users typically run a capable 8B–70B there) both
// qualify; the tiny built-in (Nano) and in-browser WebLLM (small 3B) don't. Ideally the broker reports a
// per-model capability flag — until then this is the sensible default by backend.
export function isCapableBackend(backend?: string): boolean {
  return backend === "byok" || backend === "ollama";
}

// Capability is per-MODEL, not per-tier — and it's a GRADIENT, not a binary. WebLLM spans 1B→7B; Ollama
// spans 1B→70B. "small" = keyword-route + compact persona; "mid" = can do LLM routing/JSON (slower, but
// capable); "high" = full treatment. Used to scale the persona + (later) whether to trust LLM tool-routing.
// NB this stays separate from the SPEED axis: WebLLM is slow at ANY size (browser GPU), so the extra
// non-essential calls (chip-gen, field-extraction) are gated on speed, not this level.
export type Capability = "small" | "mid" | "high";
export function capabilityLevel(backend?: string, model?: string): Capability {
  if (backend === "byok") return "high";
  const m = (model || "").toLowerCase();
  const billions = (() => { const x = m.match(/\b(\d+(?:\.\d+)?)\s*b\b/) || m.match(/-(\d+(?:\.\d+)?)b-/); return x ? parseFloat(x[1]) : null; })();
  if (backend === "ollama") return billions != null && billions < 4 ? "mid" : "high";
  if (backend === "webllm") return billions != null && billions >= 6 ? "mid" : billions != null && billions <= 1.5 ? "small" : "mid";
  return "small"; // builtin (Nano) / stub
}

// "Llama-3.2-3B-Instruct-q4f16_1-MLC" → "Llama 3.2 3B"; "claude-opus-4-8" → "claude-opus-4-8" (as-is).
export function shortModelName(model?: string): string {
  if (!model) return "";
  if (/^Gemini/i.test(model)) return model;
  const base = model.replace(/-Instruct.*$/i, "").replace(/-q\d.*$/i, "");
  if (/^(Llama|Qwen|Phi|Mistral|Gemma)/i.test(base)) return base.replace(/[-_]/g, " ");
  return model;
}

// What on-device AI this browser CAN run (for the setup ladder). webgpu → WebLLM is possible (needs a
// one-time download); builtin → Chrome's Gemini Nano is present now; byok → a key is configured.
export function aiCapabilities(): { webgpu: boolean; builtin: boolean; byok: boolean } {
  const w = window as unknown as { navigator?: { gpu?: unknown }; LanguageModel?: unknown; ai?: { languageModel?: unknown } };
  let byok = false;
  try { const r = localStorage.getItem("freehold.ai.byok.v1"); byok = !!(r && JSON.parse(r)?.apiKey); } catch { /* ignore */ }
  return { webgpu: !!w.navigator?.gpu, builtin: !!(w.LanguageModel || w.ai?.languageModel), byok };
}

// Kick off on-device setup: clear any "off"/forced flags and fire a warm-up so the broker starts loading
// (WebLLM shows its one-time download confirm + progress). Resolves once the model is ready (or rejects if
// the user declines). In the sealed marketplace the HOST broker owns provisioning — this is the dev path.
export async function startOnDeviceSetup(): Promise<void> {
  // The in-app CTA IS the consent — mark it so the broker doesn't pop a second native download confirm.
  try { localStorage.setItem("freehold.dev.webllm.consented", "1"); localStorage.removeItem("freehold.dev.webllm"); localStorage.removeItem("freehold.dev.backend"); } catch { /* ignore */ }
  await aiPrompt({ prompt: "Hello" });
}

// A short, human label for the active tier (shown under the composer).
export function backendLabel(backend?: string, byok?: boolean): string {
  switch (backend) {
    case "webllm": return "On-device AI";
    case "builtin": return "Built-in AI";
    case "ollama": return "Local runtime";
    case "byok": return "Your API key";
    case "stub": return "Demo mode";
    default: return byok ? "Your API key" : "AI";
  }
}

// React hook: the active backend + a friendly label. Re-checks when `nonce` changes (e.g. after a switch).
export function useAiBackend(nonce = 0): { backend?: string; label: string; contextTokens?: number; byok?: boolean; model?: string } {
  const [s, setS] = useState<{ backend?: string; label: string; contextTokens?: number; byok?: boolean; model?: string }>({ label: "AI" });
  useEffect(() => {
    let live = true;
    aiAvailability().then((a) => { if (live) setS({ backend: a.backend, label: backendLabel(a.backend, a.byok), contextTokens: a.contextTokens, byok: a.byok, model: a.model }); });
    return () => { live = false; };
  }, [nonce]);
  return s;
}

// Whether we're in the dev shim (where the app can switch tiers). In the sealed marketplace the HOST
// brokers model selection, so this is false and the switcher renders as a read-only label.
const IS_DEV = !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV;
export function aiSwitchingAvailable(): boolean { return IS_DEV; }

// The tiers selectable in dev, with whether each is actually usable in this browser.
export function devBackendOptions(): { id: AiBackend; label: string; available: boolean }[] {
  if (!IS_DEV) return [];
  const w = window as unknown as { navigator?: { gpu?: unknown }; LanguageModel?: unknown; ai?: { languageModel?: unknown } };
  const hasWebGPU = !!w.navigator?.gpu;
  const hasBuiltin = !!(w.LanguageModel || w.ai?.languageModel);
  let hasByok = false;
  try { const r = localStorage.getItem("freehold.ai.byok.v1"); hasByok = !!(r && JSON.parse(r)?.apiKey); } catch { /* ignore */ }
  return [
    { id: "webllm", label: "On-device (WebLLM)", available: hasWebGPU },
    { id: "builtin", label: "Browser built-in", available: hasBuiltin },
    { id: "byok", label: "Your API key", available: hasByok },
    { id: "stub", label: "Demo stub", available: true },
  ];
}

// Switch the active tier in dev (forces the dev broker's backend, then reloads to apply). No-op in prod.
export function setDevBackend(id: AiBackend): void {
  if (!IS_DEV) return;
  try {
    localStorage.setItem("freehold.dev.backend", id);
    location.reload();
  } catch { /* ignore */ }
}

// React hook: null while checking, then true/false. AI affordances render only when true.
export function useAiAvailable(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    aiAvailable().then((v) => {
      if (live) setOk(v);
    });
    return () => {
      live = false;
    };
  }, []);
  return ok;
}
