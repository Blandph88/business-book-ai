// The "Your day" AI brief at the top of the Dashboard. It narrates a short prioritised brief from the
// SAME deterministic signals the dashboard cards show — This week (agenda), deals near signature
// (hotOpps), reconnect (stale), going-cold opps (aging) — passed in as props, so the AI can never say
// something the cards below contradict. Per-item it drafts a reconnect message on the spot. The model's
// only job is narration/prioritisation; every input is computed by the shared helpers (no re-derivation
// with different thresholds). Auto-generates once per session (cached), with Refresh.

import { useEffect, useRef, useState } from "react";
import type { Contact } from "../data/contacts";
import type { OwnerEdits } from "../storage/ownerEdits";
import type { MeetingRow } from "../data/meetings";
import { opportunityPhase, weightedValue } from "../data/opportunities";
import type { HotOpp, StaleContact, AgingOpp } from "../data/dashboard";
import type { AgendaItem } from "../data/agenda";
import { formatMoney } from "../data/format";
import { useAiAvailable, aiPrompt } from "../ai/ai";
import { yourDayPrompt, draftMessagePrompt } from "../ai/prompts";
import { contactSignalsText } from "../ai/compute";
import { AiSuggest } from "./AiSuggest";
import type { ContactRow } from "../tabs/ContactForm";
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
  edits: Record<string, OwnerEdits>;
  meetingRows: MeetingRow[];
  agenda: AgendaItem[]; // "This week" — dated commitments (same list the dashboard shows)
  hotOpps: HotOpp[]; // "Close these" — biggest deals near signature
  stale: StaleContact[]; // "Reconnect" — warm contacts gone quiet (45d+, unified with the card)
  aging: AgingOpp[]; // "Going cold" — open opps with no movement (30d+)
};

export function YourDay({ today, contacts, edits, meetingRows, agenda, hotOpps, stale, aging }: YourDayProps) {
  const aiReady = useAiAvailable();

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftContact, setDraftContact] = useState<Contact | null>(null);
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
      hotOpps.length ? `Deals near signature:\n${hotOpps.map(({ opp }) => `- ${opp.opportunity_name || opp.organisation || "(unnamed)"} ${formatMoney(weightedValue(opp))} [${opportunityPhase(opp)}]`).join("\n")}` : "",
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
    aiPrompt(yourDayPrompt(ctx))
      .then((t) => {
        if (!alive.current) return;
        setText(t.trim());
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ day: today, sig, text: t.trim() })); } catch { /* ignore */ }
      })
      .catch((e) => { if (alive.current) setError(e instanceof Error ? e.message : "Couldn't build your brief."); })
      .finally(() => { if (alive.current) setBusy(false); });
  }

  // Auto-generate on mount (uses cache so it won't re-call on every Dashboard visit). The dashboard only
  // renders YourDay once its data is ready, so the props are already populated here.
  useEffect(() => {
    if (aiReady && !text && !busy) generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiReady]);

  if (!aiReady) return null;

  const rowFor = (c: Contact): ContactRow => ({ ...c, ...(edits[c.url] || {}) });
  const meetingsFor = (c: Contact) => meetingRows.filter((m) => m.contact_url === c.url);
  const reconnectPeople = stale.slice(0, 6).map((s) => s.contact);

  return (
    <section className="yourday">
      <div className="yourday-head">
        <h3>Your day</h3>
        <button type="button" className="yourday-refresh" disabled={busy} onClick={() => generate(true)}>{busy ? "…" : "Refresh"}</button>
      </div>
      {busy && !text ? (
        <p className="yourday-loading">Putting your brief together…</p>
      ) : error ? (
        <p className="yourday-error">{error}</p>
      ) : (
        <div className="yourday-brief">{text}</div>
      )}

      {reconnectPeople.length > 0 && (
        <div className="yourday-actions">
          <span className="yourday-actions-label">Reconnect:</span>
          {reconnectPeople.map((c) => (
            <button key={c.url} type="button" className="yourday-chip" onClick={() => setDraftContact(c)}>
              Draft → {`${c.first} ${c.last}`.trim()}
            </button>
          ))}
        </div>
      )}

      <p className="yourday-note">AI brief from your own data — on your machine.</p>

      {draftContact && (
        <AiSuggest
          title="Draft a reconnect message"
          subtitle={`To ${`${draftContact.first} ${draftContact.last}`.trim()}`}
          generate={(tweak) => aiPrompt(draftMessagePrompt(rowFor(draftContact), meetingsFor(draftContact), "reconnect", tweak, undefined, contactSignalsText(draftContact)))}
          tweaks={[{ label: "Shorter", instruction: "Make it shorter." }, { label: "Warmer", instruction: "Make it warmer." }]}
          onClose={() => setDraftContact(null)}
        />
      )}
    </section>
  );
}
