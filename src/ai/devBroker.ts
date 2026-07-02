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

// Remembers (per model) that the user already OK'd the one-time download, so we don't re-prompt the 1.9 GB
// confirm on every page reload or dev HMR re-execution of this module (the model itself is cached by MLC).
const ACCEPTED_KEY = "freehold.dev.webllm.accepted";
function downloadAccepted(model: string): boolean {
  // Either accepted this exact model before, OR the user already consented via an in-app CTA (setup card /
  // upgrade nudge) — so we don't show a second native confirm on top of the app's own dialog.
  try { return localStorage.getItem("freehold.dev.webllm.consented") === "1" || localStorage.getItem(ACCEPTED_KEY) === model; } catch { return false; }
}

// Broadcast model-load progress so the UI can show "Setting up the assistant… 34%" instead of a silent
// spinner. `firstRun` distinguishes the genuine one-time DOWNLOAD from the (every-reload) load of the
// already-cached model into GPU memory — the latter happens each page load and is NOT one-time.
function emitLoad(active: boolean, progress: number, firstRun: boolean, text: string): void {
  try { window.dispatchEvent(new CustomEvent("freehold:ai-load", { detail: { active, progress, firstRun, text } })); } catch { /* ignore */ }
}

let enginePromise: Promise<{ chat: { completions: { create(r: Record<string, unknown>): Promise<{ choices: { message: { content: string } }[] }> } } }> | null = null;
function loadEngine(): Promise<NonNullable<Awaited<typeof enginePromise>>> {
  if (enginePromise) return enginePromise as never;
  const model = webllmModel();
  const gb = WEBLLM_GB[model] ?? 1.9;
  // First run = the model hasn't been downloaded before (so this is the genuine one-time download).
  const firstRun = !downloadAccepted(model);
  // Ask at most ONCE per model. The accept flag persists across reloads + HMR, so a new chat thread never
  // re-triggers the confirm; on a cached model this loads straight from the browser cache.
  if (firstRun) {
    const okDownload = window.confirm(
      `Turn on the AI assistant?  (one-time setup)\n\n` +
        `It runs privately on your own device — what you type never leaves your computer. ` +
        `That means downloading the model once (about ${gb} GB). It takes a couple of minutes on a good ` +
        `connection; after that it's instant and even works offline.\n\n` +
        `Press OK to set it up now, or Cancel to skip the AI for now.`,
    );
    if (!okDownload) return Promise.reject(new Error("WebLLM download declined"));
    try { localStorage.setItem(ACCEPTED_KEY, model); } catch { /* ignore */ }
  }
  enginePromise = (async () => {
    try {
      emitLoad(true, 0, firstRun, "Starting…");
      const mod = (await import(/* @vite-ignore */ WEBLLM_CDN)) as { CreateMLCEngine: (m: string, o?: Record<string, unknown>) => Promise<never> };
      const engine = await mod.CreateMLCEngine(model, {
        initProgressCallback: (r: { text?: string; progress?: number }) => {
          if (r?.text) console.info("[Business Book dev · WebLLM]", r.text);
          emitLoad(true, typeof r?.progress === "number" ? r.progress : 0, firstRun, r?.text ?? "");
        },
      });
      emitLoad(false, 1, firstRun, "Ready");
      return engine;
    } catch (e) {
      enginePromise = null; // don't cache the rejection forever — allow a later retry
      emitLoad(false, 0, firstRun, "Failed");
      throw e;
    }
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
// Streaming variant — emits the accumulated text as tokens arrive (so the UI shows the answer forming
// instead of a long "Thinking…"). WebLLM supports stream:true natively.
async function webllmPromptStream(input: string, opts: PromptArgs | undefined, onToken: (full: string) => void): Promise<string> {
  const engine = await loadEngine();
  const messages: { role: string; content: string }[] = [];
  if (opts?.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: input });
  const stream = (await engine.chat.completions.create({
    messages,
    temperature: opts?.temperature ?? 0.7,
    stream: true,
    ...(opts?.json ? { response_format: { type: "json_object" } } : {}),
  })) as unknown as AsyncIterable<{ choices?: { delta?: { content?: string } }[] }>;
  let acc = "";
  for await (const chunk of stream) {
    const delta = chunk?.choices?.[0]?.delta?.content || "";
    if (delta) { acc += delta; onToken(acc); }
  }
  return acc;
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

// A dev-only forced backend (set from the in-app tier switcher: localStorage "freehold.dev.backend").
// Lets you A/B the tiers in-app instead of juggling flags in the console. Ignored if that backend isn't
// actually available in this browser. In the sealed marketplace the HOST broker owns model selection, so
// this whole shim no-ops there.
function forcedBackend(): string | null {
  try { return localStorage.getItem("freehold.dev.backend"); } catch { return null; }
}
function backendAvailable(b: string): boolean {
  if (b === "webllm") return webgpu();
  if (b === "builtin") return !!builtinFactory();
  if (b === "byok") return !!byokConfig();
  return b === "stub";
}
// The backend that will actually serve a prompt right now (honours the forced override when available).
function activeBackend(): string {
  const forced = forcedBackend();
  if (forced && backendAvailable(forced)) return forced;
  if (webllmEnabled()) return "webllm";
  if (builtinFactory()) return "builtin";
  if (byokConfig()) return "byok";
  return "stub";
}

async function aiHandler(method: string, args: PromptArgs): Promise<unknown> {
  if (method === "availability") {
    const backend = activeBackend();
    const onDevice = backend === "webllm" || backend === "builtin" ? "available" : backend === "stub" ? "unavailable" : "available";
    const contextTokens = backend === "byok" ? 128_000 : backend === "stub" ? 8_192 : backend === "webllm" ? 8_192 : 4_096;
    // Report the ACTIVE model so the app can tell WebLLM-1B from WebLLM-7B (capability is per-MODEL, not
    // per-tier). The real marketplace broker should likewise pass the model it's serving.
    const model = backend === "webllm" ? webllmModel() : backend === "builtin" ? "Gemini Nano" : backend === "byok" ? (byokConfig()?.model || "") : "";
    return { onDevice, byok: !!byokConfig(), willRun: true, backend, contextTokens, model };
  }
  if (method === "prompt") {
    const text = typeof args?.prompt === "string" ? args.prompt : "";
    if (!text.trim()) throw new Error("Empty prompt.");
    // Honour a forced backend (the in-app tier switcher) when it's available — route straight to it.
    const forced = forcedBackend();
    if (forced && backendAvailable(forced)) {
      try {
        if (forced === "webllm") return await webllmPrompt(text, args);
        if (forced === "builtin") return await builtinPrompt(text, args);
        if (forced === "byok") return await byokPrompt(byokConfig()!, text, args);
        if (forced === "stub") return stubPrompt(text, args);
      } catch (e) {
        console.warn("[Business Book dev] forced backend '" + forced + "' failed, falling back:", e);
      }
    }
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
  const w = window as unknown as { freehold?: { request?: unknown }; bb?: unknown };
  if (w.freehold && typeof w.freehold.request === "function") return; // sealed marketplace already provides it

  // Dev-only console helper for flipping models while testing (bb.models(), bb.model('…'), bb.clear(), …).
  // Guarded by import.meta.env.DEV so it's dead-code-eliminated from any production build, and it's only
  // reached here (past the sealed guard) on localhost — so it can NEVER exist in the uploaded/sealed copy.
  if (import.meta.env.DEV && !w.bb) {
    const set = (k: string, v: string) => localStorage.setItem(k, v);
    const del = (k: string) => localStorage.removeItem(k);
    const reload = () => location.reload();
    w.bb = {
      models() {
        const cur = localStorage.getItem("freehold.dev.webllm.model") || DEFAULT_WEBLLM_MODEL;
        console.table(Object.entries(WEBLLM_GB).map(([model, GB]) => ({ model, GB, active: model === cur ? "←" : "" })));
        console.info("bb.model('<id>') switch · bb.clear() clean WebLLM · bb.byok('<key>',{wire,endpoint,model}) · bb.off() no-AI");
        return cur;
      },
      model(id: string) { set("freehold.dev.webllm.model", id); set("freehold.dev.webllm.consented", "1"); set("freehold.dev.webllm", "on"); del("freehold.dev.backend"); reload(); },
      byok(apiKey: string, opts: { wire?: string; endpoint?: string; model?: string } = {}) {
        set("freehold.ai.byok.v1", JSON.stringify({ wire: opts.wire || "openai", endpoint: opts.endpoint || "https://api.openai.com/v1", apiKey, model: opts.model || "gpt-4o" }));
        set("freehold.dev.backend", "byok"); reload();
      },
      off() { set("freehold.dev.webllm", "off"); del("freehold.dev.backend"); del("freehold.ai.byok.v1"); reload(); },
      clear() { ["freehold.ai.byok.v1", "freehold.dev.backend", "freehold.dev.webllm"].forEach(del); reload(); },
    };
    console.info("%c[Business Book dev] bb helper ready — type bb.models()", "color:#1f3b63;font-weight:600");
  }
  w.freehold = Object.freeze({
    capabilities: ["ai", "search", "track"],
    request: (capability: string, method: string, args: PromptArgs) => {
      try {
        if (capability === "ai") return Promise.resolve(aiHandler(method, args));
        if (capability === "search") return Promise.resolve(searchHandler(method, args as { query?: string; name?: string; max?: number }));
        // Demo analytics: the sealed frame hands events here; the REAL Freehold broker validates + forwards
        // them to /api/track (content-free, allowlisted). In dev we just acknowledge — optionally log to see them.
        if (capability === "track") { if (import.meta.env?.DEV) console.debug("[freehold dev] track", (args as unknown as { events?: unknown[] })?.events); return Promise.resolve({ ok: true }); }
        return Promise.reject(new Error("Freehold(dev): capability '" + capability + "' not available"));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    // Streaming prompts (dev): tokens via an onToken callback (same process, so a callback is fine). WebLLM
    // streams natively; other backends resolve once with the full text. In the SEALED marketplace, streaming
    // across the iframe needs an event-based protocol — the host broker's job; the app falls back gracefully.
    requestStream: async (capability: string, method: string, args: PromptArgs, onToken: (full: string) => void): Promise<unknown> => {
      if (capability === "ai" && method === "prompt") {
        const text = typeof args?.prompt === "string" ? args.prompt : "";
        if (!text.trim()) throw new Error("Empty prompt.");
        // Only stream via WebLLM when WebLLM is the ACTIVE backend — otherwise a configured BYOK/Ollama key
        // would be ignored and the (large) prompt would explode WebLLM's 4k context. Keeps routing consistent
        // with aiHandler + the availability badge (all resolve through activeBackend()).
        const wantWebllm = activeBackend() === "webllm";
        if (wantWebllm) {
          try { return await webllmPromptStream(text, args, onToken); }
          catch (e) { console.warn("[Business Book dev · WebLLM stream] failed, falling back:", e); }
        }
        const full = String(await aiHandler("prompt", args));
        onToken(full);
        return full;
      }
      const r = capability === "ai" ? await aiHandler(method, args) : await searchHandler(method, args as { query?: string; name?: string; max?: number });
      onToken(typeof r === "string" ? r : "");
      return r;
    },
  });
}
