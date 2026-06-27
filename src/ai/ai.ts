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
export type AiAvailability = { willRun: boolean; backend?: string; contextTokens?: number; onDevice?: string; byok?: boolean };

export async function aiAvailability(): Promise<AiAvailability> {
  const f = broker();
  if (!f) return { willRun: false };
  try {
    const a = (await f.request("ai", "availability")) as Partial<AiAvailability> | null;
    return { willRun: !!a?.willRun, backend: a?.backend, contextTokens: a?.contextTokens, onDevice: a?.onDevice, byok: a?.byok };
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
