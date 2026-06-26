// Dev-only window.freehold shim so AI features work during `npm run dev` (where there's no Freehold
// parent to broker inference). It mirrors the marketplace broker's routing: on-device built-in model
// → the buyer's BYOK endpoint (from localStorage) → a deterministic STUB so the UI is testable with
// no key at all. In the sealed marketplace the parent already defines window.freehold, so this
// no-ops; and it's installed ONLY under import.meta.env.DEV, so it never ships in the product bundle.
//
// To test against a real model in dev, set localStorage "freehold.ai.byok.v1" to
//   {"wire":"anthropic","endpoint":"https://api.anthropic.com","apiKey":"sk-…","model":"claude-opus-4-8"}
// (or an OpenAI-compatible endpoint). Otherwise the stub returns marked placeholder text.

type PromptArgs = { prompt?: string; system?: string; json?: boolean; temperature?: number };

function builtinFactory(): { create: (o?: Record<string, unknown>) => Promise<{ prompt(s: string): Promise<string>; destroy?: () => void }> } | null {
  const g = window as unknown as Record<string, unknown>;
  if (g.LanguageModel) return g.LanguageModel as never;
  const ai = g.ai as { languageModel?: unknown } | undefined;
  if (ai?.languageModel) return ai.languageModel as never;
  return null;
}

type Byok = { wire: "anthropic" | "openai"; endpoint: string; apiKey: string; model: string };
function byokConfig(): Byok | null {
  try {
    const raw = localStorage.getItem("freehold.ai.byok.v1");
    const c = raw ? (JSON.parse(raw) as Byok) : null;
    return c && c.apiKey ? c : null;
  } catch {
    return null;
  }
}

async function builtinPrompt(input: string, opts?: PromptArgs): Promise<string> {
  const f = builtinFactory()!;
  const createOpts: Record<string, unknown> = {};
  if (opts?.system) createOpts.initialPrompts = [{ role: "system", content: opts.system }];
  const session = await f.create(createOpts);
  try {
    return await session.prompt(input);
  } finally {
    try {
      session.destroy?.();
    } catch {
      /* ignore */
    }
  }
}

async function byokPrompt(cfg: Byok, input: string, opts?: PromptArgs): Promise<string> {
  const base = cfg.endpoint.replace(/\/$/, "");
  if (cfg.wire === "anthropic") {
    const r = await fetch(base + "/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: cfg.model, max_tokens: 1024, system: opts?.system, messages: [{ role: "user", content: input }] }),
    });
    if (!r.ok) throw new Error("AI endpoint error " + r.status);
    const d = await r.json();
    const b = (d.content || []).find((x: { type?: string }) => x.type === "text");
    return b?.text ?? "";
  }
  const msgs: { role: string; content: string }[] = [];
  if (opts?.system) msgs.push({ role: "system", content: opts.system });
  msgs.push({ role: "user", content: input });
  const res = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + cfg.apiKey },
    body: JSON.stringify({ model: cfg.model, messages: msgs, response_format: opts?.json ? { type: "json_object" } : undefined }),
  });
  if (!res.ok) throw new Error("AI endpoint error " + res.status);
  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? "";
}

function stubPrompt(input: string, opts?: PromptArgs): string {
  if (opts?.json) return JSON.stringify({ stub: true, note: "dev stub — configure a key for real output", echo: input.slice(0, 200) });
  return `[dev-stub AI] No model/key configured. This is placeholder text so the UI is testable.\n\n(prompt was: ${input.slice(0, 160)}…)`;
}

// ── web search (dev) — free Wikipedia, or a BYO key from localStorage ──────────────────────────
async function wikiSearch(query: string, max = 5): Promise<{ title: string; snippet: string; url: string }[]> {
  const u = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=${max}`;
  const r = await fetch(u);
  if (!r.ok) return [];
  const d = await r.json();
  return (d?.query?.search ?? []).map((s: { title: string; snippet?: string }) => ({ title: s.title, snippet: String(s.snippet || "").replace(/<[^>]+>/g, ""), url: `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title)}` }));
}
async function wikiEntity(name: string): Promise<{ found: boolean; title?: string; description?: string; extract?: string }> {
  const top = await wikiSearch(name, 1);
  if (!top.length) return { found: false };
  const title = top[0].title;
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    if (!r.ok) return { found: true, title, extract: top[0].snippet };
    const d = await r.json();
    return { found: true, title: d.title || title, description: d.description, extract: d.extract };
  } catch {
    return { found: true, title, extract: top[0].snippet };
  }
}
async function searchHandler(method: string, args: { query?: string; name?: string; max?: number }): Promise<unknown> {
  if (method === "availability") return { ok: true, provider: "wikipedia" };
  if (method === "entity") {
    const n = (args?.name ?? "").trim();
    if (!n) throw new Error("Empty name.");
    return wikiEntity(n);
  }
  if (method === "web" || method === "query") {
    const q = (args?.query ?? "").trim();
    if (!q) throw new Error("Empty query.");
    return { results: await wikiSearch(q, args?.max) };
  }
  throw new Error("Unknown search method '" + method + "'.");
}

async function aiHandler(method: string, args: PromptArgs): Promise<unknown> {
  if (method === "availability") {
    const onDevice = builtinFactory() ? "available" : "unavailable";
    return { onDevice, byok: !!byokConfig(), willRun: true }; // stub guarantees willRun in dev
  }
  if (method === "prompt") {
    const text = typeof args?.prompt === "string" ? args.prompt : "";
    if (!text.trim()) throw new Error("Empty prompt.");
    if (builtinFactory()) return builtinPrompt(text, args);
    const cfg = byokConfig();
    if (cfg) return byokPrompt(cfg, text, args);
    return stubPrompt(text, args);
  }
  throw new Error("Unknown AI method '" + method + "'.");
}

export function installDevBroker(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { freehold?: { request?: unknown } };
  if (w.freehold && typeof w.freehold.request === "function") return; // sealed marketplace already provides it
  w.freehold = Object.freeze({
    capabilities: ["ai", "search"],
    request: (capability: string, method: string, args: PromptArgs) => {
      try {
        if (capability === "ai") return Promise.resolve(aiHandler(method, args));
        if (capability === "search") return Promise.resolve(searchHandler(method, args as { query?: string; name?: string; max?: number }));
        return Promise.reject(new Error("Freehold(dev): capability '" + capability + "' not available"));
      } catch (e) {
        return Promise.reject(e);
      }
    },
  });
}
