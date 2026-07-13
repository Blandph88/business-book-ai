// Copilot eval harness. Runs the conversation battery through the REAL pipeline and reports, per turn:
//   • which PATH it took (deterministic keyword-router table  vs  free-form model)
//   • a HIJACK flag when a complex/multi-part instruction was short-circuited into a table
//   • the model's actual response (when GROQ_API_KEY is set)
//
// Two modes:
//   npx tsx scripts/eval/run.mts            → routing analysis only (NO network, NO key needed)
//   GROQ_API_KEY=… npx tsx scripts/eval/run.mts   → also calls the real model for the free-form turns
//
// Writes a pasteable markdown report to eval-output/report.md and prints a summary. The point is SYSTEMIC:
// run the whole battery, read the report, propose ONE batch of scaffolding fixes, verify by re-running.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Papa from "papaparse";

// bookContext/prompts may touch localStorage transitively — stub it so the Node harness doesn't crash.
(globalThis as unknown as { localStorage: object }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

import { computeForQuery, computeText, shouldInterpretResult, privacyResponse } from "../../src/ai/compute.ts";
import { assembleGrounding, conversationPath } from "../../src/ai/grounding.ts";
import { askBookPrompt, interpretResultPrompt, companionPrompt, CRISIS_RESPONSE, suggestionsPrompt } from "../../src/ai/prompts.ts";
import { cleanChips, validateChips } from "../../src/ai/chips.ts";
import { routeIntent, heavyDistress } from "../../src/ai/intents.ts";
import { CONVERSATIONS } from "./conversations.mts";
import { THREADS } from "./threads.mts";
import { MEMORY_THREADS, SEED_MEMORY } from "./memory-threads.mts";
import { CRITICAL_THREADS } from "./critical-threads.mts";
import { CAPABILITY_THREADS } from "./capability-threads.mts";
import { POLISH_THREADS } from "./polish-threads.mts";
import { COMPANION_THREADS } from "./companion-threads.mts";
import { FIFTY_THREADS } from "./fifty-threads.mts";
// EVAL_SET picks the battery: "core" = the wide one/two-turn coverage set; "threads" = the long multi-turn
// conversation set (context back-reference + challenge); "memory" = the memory/source-of-truth + model-weakness
// set (seeds past-chat MEMORY); "critical" = the critical-failure-mode set (numbers/negation/PII/refusal/
// drafting/adversarial); "capability" = the in-depth suite for the compute→interpret combo + relational/
// aggregate tools + guardrails + confidentiality + grounding; "all" (default) = core + threads back to back.
const EVAL_SET = process.env.EVAL_SET;
const SET = EVAL_SET === "core" ? CONVERSATIONS : EVAL_SET === "threads" ? THREADS : EVAL_SET === "memory" ? MEMORY_THREADS : EVAL_SET === "critical" ? CRITICAL_THREADS : EVAL_SET === "capability" ? CAPABILITY_THREADS : EVAL_SET === "polish" ? POLISH_THREADS : EVAL_SET === "companion" ? COMPANION_THREADS : EVAL_SET === "fifty" ? FIFTY_THREADS : [...CONVERSATIONS, ...THREADS];
// On the memory set, inject the seeded past-chat facts as the app's "Memory from past chats" block, so we can
// test whether the model pulls each fact from the RIGHT source (memory vs book vs live context) and never
// confuses or fabricates them. Wording mirrors CopilotBar exactly.
const MEMORY_BLOCK = EVAL_SET === "memory"
  ? `\n\nMemory from past chats (use only if relevant):\n${SEED_MEMORY.map((t) => `- ${t}`).join("\n")}`
  : "";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Load .env.local (GROQ_API_KEY=…) with no dependency, so `npm run eval` works after you drop the key there.
try {
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env.local — use the real environment */ }
const today = process.env.QA_TODAY || new Date().toISOString().slice(0, 10);
// Provider-agnostic: any OpenAI-compatible endpoint (Groq, OpenRouter, Together, Fireworks, OpenAI, a local
// Ollama, …). Set AI_API_KEY + AI_BASE_URL + AI_MODEL in .env.local. Defaults to Groq for convenience.
const AI_KEY = process.env.AI_API_KEY || process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY || "";
const AI_BASE = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const AI_MODEL = process.env.AI_MODEL || process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
// Companion-persona depth to grade: EVAL_LEVEL=small|mid|high (default high — the capable-tier voice). Lets
// us run the SAME companion threads at each tier to check the gradient (tentative→confident direction, etc.).
const COMPANION_LEVEL = (["small", "mid", "high"].includes(process.env.EVAL_LEVEL || "") ? process.env.EVAL_LEVEL : "high") as "small" | "mid" | "high";
const CAPABLE_BUDGET = 6000; // chars of grounding (smaller = faster + stays under free-tier token limits)
// QUIET BY DEFAULT: the full transcript is always written to eval-output/report*.md, so per-turn console
// spew only floods the terminal (and bleeds into the Claude Code TUI). Opt in with VERBOSE=1 / EVAL_VERBOSE=1
// for the live per-turn trace; otherwise we print nothing but the final "report → …" confirmation line.
const VERBOSE = process.env.EVAL_VERBOSE === "1" || process.env.VERBOSE === "1";
const note = (m: string) => { if (VERBOSE) process.stdout.write(m); };
const THROTTLE_MS = Number(process.env.EVAL_THROTTLE_MS || 7000); // pause between model calls to avoid 429s

// ── load the seed book (contacts + meetings + derived opps + sows) ──────────────────────────────────
type AnyRow = Record<string, string>;
const toBool = (v?: string) => /^(true|yes|1|y)$/i.test((v ?? "").trim());
const contactsCsv = readFileSync(join(ROOT, "public/contacts_enriched.csv"), "utf8");
const contacts = (Papa.parse<AnyRow>(contactsCsv, { header: true, skipEmptyLines: true }).data).map((r) => ({
  first: r.first ?? "", last: r.last ?? "", organisation: r.organisation ?? "", position: r.position ?? "",
  seniority: r.seniority ?? "", function: r.function ?? "", sector_group: r.sector_group ?? "", sector_detail: r.sector_detail ?? "",
  sub_group: r.sub_group ?? "", phone: r.phone ?? "", messaged: toBool(r.messaged), responded: toBool(r.responded),
  two_way: toBool(r.two_way), agreed_to_meet: toBool(r.agreed_to_meet), met: false, url: r.url ?? "",
})) as any[];
const byUrl = new Map(contacts.map((c) => [c.url, c]));
const seedMeetings = JSON.parse(readFileSync(join(ROOT, "public/seed_meetings.json"), "utf8")) as AnyRow[];
const meetingRows = seedMeetings.map((m) => {
  const c = byUrl.get(m.contact_url as string);
  return { ...m, id: `${m.contact_url}#${m.meeting_no}`, contactInfo: { name: c ? `${c.first} ${c.last}`.trim() : "(unknown)", organisation: c?.organisation ?? "—" } };
}) as any[];
for (const m of meetingRows) if (m.meeting_stage === "Held") { const c = byUrl.get(m.contact_url); if (c) c.met = true; }
const opps = seedMeetings.filter((m) => (m as any).opportunity).map((m, i) => {
  const op = (m as any).opportunity; const c = byUrl.get(m.contact_url as string);
  return { id: `opp:seed-${i}`, opportunity_name: op.opportunity_name, organisation: c?.organisation ?? "—", primary_contact: c ? `${c.first} ${c.last}`.trim() : "", service_line: op.service_line, current_step: op.step || "meeting", est_value: op.est_value, probability: op.probability, lost: !!op.lost, contact_url: m.contact_url };
}) as any[];
let sows: any[] = [];
try { sows = (JSON.parse(readFileSync(join(ROOT, "public/seed_extras.json"), "utf8")).sows ?? []) as any[]; } catch { /* none */ }
const data = { contacts, meetingRows, opps, sows } as any;

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────
// Heuristic: is this a complex/reasoning instruction that the keyword router should NOT have hijacked?
function looksComplex(t: string): boolean {
  const s = t.trim();
  if (s.length > 140) return true;
  if ((s.match(/\?/g) || []).length >= 2) return true;
  if (/\b(analy[sz]e|strategy|prepare|develop a|assessment|contrarian|parse every|do a few things|explain what|step by step)\b/i.test(s)) return true;
  if (/\b\w+\b.*\band\b.*\band\b/i.test(s)) return true; // 2+ conjoined asks
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function callModel(system: string, prompt: string): Promise<string> {
  if (!AI_KEY) return "(model skipped — set AI_API_KEY / AI_BASE_URL / AI_MODEL in .env.local to capture real responses)";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${AI_BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_KEY}` },
        body: JSON.stringify({ model: AI_MODEL, temperature: 0.5, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
      });
      if (res.status === 429) {
        // Rate-limited. A SHORT cooldown → wait + retry. A LONG one (the free tier's per-day/long window is
        // spent) → don't hang for minutes; mark this turn and move on so the run still completes.
        const retryAfter = Number(res.headers.get("retry-after")) * 1000;
        if (retryAfter > 90_000) return `(rate-limited ${Math.round(retryAfter / 1000)}s — free-tier cooldown spent; switch to OpenRouter or a paid tier, or wait and re-run)`;
        const wait = Math.min(retryAfter || (8000 * (attempt + 1)), 45_000);
        note(`  · rate-limited, waiting ${Math.round(wait / 1000)}s…\n`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) return `(model error HTTP ${res.status}: ${(await res.text()).slice(0, 200)})`;
      const j = await res.json() as any;
      return (j.choices?.[0]?.message?.content ?? "(empty)").trim();
    } catch (e) { if (attempt === 3) return `(model call failed: ${e instanceof Error ? e.message : String(e)})`; await sleep(4000); }
  }
  return "(model gave up after repeated rate-limits — try OpenRouter or a paid tier for the full run)";
}

// ── run ───────────────────────────────────────────────────────────────────────────────────────────
const isGenerate = (t: string) => /^\s*(draft|write|compose|prepare|prep|send|email|message|reply|respond)\b/i.test(t);
const lines: string[] = [];
let hijacks = 0, deterministic = 0, modelTurns = 0, actionTurns = 0, turns = 0;
let chipTurns = 0, chipDrops = 0, chipEmpty = 0; // chip pass: turns graded, chips dropped as off-book, answers left with no valid chip

note(`\nEval harness · ${today} · model=${AI_KEY ? AI_MODEL : "(routing-only, no key)"} · ${contacts.length} contacts, ${sows.length} engagements\n`);
lines.push(`# Copilot eval — ${today}`, `model: ${AI_KEY ? AI_MODEL : "(routing-only)"} · ${contacts.length} contacts · ${opps.length} opps · ${sows.length} engagements`, "");

// EVAL_LIMIT=N runs only the first N conversations (handy to fit a free-tier rate budget).
const LIMIT = Number(process.env.EVAL_LIMIT) || SET.length;
for (const convo of SET.slice(0, LIMIT)) {
  lines.push(`\n## ${convo.name}${convo.note ? `\n_${convo.note}_` : ""}`);
  const history: { role: "you" | "ai"; text: string }[] = [];
  for (const text of convo.turns) {
    turns++;
    const intent = routeIntent(text);
    let path: string, response: string;
    // Actions (create/update) open a propose→confirm card in the real app — they never run computeForQuery.
    const isAction = intent.kind === "create" || intent.kind === "update";
    const prevText = [...history].reverse().find((h) => h.role === "you")?.text;
    // Privacy questions answer deterministically from the backend (no live backend in the harness → the
    // general, still-accurate answer); otherwise the keyword router. Both are the "deterministic" path.
    const computed = (!isAction && !isGenerate(text)) ? (privacyResponse(text) || computeForQuery(text, data, today, prevText)) : null;
    if (isAction) {
      actionTurns++;
      path = `action (${intent.kind} ${intent.entity ?? ""})`.trim();
      response = `(opens a propose→confirm card to ${intent.kind} a ${intent.entity}${intent.target ? ` — “${intent.target}”` : ""})`;
      history.push({ role: "you", text }, { role: "ai", text: response });
    } else if (computed) {
      deterministic++;
      const hijack = looksComplex(text);
      if (hijack) hijacks++;
      path = `deterministic-table${hijack ? "  ⚠️ HIJACK SUSPECT (complex prompt short-circuited)" : ""}`;
      const tableText = computeText(computed);
      response = tableText.split("\n").slice(0, 6).join("\n") + (tableText.split("\n").length > 6 ? "\n…(table truncated in report)" : "");
      // compute→interpret combo: on a capable tier the app streams an LLM read of the computed table below
      // it. Grade that here too — the table is ground truth, the interpretation is what the consultant sees.
      let aiText = tableText;
      if (AI_KEY && shouldInterpretResult(text, computed)) {
        const { system, prompt } = interpretResultPrompt(text, tableText);
        const interp = await callModel(system!, prompt);
        response += `\n\n**+ INTERPRETATION (model):**\n\n${interp}`;
        aiText = `${tableText}\n\n${interp}`;
        await sleep(THROTTLE_MS);
      }
      history.push({ role: "you", text }, { role: "ai", text: aiText });
    } else {
      modelTurns++;
      // TOPIC-GATE: a turn that isn't a book tool → crisis (deterministic safety floor), a personal/general
      // conversation (the warm COMPANION — no book injected), or a grounded question/advice about the book.
      // Stickiness: if the prior user turn was companion, a stray book-entity mention stays in the thread.
      const prevUserText = [...history].reverse().find((h) => h.role === "you")?.text || "";
      const prevCompanion = !!prevUserText && conversationPath(prevUserText, data) === "companion";
      const cpath = conversationPath(text, data, prevCompanion);
      if (cpath === "crisis") {
        response = CRISIS_RESPONSE;
        path = "crisis (deterministic safety floor)";
        history.push({ role: "you", text }, { role: "ai", text: response });
      } else if (cpath === "companion") {
        const heavy = heavyDistress(text);
        const { system, prompt } = companionPrompt(text, history.slice(-8), COMPANION_LEVEL, { heavy });
        response = await callModel(system!, prompt);
        path = `companion (model · ${COMPANION_LEVEL}${heavy ? " · heavy" : ""})`;
        history.push({ role: "you", text }, { role: "ai", text: response });
        if (AI_KEY) await new Promise((r) => setTimeout(r, THROTTLE_MS));
      } else {
        // Recent context (last 2 turns) so entity resolution carries the person named earlier in the thread.
        const convo = history.slice(-2).map((h) => h.text).join("\n");
        const grounding = assembleGrounding(text, data, CAPABLE_BUDGET, today, convo) + MEMORY_BLOCK;
        const { system, prompt } = askBookPrompt(text, grounding, history, "", false);
        response = await callModel(system!, prompt);
        path = "model (free-form)";
        history.push({ role: "you", text }, { role: "ai", text: response });
        if (AI_KEY) await new Promise((r) => setTimeout(r, THROTTLE_MS)); // throttle to stay under rate limits
        // CHIP PASS: generate the "what next?" chips exactly as the app does (the separate suggestions
        // round-trip), then run the REAL cleaning + validation so hallucinated / echoing / off-book chips
        // surface HERE instead of in a demo. Appended to the turn's report block; tallied in the summary.
        if (AI_KEY) {
          const sp = suggestionsPrompt(text, response, grounding);
          const rawChipText = await callModel(sp.system || "", sp.prompt);
          await sleep(THROTTLE_MS);
          let parsed: unknown = [];
          try { const m = rawChipText.match(/\[[\s\S]*\]/); parsed = m ? JSON.parse(m[0]) : JSON.parse(rawChipText); } catch { parsed = []; }
          const cleaned = cleanChips(parsed, text);
          const valid = validateChips(cleaned, response, data);
          const dropped = cleaned.filter((c) => !valid.includes(c));
          chipTurns++;
          chipDrops += dropped.length;
          if (!valid.length) chipEmpty++;
          const chipLines = [
            `\n**CHIPS:** ${valid.length}/${cleaned.length} kept` + (dropped.length ? ` · ${dropped.length} DROPPED (off-book/hallucinated)` : "") + (cleaned.length && !valid.length ? " · ⚠️ NONE SURVIVED" : "") + (!cleaned.length ? " · (model produced none)" : ""),
            ...valid.map((c) => `  ✓ ${c.label}  →  "${c.prompt}"`),
            ...dropped.map((c) => `  ✗ ${c.label}  →  "${c.prompt}"`),
          ];
          response += "\n" + chipLines.join("\n");
        }
      }
    }
    lines.push(`\n**USER:** ${text}`, `**PATH:** ${path}`, `**RESPONSE:**\n\n${response}\n`);
    note(`  [${path.startsWith("deterministic") ? "DET" : path.startsWith("action") ? "ACT" : "MODEL"}${path.includes("HIJACK") ? " ⚠️HIJACK" : ""}] ${convo.name}: ${text.slice(0, 70)}…\n`);
  }
}

lines.push(`\n---\n## Summary\n- turns: ${turns}\n- deterministic: ${deterministic} (hijack suspects: ${hijacks})\n- actions: ${actionTurns}\n- model turns: ${modelTurns}\n- chip pass: ${chipTurns} graded · ${chipDrops} chips dropped (off-book/hallucinated) · ${chipEmpty} answers left with no valid chip`);
mkdirSync(join(ROOT, "eval-output"), { recursive: true });
// Write a per-set file so runs of different sets don't clobber each other (report-critical.md,
// report-core.md, …), plus report.md as a "latest run" copy for anything that reads the fixed name.
const SET_NAME = EVAL_SET || "all";
const report = lines.join("\n");
writeFileSync(join(ROOT, `eval-output/report-${SET_NAME}.md`), report);
writeFileSync(join(ROOT, "eval-output/report.md"), report);
console.log(`\n${hijacks} hijack suspect(s) of ${deterministic} deterministic turns · ${modelTurns} model turns · chips: ${chipDrops} dropped / ${chipEmpty} empty of ${chipTurns} graded · report → eval-output/report-${SET_NAME}.md (+ report.md)\n`);
