// The global "Ask" copilot + search bar (#10 + #12). One box over the whole book:
//   • SEARCH (deterministic, always works): full-text match across contacts, meetings, opportunities
//     and contracts → click a result to jump straight to it.
//   • ASK (AI): a natural-language question → a one-line answer + an optional "Show me" that navigates
//     to the right tab with a filter/search applied.
// Read/query only — no bulk or destructive writes (9a). Opens from the top bar.

import { useEffect, useMemo, useState } from "react";
import { loadContacts, type Contact } from "../data/contacts";
import { loadAllMeetings } from "../storage/meetings";
import { buildMeetingRows, type MeetingRow } from "../data/meetings";
import { loadAllOpportunities, type Opportunity } from "../storage/opportunities";
import { loadAllSows, type Sow } from "../storage/revenue";
import { useAiAvailable, aiJson } from "../ai/ai";
import { nlQueryPrompt, type NlResult } from "../ai/prompts";
import type { Navigate, TabId, TabIntent } from "./TabNav";
import "./CopilotBar.css";

// Only these contact filter keys are safe to apply as a real filter; anything else (seniority,
// sector, company) the model is told to put into `search` instead.
const SAFE_FILTERS = new Set(["messaged", "responded", "agreed", "met"]);
const FILTER_VOCAB =
  "messaged: Yes|No\nresponded: Yes|No\nagreed: Yes|No\nmet: Yes|No\n" +
  "(For anything else — seniority, sector, company, role — put keywords in \"search\", not \"filters\".)";

type Hit = { tab: TabId; id: string; main: string; meta: string };

export function CopilotBar({ onNavigate, onClose }: { onNavigate: Navigate; onClose: () => void }) {
  const aiReady = useAiAvailable();
  const [q, setQ] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [meetingRows, setMeetingRows] = useState<MeetingRow[]>([]);
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [sows, setSows] = useState<Sow[]>([]);
  const [answer, setAnswer] = useState<NlResult | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    const m = loadAllMeetings();
    setOpps(Object.values(loadAllOpportunities()));
    setSows(Object.values(loadAllSows()));
    loadContacts().then((rows) => { setContacts(rows); setMeetingRows(buildMeetingRows(rows, m)); }).catch(() => {});
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Deterministic full-text search across everything (always available, instant).
  const hits = useMemo<Hit[]>(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const has = (...vals: (string | undefined)[]) => {
      const hay = vals.filter(Boolean).join(" ").toLowerCase();
      return terms.every((t) => hay.includes(t));
    };
    const out: Hit[] = [];
    for (const c of contacts) {
      if (out.filter((h) => h.tab === "contacts").length >= 6) break;
      if (has(c.first, c.last, c.organisation, c.position)) out.push({ tab: "contacts", id: c.url, main: `${c.first} ${c.last}`.trim(), meta: [c.position, c.organisation].filter(Boolean).join(" · ") });
    }
    for (const m of meetingRows) {
      if (out.filter((h) => h.tab === "meetings").length >= 4) break;
      if (has(m.contactInfo.name, m.contactInfo.organisation, m.notes, m.purpose)) out.push({ tab: "meetings", id: m.id, main: `${m.contactInfo.name} · #${m.meeting_no}`, meta: m.meeting_stage || "—" });
    }
    for (const o of opps) {
      if (out.filter((h) => h.tab === "opportunities").length >= 4) break;
      if (has(o.opportunity_name, o.organisation, o.description)) out.push({ tab: "opportunities", id: o.id, main: o.opportunity_name || "(unnamed)", meta: o.organisation || "—" });
    }
    for (const s of sows) {
      if (out.filter((h) => h.tab === "revenue").length >= 3) break;
      if (has(s.engagement_name, s.organisation)) out.push({ tab: "revenue", id: s.id, main: s.engagement_name || "(unnamed)", meta: s.organisation || "—" });
    }
    return out;
  }, [q, contacts, meetingRows, opps, sows]);

  async function ask() {
    if (!q.trim() || asking || !aiReady) return;
    setAsking(true);
    setAnswer(null);
    try {
      setAnswer(await aiJson<NlResult>(nlQueryPrompt(q, FILTER_VOCAB)));
    } catch {
      setAnswer({ answer: "Couldn't interpret that — try the search results below." });
    } finally {
      setAsking(false);
    }
  }

  function applyAnswer() {
    if (!answer) return;
    const intent: TabIntent = {};
    if (answer.filters) {
      const entry = Object.entries(answer.filters).find(([k]) => SAFE_FILTERS.has(k));
      if (entry) intent.filter = { key: entry[0], value: entry[1] };
    }
    if (answer.search) intent.search = answer.search;
    onNavigate(answer.tab || "contacts", Object.keys(intent).length ? intent : undefined);
    onClose();
  }

  return (
    <div className="copilot-backdrop" onClick={onClose}>
      <div className="copilot" role="dialog" aria-label="Ask or search" onClick={(e) => e.stopPropagation()}>
        <input
          className="copilot-input"
          autoFocus
          placeholder={aiReady ? "Ask about your book, or search…" : "Search contacts, meetings, opportunities…"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
        />
        {aiReady && (
          <div className="copilot-askrow">
            <button type="button" className="copilot-ask" disabled={!q.trim() || asking} onClick={ask}>{asking ? "Thinking…" : "Ask AI"}</button>
            <span className="copilot-hint">Enter to ask · results update as you type</span>
          </div>
        )}

        {answer && (
          <div className="copilot-answer">
            <p>{answer.answer}</p>
            {(answer.tab || answer.search || answer.filters) && (
              <button type="button" className="copilot-show" onClick={applyAnswer}>Show me →</button>
            )}
          </div>
        )}

        <div className="copilot-results">
          {hits.length === 0 && q.trim() && <p className="copilot-empty">No matches.</p>}
          {hits.map((h) => (
            <button key={h.tab + h.id} type="button" className="copilot-hit" onClick={() => { onNavigate(h.tab, { openId: h.id }); onClose(); }}>
              <span className="copilot-hit-main">{h.main}</span>
              <span className="copilot-hit-meta">{h.tab} · {h.meta}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
