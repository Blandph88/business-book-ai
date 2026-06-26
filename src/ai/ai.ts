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

// Is AI usable right now? (a model or key is reachable). Never throws.
export async function aiAvailable(): Promise<boolean> {
  const f = broker();
  if (!f) return false;
  try {
    const a = (await f.request("ai", "availability")) as { willRun?: boolean } | null;
    return !!a?.willRun;
  } catch {
    return false;
  }
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
