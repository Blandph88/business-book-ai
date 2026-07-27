// The "Your day" AI brief at the top of the Dashboard. It narrates the SAME deterministic signals the
// dashboard cards show — deals near signature (hotOpps), reconnect (stale), going-cold opps (aging),
// owed replies, latent opportunities — passed in as props, so the AI can never say something the cards
// below contradict. The AI's job is a per-SECTION rewrite (Phil's design, 2026-07-27): each header
// keeps its place, the lines beneath it shimmer while regenerating, and the model's prioritised read
// of THAT section streams in under its own header — never a flat blob replacing the structure.
// Auto-generates once per session on non-local tiers (cached); Refresh narrates on demand everywhere.

import { useEffect, useRef, useState } from "react";
import type { Contact } from "../data/contacts";
import { opportunityPhase, weightedValue } from "../data/opportunities";
import type { HotOpp, StaleContact, AgingOpp } from "../data/dashboard";
import type { AgendaItem } from "../data/agenda";
import { formatMoney } from "../data/format";
import { useAiAvailable, aiPromptStream } from "../ai/ai";
import { explainFailure } from "../ai/health";
import { yourDayPrompt } from "../ai/prompts";
import "./YourDay.css";

const CACHE_KEY = "bob.yourday.v2"; // {day, sig, secs:{key:text}} — per (day + signals signature); v2 = sectioned brief

// Cheap stable signature of the brief's context — so the cache regenerates when the underlying signals
// change during the day (not just at midnight). djb2; collisions are harmless (worst case a stale reuse).
function ctxSignature(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

type Section = { key: string; label: string; lines: string[] };

// Parse the model's sectioned output (## <label> markers, one per section we asked for) into
// key→body. Tolerant: unmatched headers are ignored; a missing section simply keeps its
// deterministic lines. Called on every stream tick, so sections fill in as they complete.
export function parseSectionedBrief(full: string, sections: Section[]): Record<string, string> {
  const out: Record<string, string> = {};
  const byLabel = new Map(sections.map((s) => [s.label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), s.key]));
  const parts = full.split(/^#{2,3}\s*/m).slice(1); // text before the first header is preamble — dropped
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const header = (nl >= 0 ? part.slice(0, nl) : part).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const body = nl >= 0 ? part.slice(nl + 1).trim() : "";
    // Match on the header's leading words — the model may shorten a long label.
    let key = byLabel.get(header);
    if (!key) for (const [lbl, k] of byLabel) { if (lbl.startsWith(header) || header.startsWith(lbl.split(" ").slice(0, 3).join(" "))) { key = k; break; } }
    if (key && body) out[key] = body;
  }
  return out;
}

type YourDayProps = {
  today: string;
  contacts: Contact[];
  agenda: AgendaItem[]; // dated commitments (the full table renders below on the same page)
  hotOpps: HotOpp[]; // "Close these" — biggest deals near signature
  stale: StaleContact[]; // "Reconnect" — warm contacts gone quiet (45d+, unified with the card)
  aging: AgingOpp[]; // "Going cold" — open opps with no movement (30d+)
  // Deep-link a draft request into the COPILOT (Phil's call, 2026-07-26): one AI pipeline — the
  // hardened chat surface — instead of a second modal duplicating budgets/indicators/failure states.
  onDraft: (prompt: string) => void;
};

const approxTokens = (s: string) => Math.max(1, Math.round((s || "").length / 4));

// The copilot's delivery indicator, miniaturised: a cycling glyph (visibly alive), a staged label,
// live seconds and a ~token count once the narration starts streaming.
const BRIEF_GLYPHS = ["+", "✦", "✶", "✷", "✸", "✹", "✺", "✳", "∗"];
function BriefIndicator({ startMs, tokens }: { startMs: number; tokens: number }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 420);
    return () => clearInterval(t);
  }, []);
  const secs = startMs ? Math.max(0, Math.floor((Date.now() - startMs) / 1000)) : 0;
  const word = tokens > 0 ? "Writing your brief" : secs >= 8 ? "Reading your book's context — slow on local hardware" : "Sharpening your brief";
  return (
    <p className="yourday-loading">
      <span className="thinking-glyph" key={tick % BRIEF_GLYPHS.length}>{BRIEF_GLYPHS[tick % BRIEF_GLYPHS.length]}</span>
      <span>{word}…</span>
      {secs > 0 && <span className="yourday-loading-meta">· {secs}s{tokens > 0 ? ` · ~${tokens} tok` : ""}</span>}
    </p>
  );
}

export function YourDay({ today, contacts, agenda, hotOpps, stale, aging, onDraft }: YourDayProps) {
  const aiReady = useAiAvailable();
  void agenda; // the agenda renders as its own table below — deliberately not narrated here

  // key→AI text for each section; null = no narration yet (deterministic lines show instead).
  const [secTexts, setSecTexts] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [genStart, setGenStart] = useState(0);
  const [genTok, setGenTok] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [quiet, setQuiet] = useState(false); // empty book — nothing to narrate
  // A short shimmer over the DATA lines on Refresh: they recompute live on every render anyway, but
  // the button says Refresh, so the whole card visibly re-runs (Phil's call) — lines sweep ~0.8s and
  // reappear freshly derived; the AI takes keep shimmering until their stream fills.
  const [sweep, setSweep] = useState(false);
  // Ignore an in-flight generation that resolves after the Dashboard unmounts (no setState-after-unmount).
  const alive = useRef(true);
  // StrictMode-safe: the body RE-ARMS the flag on every (re)mount — the cleanup-only version left
  // alive=false after StrictMode's simulated remount, so results/errors/busy-clears were silently
  // discarded and every generation on this surface looked like an infinite stall (the 475s hang).
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const nm = (c: Contact) => `${c.first} ${c.last}`.trim() + (c.organisation ? ` (${c.organisation})` : "");

  // The deterministic sections — the card's always-available content AND the model's exact input, so
  // the narration can only rewrite what's really there (no re-derivation with different thresholds).
  const oppName = (o: { opportunity_name?: string; organisation?: string }) => o.opportunity_name || o.organisation || "(unnamed)";
  function deterministicSections(): Section[] {
    const owed = contacts.filter((c) => c.thread && !c.thread.lastFromOwner && c.thread.inboundCount > 0).slice(0, 4);
    const latent = contacts.filter((c) => c.latentOpp?.text).slice(0, 5);
    const secs: Section[] = [];
    // NO "This week" section here — the full agenda table renders directly below on the same page,
    // and duplicating it made the brief long and strange (Phil, re-verify item 32).
    if (hotOpps.length) secs.push({ key: "close", label: "Close these — near signature (probability-weighted values)", lines: hotOpps.slice(0, 4).map(({ opp }) => `${oppName(opp)} — ${formatMoney(weightedValue(opp))} weighted [${opportunityPhase(opp)}]`) });
    if (stale.length) secs.push({ key: "reconnect", label: "Reconnect — gone quiet", lines: stale.slice(0, 4).map(({ contact: c, daysSince }) => `${nm(c)}${daysSince != null ? ` — ${daysSince}d quiet` : ""}`) });
    if (aging.length) secs.push({ key: "cold", label: "Going cold — no movement", lines: aging.slice(0, 4).map(({ opp, daysSince }) => `${oppName(opp)} — ${daysSince}d no movement`) });
    if (owed.length) secs.push({ key: "owed", label: "You owe a reply", lines: owed.map((c) => `${nm(c)}${c.thread?.lastDate ? ` — since ${c.thread.lastDate}` : ""}`) });
    if (latent.length) secs.push({ key: "latent", label: "Spotted in your messages", lines: latent.map((c) => `${nm(c)}: ${c.latentOpp!.text}`) });
    return secs;
  }

  function generate(force = false) {
    if (busy) return;
    const secs = deterministicSections();
    if (!secs.length) { setQuiet(true); return; }
    const ctx = secs.map((s) => `## ${s.label}\n${s.lines.map((l) => `- ${l}`).join("\n")}`).join("\n\n");
    const sig = ctxSignature(ctx);
    if (!force) {
      try {
        const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
        // Reuse only when it's the same day AND the underlying signals are unchanged — otherwise the brief
        // would stay stale after an import/scan/logged meeting added or cleared items in the day's context.
        if (cached && cached.day === today && cached.sig === sig && cached.secs) { setSecTexts(cached.secs); return; }
      } catch { /* ignore */ }
    }
    setBusy(true);
    setError(null);
    setSecTexts(null); // shimmer panels take over under each header
    if (force) { setSweep(true); setTimeout(() => { if (alive.current) setSweep(false); }, 800); }
    setGenStart(Date.now());
    setGenTok(0);
    // STREAMED, stall-bounded, honestly-failing (the copilot's delivery contract): each section's
    // narration fills its own panel as the stream reaches it; a stall — not honest slowness — trips
    // the bound (60s to first token for cold prompt-processing, 25s of silence mid-stream).
    let acc = "";
    let lastProgress = Date.now();
    let timer: ReturnType<typeof setInterval> | undefined;
    const bound = new Promise<never>((_, rej) => {
      timer = setInterval(() => {
        const grace = acc ? 25_000 : 60_000;
        if (Date.now() - lastProgress > grace) rej(new Error(acc ? "mid-stream-stall" : "no-first-token"));
      }, 1_000);
    });
    Promise.race([
      aiPromptStream(yourDayPrompt(ctx, today), (full) => {
        if (!alive.current) return;
        acc = full; lastProgress = Date.now();
        setGenTok(approxTokens(full));
        setSecTexts(parseSectionedBrief(full, secs)); // sections fill in place as they complete
      }),
      bound,
    ])
      .then((t) => {
        if (!alive.current) return;
        const parsed = parseSectionedBrief(t, secs);
        setSecTexts(Object.keys(parsed).length ? parsed : null); // unparseable → deterministic lines stand
        if (Object.keys(parsed).length) {
          try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ day: today, sig, secs: parsed })); } catch { /* ignore */ }
        }
      })
      .catch(async (e) => {
        if (!alive.current) return;
        const reason = e instanceof Error && (e.message === "no-first-token" || e.message === "mid-stream-stall") ? e.message : "error";
        const msg = await explainFailure(reason as "no-first-token" | "mid-stream-stall" | "error");
        if (alive.current) { setSecTexts(null); setError(msg); }
      })
      .finally(() => { if (timer) clearInterval(timer); if (alive.current) setBusy(false); });
  }

  // Auto-generate on mount, EVERY tier (Phil's call, 2026-07-27): the takes should already be there
  // the first time the dashboard opens — Refresh is the manual re-run, not the only way in. The old
  // local-tier skip (Batch 2 call diet) predates the cache-per-day, true streaming, real watchdogs
  // and the StrictMode fix; with those, one auto-narration per day is affordable on LM Studio too.
  // The day-cache means tab-switching never re-calls; a same-day signal change regenerates once.
  useEffect(() => {
    if (!aiReady || secTexts || busy) return;
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiReady]);

  // Chips mirror EXACTLY the names the Reconnect section shows (both capped at 4) — the live run
  // had two chip-only names that appeared nowhere above them.
  const reconnectPeople = stale.slice(0, 4).map((s) => s.contact);
  const sections = deterministicSections();
  const hasSignal = sections.length > 0;

  return (
    <section className="yourday">
      <div className="yourday-head">
        <h3>Your day</h3>
        {aiReady && <button type="button" className="yourday-refresh" disabled={busy} onClick={() => generate(true)}>{busy ? "…" : "Refresh"}</button>}
      </div>
      {busy && <BriefIndicator startMs={genStart} tokens={genTok} />}
      {hasSignal ? (
        // ONE structure, always (Phil's consistency call, 2026-07-27): header → AI take slot → the
        // deterministic data lines. The lines are FACTS and never vanish; the take is the model's
        // one-sentence read, shimmering while it regenerates and filling in place as the stream
        // reaches its section. Pre-refresh and post-refresh render identically.
        <div className="yourday-sections">
          {sections.map((s) => {
            const ai = secTexts?.[s.key];
            return (
              <div key={s.key} className="yourday-sec">
                <div className="yourday-sec-label">{s.label}</div>
                {ai ? (
                  <div className="yourday-sec-take">{ai}</div>
                ) : busy ? (
                  <div className="yourday-skel yourday-skel--take" aria-label="Writing this section's read…">
                    <span className="yourday-skel-bar yourday-skel-bar--short" />
                  </div>
                ) : null}
                {sweep ? (
                  <div className="yourday-skel" aria-label="Re-checking…">
                    <span className="yourday-skel-bar" />
                    <span className="yourday-skel-bar yourday-skel-bar--short" />
                  </div>
                ) : (
                  <ul className="yourday-sec-list">{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                )}
              </div>
            );
          })}
          {error && <p className="yourday-error">{error}</p>}
        </div>
      ) : error ? (
        <p className="yourday-error">{error}</p>
      ) : quiet || !hasSignal ? (
        <p className="yourday-quiet">Nothing pressing today. Add contacts, log a meeting, or run a scan and I'll brief you here.</p>
      ) : null}

      {/* Reconnect draft chips deep-link into the copilot. The data lines stay visible during a
          regenerate, so the chips stay clickable too — nothing on the card ever blanks out. */}
      {aiReady && reconnectPeople.length > 0 && (
        <div className="yourday-actions">
          <span className="yourday-actions-label">Reconnect:</span>
          {reconnectPeople.map((c) => (
            <button key={c.url} type="button" className="yourday-chip" onClick={() => onDraft(`Draft a reconnect message to ${`${c.first} ${c.last}`.trim()}`)}>
              Draft → {`${c.first} ${c.last}`.trim()}
            </button>
          ))}
        </div>
      )}

      <p className="yourday-note">
        {aiReady
          ? "Brief from your own data — on your machine."
          : "Turn on the assistant in your Freehold AI settings for a narrated brief + one-tap reconnect drafts. Everything here already works without it."}
      </p>

    </section>
  );
}
