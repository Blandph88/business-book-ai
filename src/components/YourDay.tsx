// The "Your day" AI brief that sits at the top of the Dashboard (#7). It pulls together what's
// happening across the book today — upcoming/overdue meetings, deals near signature, who's gone
// cold, who to reconnect with — and asks the model for a short prioritised brief. Per-item it lets
// you draft a reconnect message on the spot (#3b). It's a SEPARATE panel for now (3a) — the
// deterministic dashboard below is untouched. Auto-generates once per session (cached), with Refresh.

import { useEffect, useMemo, useState } from "react";
import { loadContacts, type Contact } from "../data/contacts";
import { loadAllEdits, type OwnerEdits } from "../storage/ownerEdits";
import { loadAllMeetings } from "../storage/meetings";
import { buildMeetingRows, type MeetingRow } from "../data/meetings";
import { loadAllOpportunities, type Opportunity } from "../storage/opportunities";
import { opportunityStatus, opportunityPhase, weightedValue } from "../data/opportunities";
import { formatMoney } from "../data/format";
import { todayISO } from "../data/agenda";
import { useAiAvailable, aiPrompt } from "../ai/ai";
import { yourDayPrompt, draftMessagePrompt } from "../ai/prompts";
import { AiSuggest } from "./AiSuggest";
import type { ContactRow } from "../tabs/ContactForm";
import "./YourDay.css";

const CACHE_KEY = "bob.yourday.v1"; // {day, text} — once per session/day so tab-switching doesn't re-call

function daysSince(iso: string, today: string): number {
  return Math.round((new Date(`${today}T00:00:00`).getTime() - new Date(`${iso}T00:00:00`).getTime()) / 86_400_000);
}

export function YourDay() {
  const aiReady = useAiAvailable();
  const today = useMemo(() => todayISO(), []);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [edits, setEdits] = useState<Record<string, OwnerEdits>>({});
  const [meetingRows, setMeetingRows] = useState<MeetingRow[]>([]);
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftContact, setDraftContact] = useState<Contact | null>(null);

  useEffect(() => {
    const savedMeetings = loadAllMeetings();
    setEdits(loadAllEdits());
    setOpps(Object.values(loadAllOpportunities()));
    loadContacts()
      .then((rows) => {
        setContacts(rows);
        setMeetingRows(buildMeetingRows(rows, savedMeetings));
      })
      .catch(() => setContacts([]))
      .finally(() => setLoaded(true));
  }, []);

  // Most-recent held date per contact, for the reconnect list.
  const lastMet = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of meetingRows) {
      if (!r.date_held) continue;
      const cur = m.get(r.contact_url);
      if (!cur || r.date_held > cur) m.set(r.contact_url, r.date_held);
    }
    return m;
  }, [meetingRows]);

  const closeThese = useMemo(
    () => opps.filter((o) => opportunityStatus(o) === "Open" && (opportunityPhase(o) === "Contract" || opportunityPhase(o) === "Propose")).slice(0, 5),
    [opps],
  );
  const goingCold = useMemo(() => contacts.filter((c) => c.messaged && !c.two_way).slice(0, 6), [contacts]);
  const reconnect = useMemo(
    () => contacts.filter((c) => { const lm = lastMet.get(c.url); return lm && daysSince(lm, today) > 90; }).slice(0, 5),
    [contacts, lastMet, today],
  );
  const upcoming = useMemo(
    () => meetingRows.filter((m) => m.meeting_stage === "Scheduled" && m.date_scheduled && m.date_scheduled >= today).sort((a, b) => (a.date_scheduled! < b.date_scheduled! ? -1 : 1)).slice(0, 6),
    [meetingRows, today],
  );
  const overdue = useMemo(
    () => meetingRows.filter((m) => (m.meeting_stage === "Scheduled" && m.date_scheduled && m.date_scheduled < today) || (m.followup_date && m.followup_date < today)).slice(0, 6),
    [meetingRows, today],
  );

  function buildContext(): string {
    const nm = (c: Contact) => `${c.first} ${c.last}`.trim() + (c.organisation ? ` (${c.organisation})` : "");
    return [
      `Today: ${today}.`,
      upcoming.length ? `Upcoming meetings:\n${upcoming.map((m) => `- ${m.contactInfo.name} on ${m.date_scheduled}`).join("\n")}` : "",
      overdue.length ? `Overdue / slipping:\n${overdue.map((m) => `- ${m.contactInfo.name} (${m.meeting_stage})`).join("\n")}` : "",
      closeThese.length ? `Deals near signature:\n${closeThese.map((o) => `- ${o.opportunity_name || "(unnamed)"} ${formatMoney(weightedValue(o))} [${opportunityPhase(o)}]`).join("\n")}` : "",
      goingCold.length ? `Messaged, no reply yet:\n${goingCold.map((c) => `- ${nm(c)}`).join("\n")}` : "",
      reconnect.length ? `Not met in 90+ days:\n${reconnect.map((c) => `- ${nm(c)}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");
  }

  function generate(force = false) {
    if (busy) return;
    if (!force) {
      try {
        const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
        if (cached && cached.day === today && cached.text) { setText(cached.text); return; }
      } catch { /* ignore */ }
    }
    setBusy(true);
    setError(null);
    aiPrompt(yourDayPrompt(buildContext()))
      .then((t) => {
        setText(t.trim());
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ day: today, text: t.trim() })); } catch { /* ignore */ }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't build your brief."))
      .finally(() => setBusy(false));
  }

  // Auto-generate once data is loaded (uses cache so it won't re-call on every Dashboard visit).
  useEffect(() => {
    if (aiReady && loaded && !text && !busy) generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiReady, loaded]);

  if (!aiReady || !loaded) return null;

  const rowFor = (c: Contact): ContactRow => ({ ...c, ...(edits[c.url] || {}) });
  const meetingsFor = (c: Contact) => meetingRows.filter((m) => m.contact_url === c.url);

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

      {reconnect.length > 0 && (
        <div className="yourday-actions">
          <span className="yourday-actions-label">Reconnect:</span>
          {reconnect.map((c) => (
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
          generate={(tweak) => aiPrompt(draftMessagePrompt(rowFor(draftContact), meetingsFor(draftContact), "reconnect", tweak))}
          tweaks={[{ label: "Shorter", instruction: "Make it shorter." }, { label: "Warmer", instruction: "Make it warmer." }]}
          onClose={() => setDraftContact(null)}
        />
      )}
    </section>
  );
}
