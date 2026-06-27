// Dev-only window.freehold shim so AI features work during `npm run dev` (where there's no Freehold
// parent to broker inference). It mirrors the marketplace broker's routing: in-browser WebLLM (the
// model the Freehold DEMO runs — so you can judge real AI quality on the actual demo model) → the
// browser's built-in model → the buyer's BYOK endpoint (from localStorage) → a deterministic STUB so
// the UI is testable with no model at all. In the sealed marketplace the parent already defines
// window.freehold, so this no-ops; and it's installed ONLY under import.meta.env.DEV, so it never
// ships in the product bundle.
//
// WebLLM (the default when your browser has WebGPU): on first AI use you're asked to download a model
// once (~1.9 GB), then it runs fully on-device — this is exactly how the Freehold demo behaves, so
// use it to gauge whether the AI features are good enough on the demo model.
//   • Pick a different model:  localStorage "freehold.dev.webllm.model" = "Qwen2.5-7B-Instruct-q4f16_1-MLC"
//   • Turn WebLLM off (use built-in / key / stub instead):  localStorage "freehold.dev.webllm" = "off"
//
// To test against a cloud model instead, set localStorage "freehold.ai.byok.v1" to
//   {"wire":"anthropic","endpoint":"https://api.anthropic.com","apiKey":"sk-…","model":"claude-opus-4-8"}
// (or an OpenAI-compatible endpoint).

type PromptArgs = { prompt?: string; system?: string; json?: boolean; temperature?: number };

// ── In-browser WebLLM (the Freehold demo model) ────────────────────────────────────────────────
const WEBLLM_CDN = "https://esm.run/@mlc-ai/web-llm";
const DEFAULT_WEBLLM_MODEL = "Llama-3.2-3B-Instruct-q4f16_1-MLC"; // balanced quality/size for judging
const WEBLLM_GB: Record<string, number> = {
  "Llama-3.2-1B-Instruct-q4f16_1-MLC": 0.9,
  "Llama-3.2-3B-Instruct-q4f16_1-MLC": 1.9,
  "Qwen2.5-3B-Instruct-q4f16_1-MLC": 1.9,
  "Qwen2.5-7B-Instruct-q4f16_1-MLC": 4.7,
};

function webgpu(): boolean {
  return !!(navigator as unknown as { gpu?: unknown }).gpu;
}
function webllmModel(): string {
  try { return localStorage.getItem("freehold.dev.webllm.model") || DEFAULT_WEBLLM_MODEL; } catch { return DEFAULT_WEBLLM_MODEL; }
}
function webllmEnabled(): boolean {
  if (!webgpu()) return false;
  try { return localStorage.getItem("freehold.dev.webllm") !== "off"; } catch { return true; }
}

let enginePromise: Promise<{ chat: { completions: { create(r: Record<string, unknown>): Promise<{ choices: { message: { content: string } }[] }> } } }> | null = null;
function loadEngine(): Promise<NonNullable<Awaited<typeof enginePromise>>> {
  if (enginePromise) return enginePromise as never;
  const model = webllmModel();
  const gb = WEBLLM_GB[model] ?? 1.9;
  const okDownload = window.confirm(
    `Business Book (dev): download the on-device AI model "${model}" (~${gb} GB, one-time)?\n\n` +
      `This is the model the Freehold demo runs — use it to judge AI quality. ` +
      `Cancel to fall back to a built-in model / your key / the stub.`,
  );
  if (!okDownload) return Promise.reject(new Error("WebLLM download declined"));
  enginePromise = (async () => {
    const mod = (await import(/* @vite-ignore */ WEBLLM_CDN)) as { CreateMLCEngine: (m: string, o?: Record<string, unknown>) => Promise<never> };
    return mod.CreateMLCEngine(model, {
      initProgressCallback: (r: { text?: string }) => { if (r?.text) console.info("[Business Book dev · WebLLM]", r.text); },
    });
  })();
  return enginePromise as never;
}
async function webllmPrompt(input: string, opts?: PromptArgs): Promise<string> {
  const engine = await loadEngine();
  const messages: { role: string; content: string }[] = [];
  if (opts?.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: input });
  const res = await engine.chat.completions.create({
    messages,
    temperature: opts?.temperature ?? 0.7,
    ...(opts?.json ? { response_format: { type: "json_object" } } : {}),
  });
  return res.choices?.[0]?.message?.content ?? "";
}

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
    const onDevice = webllmEnabled() || builtinFactory() ? "available" : "unavailable";
    // Mirror the marketplace broker: report the active backend + its context window so the app can
    // size how much of the book it sends as grounding (small model → focused slice; big → everything).
    const backend = webllmEnabled() ? "webllm" : builtinFactory() ? "builtin" : byokConfig() ? "byok" : "stub";
    const contextTokens = backend === "byok" ? 128_000 : backend === "stub" ? 8_192 : backend === "webllm" ? 8_192 : 4_096;
    return { onDevice, byok: !!byokConfig(), willRun: true, backend, contextTokens };
  }
  if (method === "prompt") {
    const text = typeof args?.prompt === "string" ? args.prompt : "";
    if (!text.trim()) throw new Error("Empty prompt.");
    // WebLLM first (the demo model). If the buyer declines the one-time download, remember that for
    // the session and fall through to the next backend rather than asking again on every call.
    if (webllmEnabled()) {
      try {
        return await webllmPrompt(text, args);
      } catch (e) {
        if (e instanceof Error && e.message.includes("declined")) {
          try { localStorage.setItem("freehold.dev.webllm", "off"); } catch { /* ignore */ }
        } else {
          console.warn("[Business Book dev · WebLLM] failed, falling back:", e);
        }
      }
    }
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
