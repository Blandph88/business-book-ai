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
import { useAiAvailable, useSearchAvailable, aiJson, searchWeb, type WebResult } from "../ai/ai";
import { nlQueryPrompt, type NlResult } from "../ai/prompts";
import type { Navigate, TabId, TabIntent } from "./TabNav";
import "./CopilotBar.css";

// Only these contact filter keys are safe to apply as a real filter; anything else (seniority,
// sector, company) the model is told to put into `search` instead.
const SAFE_FILTERS = new Set(["messaged", "responded", "agreed", "met"]);
const FILTER_VOCAB =
  "messaged: Yes|No\nresponded: Yes|No\nagreed: Yes|No\nmet: Yes|No\n" +
  "(For anything else — seniority, sector, company, role — put keywords in \"search\", not \"filters\".)";

type Hit = { id: string; main: string; meta: string };
type Company = { org: string; count: number };
type Groups = { people: Hit[]; companies: Company[]; meetings: Hit[]; opps: Hit[]; contracts: Hit[]; empty: boolean };

export function CopilotBar({ onNavigate, onOpenAccount, onClose }: { onNavigate: Navigate; onOpenAccount?: (org: string) => void; onClose: () => void }) {
  const aiReady = useAiAvailable();
  const searchReady = useSearchAvailable();
  const [q, setQ] = useState("");
  const [web, setWeb] = useState<WebResult[] | null>(null);
  const [webBusy, setWebBusy] = useState(false);
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

  // Deterministic full-text search, grouped so PEOPLE (matched by name) and COMPANIES (matched by
  // organisation) are clearly separate — plus meetings, opportunities and contracts.
  const groups = useMemo<Groups | null>(() => {
    // Same word-prefix matching as the tab search (see tableControls.ts): "EY" matches EY, not Foley.
    const tokenize = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const qTokens = tokenize(q);
    if (!qTokens.length) return null;
    const m = (s: string) => { const hay = tokenize(s); return qTokens.every((qt) => hay.some((ht) => ht.startsWith(qt))); };

    // People — matched by their own name (or title), NOT by where they work.
    const people: Hit[] = [];
    for (const c of contacts) {
      if (people.length >= 6) break;
      if (m(`${c.first} ${c.last} ${c.position || ""}`)) people.push({ id: c.url, main: `${c.first} ${c.last}`.trim(), meta: [c.position, c.organisation].filter(Boolean).join(" · ") });
    }
    // Companies — distinct organisations whose name matches, with a people count.
    const orgCount = new Map<string, number>();
    for (const c of contacts) {
      const o = c.organisation?.trim();
      if (o && m(o)) orgCount.set(o, (orgCount.get(o) || 0) + 1);
    }
    const companies: Company[] = [...orgCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([org, count]) => ({ org, count }));

    const meetings: Hit[] = [];
    for (const r of meetingRows) {
      if (meetings.length >= 4) break;
      if (m(`${r.contactInfo.name} ${r.notes || ""} ${r.purpose || ""}`)) meetings.push({ id: r.id, main: `${r.contactInfo.name} · #${r.meeting_no}`, meta: r.meeting_stage || "—" });
    }
    const oppsHits: Hit[] = [];
    for (const o of opps) {
      if (oppsHits.length >= 4) break;
      if (m(`${o.opportunity_name || ""} ${o.organisation || ""} ${o.description || ""}`)) oppsHits.push({ id: o.id, main: o.opportunity_name || "(unnamed)", meta: o.organisation || "—" });
    }
    const contracts: Hit[] = [];
    for (const s of sows) {
      if (contracts.length >= 3) break;
      if (m(`${s.engagement_name || ""} ${s.organisation || ""}`)) contracts.push({ id: s.id, main: s.engagement_name || "(unnamed)", meta: s.organisation || "—" });
    }
    const empty = !people.length && !companies.length && !meetings.length && !oppsHits.length && !contracts.length;
    return { people, companies, meetings, opps: oppsHits, contracts, empty };
  }, [q, contacts, meetingRows, opps, sows]);

  // Render a labelled group of record hits that open a tab + record.
  const renderHits = (title: string, items: Hit[], tab: TabId) =>
    items.length > 0 ? (
      <div className="copilot-group">
        <div className="copilot-group-head">{title}</div>
        {items.map((h) => (
          <button key={tab + h.id} type="button" className="copilot-hit" onClick={() => { onNavigate(tab, { openId: h.id }); onClose(); }}>
            <span className="copilot-hit-main">{h.main}</span>
            <span className="copilot-hit-meta">{h.meta}</span>
          </button>
        ))}
      </div>
    ) : null;

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

  async function webSearch() {
    if (!q.trim() || webBusy || !searchReady) return;
    setWebBusy(true);
    setWeb(null);
    try {
      setWeb(await searchWeb(q));
    } catch {
      setWeb([]);
    } finally {
      setWebBusy(false);
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
    if (answer.searchField) intent.searchField = answer.searchField;
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
        {(aiReady || searchReady) && (
          <div className="copilot-askrow">
            {aiReady && <button type="button" className="copilot-ask" disabled={!q.trim() || asking} onClick={ask}>{asking ? "Thinking…" : "Ask AI"}</button>}
            {searchReady && <button type="button" className="copilot-web" disabled={!q.trim() || webBusy} onClick={webSearch} title="Search the web — your query is sent to Wikipedia/your search provider">{webBusy ? "Searching…" : "Search web ↗"}</button>}
            <span className="copilot-hint">{aiReady ? "Enter to ask · " : ""}results update as you type</span>
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

        {web && (
          <div className="copilot-web-results">
            <span className="copilot-web-label">Web ↗</span>
            {web.length === 0 ? (
              <p className="copilot-empty">No web results.</p>
            ) : (
              web.map((r) => (
                <a key={r.url} className="copilot-web-hit" href={r.url} target="_blank" rel="noreferrer">
                  <span className="copilot-hit-main">{r.title}</span>
                  {r.snippet && <span className="copilot-hit-meta">{r.snippet.slice(0, 120)}</span>}
                </a>
              ))
            )}
          </div>
        )}

        <div className="copilot-results">
          {groups?.empty && q.trim() && <p className="copilot-empty">No matches.</p>}
          {renderHits("People", groups?.people ?? [], "contacts")}
          {groups && groups.companies.length > 0 && (
            <div className="copilot-group">
              <div className="copilot-group-head">Companies</div>
              {groups.companies.map((c) => (
                <button key={"org" + c.org} type="button" className="copilot-hit" onClick={() => { if (onOpenAccount) onOpenAccount(c.org); else onNavigate("contacts", { search: c.org }); onClose(); }}>
                  <span className="copilot-hit-main">{c.org}</span>
                  <span className="copilot-hit-meta">{c.count} {c.count === 1 ? "person" : "people"}</span>
                </button>
              ))}
            </div>
          )}
          {renderHits("Meetings", groups?.meetings ?? [], "meetings")}
          {renderHits("Opportunities", groups?.opps ?? [], "opportunities")}
          {renderHits("Contracts", groups?.contracts ?? [], "revenue")}
        </div>
      </div>
    </div>
  );
}
