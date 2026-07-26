// The "Your day" AI brief at the top of the Dashboard. It narrates a short prioritised brief from the
// SAME deterministic signals the dashboard cards show — This week (agenda), deals near signature
// (hotOpps), reconnect (stale), going-cold opps (aging) — passed in as props, so the AI can never say
// something the cards below contradict. Per-item it drafts a reconnect message on the spot. The model's
// only job is narration/prioritisation; every input is computed by the shared helpers (no re-derivation
// with different thresholds). Auto-generates once per session (cached), with Refresh.

import { useEffect, useRef, useState } from "react";
import type { Contact } from "../data/contacts";
import { opportunityPhase, weightedValue } from "../data/opportunities";
import type { HotOpp, StaleContact, AgingOpp } from "../data/dashboard";
import type { AgendaItem } from "../data/agenda";
import { formatMoney } from "../data/format";
import { useAiAvailable, aiPromptStream, aiAvailability } from "../ai/ai";
import { explainFailure } from "../ai/health";
import { yourDayPrompt } from "../ai/prompts";
import "./YourDay.css";

const CACHE_KEY = "bob.yourday.v1"; // {day, sig, text} — once per (day + context signature) so tab-switching doesn't re-call, but an import/scan/log that changes the day's signals busts it

// Cheap stable signature of the brief's context — so the cache regenerates when the underlying signals
// change during the day (not just at midnight). djb2; collisions are harmless (worst case a stale reuse).
function ctxSignature(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

type YourDayProps = {
  today: string;
  contacts: Contact[];
  agenda: AgendaItem[]; // "This week" — dated commitments (same list the dashboard shows)
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
const BRIEF_GLYPHS = ["+", "\u2726", "\u2736", "\u2737", "\u2738", "\u2739", "\u273A", "\u2733", "\u2217"];
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

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [genStart, setGenStart] = useState(0);
  const [genTok, setGenTok] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Ignore an in-flight generation that resolves after the Dashboard unmounts (no setState-after-unmount).
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const nm = (c: Contact) => `${c.first} ${c.last}`.trim() + (c.organisation ? ` (${c.organisation})` : "");

  function buildContext(): string {
    const owed = contacts.filter((c) => c.thread && !c.thread.lastFromOwner && c.thread.inboundCount > 0).slice(0, 8);
    const latent = contacts.filter((c) => c.latentOpp?.text).slice(0, 8);
    return [
      `Today: ${today}.`,
      agenda.length ? `This week (overdue + next 7 days):\n${agenda.slice(0, 10).map((a) => `- ${a.what}: ${a.who}${a.org ? ` (${a.org})` : ""} — ${a.statusLabel}, due ${a.date}`).join("\n")}` : "",
      hotOpps.length ? `Deals near signature (probability-weighted values):\n${hotOpps.map(({ opp }) => `- ${opp.opportunity_name || opp.organisation || "(unnamed)"} ${formatMoney(weightedValue(opp))} weighted [${opportunityPhase(opp)}]`).join("\n")}` : "",
      stale.length ? `Warm contacts gone quiet (reconnect):\n${stale.slice(0, 8).map(({ contact: c, daysSince }) => `- ${nm(c)}${daysSince != null ? ` — ${daysSince}d` : ""}`).join("\n")}` : "",
      aging.length ? `Open opportunities stalling:\n${aging.slice(0, 8).map(({ opp, daysSince }) => `- ${opp.opportunity_name || opp.organisation || "(unnamed)"} — ${daysSince}d no movement`).join("\n")}` : "",
      // Enrichment/thread signals — empty until a scan/import provides them, so this degrades gracefully.
      owed.length ? `You owe a reply (they messaged last):\n${owed.map((c) => `- ${nm(c)}${c.thread?.lastDate ? ` since ${c.thread.lastDate}` : ""}`).join("\n")}` : "",
      latent.length ? `Opportunities spotted in your messages:\n${latent.map((c) => `- ${nm(c)}: ${c.latentOpp!.text}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");
  }

  function generate(force = false) {
    if (busy) return;
    const ctx = buildContext();
    // Nothing to narrate (empty / no-signal book) → don't burn a generation or invite invented items.
    // buildContext joins signal sections with newlines; only the "Today: …" line means no signal.
    if (!ctx.includes("\n")) { setText("Nothing pressing today. Add contacts, log a meeting, or run a scan and I'll brief you here."); return; }
    const sig = ctxSignature(ctx);
    if (!force) {
      try {
        const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
        // Reuse only when it's the same day AND the underlying signals are unchanged — otherwise the brief
        // would stay stale after an import/scan/logged meeting added or cleared items in the day's context.
        if (cached && cached.day === today && cached.sig === sig && cached.text) { setText(cached.text); return; }
      } catch { /* ignore */ }
    }
    setBusy(true);
    setError(null);
    setGenStart(Date.now());
    setGenTok(0);
    // STREAMED, stall-bounded, honestly-failing (the copilot's delivery contract, applied here after
    // the live sweep found this surface hanging): the narration STREAMS into the card as it writes
    // (tokens visibly tick), a stall — not honest slowness — trips the bound (60s to first token for
    // cold prompt-processing, 25s of silence mid-stream), and failure is diagnosed from live state.
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
      aiPromptStream(yourDayPrompt(ctx), (full) => {
        if (!alive.current) return;
        acc = full; lastProgress = Date.now();
        setGenTok(approxTokens(full));
        setText(full.trim()); // stream into place — the brief builds up live
      }),
      bound,
    ])
      .then((t) => {
        if (!alive.current) return;
        setText(t.trim());
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ day: today, sig, text: t.trim() })); } catch { /* ignore */ }
      })
      .catch(async (e) => {
        if (!alive.current) return;
        const reason = e instanceof Error && (e.message === "no-first-token" || e.message === "mid-stream-stall") ? e.message : "error";
        const msg = await explainFailure(reason as "no-first-token" | "mid-stream-stall" | "error");
        if (alive.current) { setText(""); setError(msg); }
      })
      .finally(() => { if (timer) clearInterval(timer); if (alive.current) setBusy(false); });
  }

  // Auto-generate on mount (uses cache so it won't re-call on every Dashboard visit). The dashboard only
  // renders YourDay once its data is ready, so the props are already populated here.
  // LOCAL-TIER CALL DIET (Batch 2 S4, deferred item now done): on a local backend (LM Studio/Ollama)
  // the auto-narration contends with the copilot's foreground calls in the server's queue — and the
  // deterministic sections below already carry the full brief. So local tiers don't auto-generate;
  // Refresh still narrates on demand.
  useEffect(() => {
    if (!aiReady || text || busy) return;
    let cancelled = false;
    aiAvailability()
      .then((a) => { if (!cancelled && !(a.local || a.backend === "ollama")) generate(); })
      .catch(() => { /* availability probe failed — keep the deterministic brief */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiReady]);

  // The SAME signals buildContext() feeds the model, rendered as a readable structured brief with NO model.
  // This is what makes the card alive the instant the book is imported (before/without any AI): the model's
  // job was only ever narration/prioritisation, and every input here is already computed deterministically.
  const oppName = (o: { opportunity_name?: string; organisation?: string }) => o.opportunity_name || o.organisation || "(unnamed)";
  function deterministicSections(): { key: string; label: string; lines: string[] }[] {
    const owed = contacts.filter((c) => c.thread && !c.thread.lastFromOwner && c.thread.inboundCount > 0).slice(0, 4);
    const latent = contacts.filter((c) => c.latentOpp?.text).slice(0, 5);
    const secs: { key: string; label: string; lines: string[] }[] = [];
    // NO "This week" section here — the full agenda table renders directly below on the same page,
    // and duplicating it made the brief long and strange (Phil, re-verify item 32).
    if (hotOpps.length) secs.push({ key: "close", label: "Close these — near signature (probability-weighted values)", lines: hotOpps.slice(0, 4).map(({ opp }) => `${oppName(opp)} — ${formatMoney(weightedValue(opp))} weighted [${opportunityPhase(opp)}]`) });
    if (stale.length) secs.push({ key: "reconnect", label: "Reconnect — gone quiet", lines: stale.slice(0, 4).map(({ contact: c, daysSince }) => `${nm(c)}${daysSince != null ? ` — ${daysSince}d quiet` : ""}`) });
    if (aging.length) secs.push({ key: "cold", label: "Going cold — no movement", lines: aging.slice(0, 4).map(({ opp, daysSince }) => `${oppName(opp)} — ${daysSince}d no movement`) });
    if (owed.length) secs.push({ key: "owed", label: "You owe a reply", lines: owed.map((c) => `${nm(c)}${c.thread?.lastDate ? ` — since ${c.thread.lastDate}` : ""}`) });
    if (latent.length) secs.push({ key: "latent", label: "Spotted in your messages", lines: latent.map((c) => `${nm(c)}: ${c.latentOpp!.text}`) });
    return secs;
  }

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
      {text ? (
        // AI narration — streams into place while generating, persists once complete.
        <div className="yourday-brief">{text}</div>
      ) : hasSignal ? (
        // Deterministic brief — always available, no model. Shown instantly on import, and while the AI
        // narration (if AI is on) is still generating or if it fails, so the card is never empty.
        <div className="yourday-sections">
          {sections.map((s) => (
            <div key={s.key} className="yourday-sec">
              <div className="yourday-sec-label">{s.label}</div>
              <ul className="yourday-sec-list">{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </div>
          ))}
          {error && <p className="yourday-error">{error}</p>}
        </div>
      ) : error ? (
        <p className="yourday-error">{error}</p>
      ) : (
        <p className="yourday-loading">Nothing pressing today. Add contacts, log a meeting, or run a scan and I'll brief you here.</p>
      )}

      {/* The per-item reconnect DRAFT needs the model; the reconnect list itself is already in the brief above.
          So the Draft chips only appear when AI is on — otherwise we point to setup in the note below. */}
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
