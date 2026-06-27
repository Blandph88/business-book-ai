// The global "ask / search your book" copilot. ONE box that, on submit, always does both: it surfaces
// any matching records from the book (instant, deterministic) AND answers in natural language grounded
// in a factual summary of the whole book — no "Ask AI" button, no "Search web" button. When the search
// capability is enabled (account/product settings), the chat itself decides from the question whether a
// web lookup would help and folds the results into the answer (citing the sources). Three views:
//   • SEARCH: live record matches as you type; Enter submits a question.
//   • CHAT: the conversation, with the composer at the BOTTOM; each answer shows related records/sources.
//   • HISTORY: every past conversation, saved — pick one to reload and continue.
// Read/query only — no bulk or destructive writes (9a). Opens from the top bar (Search or Chats).

import { useEffect, useMemo, useRef, useState } from "react";
import { loadContacts, type Contact } from "../data/contacts";
import { loadAllMeetings } from "../storage/meetings";
import { buildMeetingRows, type MeetingRow } from "../data/meetings";
import { loadAllOpportunities, type Opportunity } from "../storage/opportunities";
import { loadAllSows, type Sow } from "../storage/revenue";
import { todayISO } from "../data/agenda";
import { useAiAvailable, aiPrompt, searchAvailable, searchWeb } from "../ai/ai";
import { askBookPrompt, type ChatTurn } from "../ai/prompts";
import { assembleContext, type BookData } from "../ai/bookContext";
import { retrievalCharBudget } from "../ai/contextBudget";
import { routeIntent, isActionIntent } from "../ai/intents";
import { SPECS, matchContacts } from "../ai/actions/actionSpecs";
import { readDoc, type LoadedDoc } from "../ai/docs";
import { ActionCard, type ActionCardData } from "./ActionCard";
import { listChats, getChat, saveChat, deleteChat, newChatId, titleFromTurns, type SavedChat } from "../storage/chats";
import type { Navigate, TabId } from "./TabNav";
import "./CopilotBar.css";

type Hit = { id: string; main: string; meta: string };
type Company = { org: string; count: number };
type Groups = { people: Hit[]; companies: Company[]; meetings: Hit[]; opps: Hit[]; contracts: Hit[]; empty: boolean };
type View = "search" | "chat" | "history";

// A record/company/web link surfaced alongside an answer.
type RelatedHit =
  | { kind: "record"; tab: TabId; id: string; main: string; meta: string }
  | { kind: "company"; org: string; main: string; meta: string }
  | { kind: "web"; url: string; main: string; meta: string };
// A chat turn as shown in the UI — a persisted you/ai message (with optional related links), or a
// transient "action" turn carrying a propose→confirm card (not persisted).
type UITurn = { role: "you" | "ai" | "action"; text: string; related?: RelatedHit[]; action?: ActionCardData; undo?: () => void };

// Deterministic full-text search over the book — used both for the live list and to attach the
// records most relevant to a question onto its answer. Word-prefix match (so "EY" hits EY, not Foley).
function searchBook(q: string, d: BookData): Groups | null {
  const tokenize = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const qTokens = tokenize(q);
  if (!qTokens.length) return null;
  const m = (s: string) => { const hay = tokenize(s); return qTokens.every((qt) => hay.some((ht) => ht.startsWith(qt))); };

  const people: Hit[] = [];
  for (const c of d.contacts) {
    if (people.length >= 6) break;
    if (m(`${c.first} ${c.last} ${c.position || ""}`)) people.push({ id: c.url, main: `${c.first} ${c.last}`.trim(), meta: [c.position, c.organisation].filter(Boolean).join(" · ") });
  }
  const orgCount = new Map<string, number>();
  for (const c of d.contacts) {
    const o = c.organisation?.trim();
    if (o && m(o)) orgCount.set(o, (orgCount.get(o) || 0) + 1);
  }
  const companies: Company[] = [...orgCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([org, count]) => ({ org, count }));

  const meetings: Hit[] = [];
  for (const r of d.meetingRows) {
    if (meetings.length >= 4) break;
    if (m(`${r.contactInfo.name} ${r.notes || ""} ${r.purpose || ""}`)) meetings.push({ id: r.id, main: `${r.contactInfo.name} · #${r.meeting_no}`, meta: r.meeting_stage || "—" });
  }
  const oppsHits: Hit[] = [];
  for (const o of d.opps) {
    if (oppsHits.length >= 4) break;
    if (m(`${o.opportunity_name || ""} ${o.organisation || ""} ${o.description || ""}`)) oppsHits.push({ id: o.id, main: o.opportunity_name || "(unnamed)", meta: o.organisation || "—" });
  }
  const contracts: Hit[] = [];
  for (const s of d.sows) {
    if (contracts.length >= 3) break;
    if (m(`${s.engagement_name || ""} ${s.organisation || ""}`)) contracts.push({ id: s.id, main: s.engagement_name || "(unnamed)", meta: s.organisation || "—" });
  }
  const empty = !people.length && !companies.length && !meetings.length && !oppsHits.length && !contracts.length;
  return { people, companies, meetings, opps: oppsHits, contracts, empty };
}

// Flatten the top matches into the "related records" shown under an answer.
function collectRelated(g: Groups): RelatedHit[] {
  const out: RelatedHit[] = [];
  for (const h of g.people) out.push({ kind: "record", tab: "contacts", id: h.id, main: h.main, meta: h.meta });
  for (const c of g.companies) out.push({ kind: "company", org: c.org, main: c.org, meta: `${c.count} ${c.count === 1 ? "person" : "people"}` });
  for (const h of g.meetings) out.push({ kind: "record", tab: "meetings", id: h.id, main: h.main, meta: h.meta });
  for (const h of g.opps) out.push({ kind: "record", tab: "opportunities", id: h.id, main: h.main, meta: h.meta });
  for (const h of g.contracts) out.push({ kind: "record", tab: "revenue", id: h.id, main: h.main, meta: h.meta });
  return out.slice(0, 6);
}

// Heuristic: does the question call for EXTERNAL/current info a private book can't hold? Cheap and
// instant (no extra inference) — keeps the on-device demo snappy. Only consulted when web is allowed.
const WEB_HINTS = /\b(news|latest|recent|today|current|currently|happening|update|updates|announce|announced|stock|share price|market|markets|industry|trend|trends|who is|what is|tell me about|look up|search|google|website|headquarters|revenue of|ceo of|founder|founded|acquisition|competitor|competitors)\b/i;
function needsWeb(text: string): boolean { return WEB_HINTS.test(text); }

// Starter prompts shown on an empty copilot — one per capability, so users discover they can ask,
// act, run a workflow and draft. `submit` chips fire immediately; the open-ended ones seed the box.
const STARTER_PROMPTS: { group: string; label: string; prompt: string; submit: boolean }[] = [
  { group: "Ask", label: "How's my pipeline?", prompt: "How is my pipeline looking?", submit: true },
  { group: "Ask", label: "What do you know about me?", prompt: "What do you know about me?", submit: true },
  { group: "Act", label: "Log a meeting I just had", prompt: "I just had a meeting with ", submit: false },
  { group: "Act", label: "Add an opportunity", prompt: "There's an opportunity at ", submit: false },
  { group: "Do", label: "Walk me through this week", prompt: "Walk me through this week", submit: true },
  { group: "Draft", label: "Draft a follow-up", prompt: "Draft a follow-up to ", submit: false },
];

function relativeTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

export function CopilotBar({ onNavigate, onOpenAccount, onClose, initialView = "search" }: { onNavigate: Navigate; onOpenAccount?: (org: string) => void; onClose: () => void; initialView?: "search" | "history" }) {
  const aiReady = useAiAvailable();
  const [view, setView] = useState<View>(initialView);
  const [q, setQ] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [meetingRows, setMeetingRows] = useState<MeetingRow[]>([]);
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [sows, setSows] = useState<Sow[]>([]);
  const [chat, setChat] = useState<UITurn[]>([]);
  const [asking, setAsking] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [saved, setSaved] = useState<SavedChat[]>(() => listChats());
  const [doc, setDoc] = useState<LoadedDoc | null>(null); // an attached document, fed into the next message
  const [docNote, setDocNote] = useState("");
  const chatIdRef = useRef<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const docInputRef = useRef<HTMLInputElement | null>(null);

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    setDocNote("Reading…");
    try {
      const d = await readDoc(file);
      setDoc(d);
      setDocNote("");
    } catch (e) {
      setDoc(null);
      setDocNote(e instanceof Error ? e.message : "Couldn't read that file.");
    }
  }

  // (Re)load every store — run at mount and after any agent write so later answers see the new record.
  function reloadData() {
    const m = loadAllMeetings();
    setOpps(Object.values(loadAllOpportunities()));
    setSows(Object.values(loadAllSows()));
    loadContacts().then((rows) => { setContacts(rows); setMeetingRows(buildMeetingRows(rows, m)); }).catch(() => {});
  }
  useEffect(() => { reloadData(); }, []);

  const data: BookData = useMemo(() => ({ contacts, meetingRows, opps, sows }), [contacts, meetingRows, opps, sows]);
  const today = useMemo(() => todayISO(), []);
  const groups = useMemo(() => searchBook(q, data), [q, data]);
  // Contacts as picker options (for the action card's contact field).
  const contactOptions = useMemo(() => contacts.map((c) => ({ url: c.url, label: `${`${c.first} ${c.last}`.trim()} · ${c.organisation || "—"}` })).sort((a, b) => a.label.localeCompare(b.label)), [contacts]);

  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }); }, [chat, asking, view]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  function persistTo(id: string, turns: ChatTurn[]) {
    if (!turns.length) return;
    const existing = getChat(id);
    saveChat({ id, title: titleFromTurns(turns), createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now(), turns: turns.map((t) => ({ role: t.role, text: t.text })) });
    setSaved(listChats());
  }

  // Submit: route the message. Actions (create/update) open a propose→confirm card; everything else
  // surfaces records + answers (with auto web-lookup). One box, one action.
  async function ask(override?: string) {
    const text = (override ?? q).trim();
    const attached = doc;
    if ((!text && !attached) || asking || actionBusy || !aiReady) return;
    if (!chatIdRef.current) chatIdRef.current = newChatId();
    const id = chatIdRef.current;
    const routed = routeIntent(text || "summarise this document", { hasDoc: !!attached });
    const display = text || (attached ? `Uploaded “${attached.name}”` : "");
    const prior = chat;
    setChat([...prior, { role: "you", text: display + (attached ? `  📎 ${attached.name}` : "") }]);
    setQ("");
    setDoc(null);
    setView("chat");
    if (isActionIntent(routed) && routed.entity) {
      const extractText = attached ? `${text}\n\n${attached.text}`.trim() : text;
      await startAction(routed.entity, routed.op ?? "create", routed.target ?? text, display, prior, id, extractText);
    } else {
      await answer(text || `Summarise the document “${attached?.name}”.`, prior, id, attached?.text);
    }
  }

  // The query/search/web/answer path (grounded in the tier-scaled context, plus any attached document).
  async function answer(text: string, prior: UITurn[], id: string, docText?: string) {
    setAsking(true);
    const history: ChatTurn[] = prior.filter((t) => t.role !== "action").map((t) => ({ role: t.role as "you" | "ai", text: t.text }));
    const g = searchBook(text, data);
    const related: RelatedHit[] = g && !g.empty ? collectRelated(g) : [];
    let webContext = "";
    if (!docText && (routeIntent(text).kind === "web" || needsWeb(text))) {
      try {
        if (await searchAvailable()) {
          const results = await searchWeb(text, 3);
          webContext = results.map((r) => `- ${r.title}: ${(r.snippet || "").slice(0, 160)} (${r.url})`).join("\n");
          for (const r of results.slice(0, 3)) related.push({ kind: "web", url: r.url, main: r.title, meta: (r.snippet || "").slice(0, 100) });
        }
      } catch { /* best-effort */ }
    }
    try {
      const budget = await retrievalCharBudget();
      let grounding = assembleContext(text, data, budget, today);
      if (docText) grounding += `\n\nAttached document the user uploaded (answer from this for the document; cite it):\n${docText.slice(0, Math.max(2000, budget))}`;
      const reply = await aiPrompt(askBookPrompt(text, grounding, history, webContext));
      const aiText = reply.trim() || "(no response)";
      persistTo(id, [...history, { role: "you", text }, { role: "ai", text: aiText }]);
      if (chatIdRef.current === id) setChat([...prior, { role: "you", text }, { role: "ai", text: aiText, related: related.length ? related : undefined }]);
    } catch {
      const aiText = "I couldn't answer that just now — please try again.";
      persistTo(id, [...history, { role: "you", text }, { role: "ai", text: aiText }]);
      if (chatIdRef.current === id) setChat([...prior, { role: "you", text }, { role: "ai", text: aiText }]);
    } finally {
      setAsking(false);
    }
  }

  // Begin an action: resolve the subject contact, extract fields (from the message + any document),
  // and open a review card.
  async function startAction(kind: "contact" | "meeting" | "opportunity" | "contract", op: "create" | "update", target: string, display: string, prior: UITurn[], id: string, extractText: string) {
    setActionBusy(true);
    const spec = SPECS[kind];
    let subjectUrl: string | undefined;
    if (spec.needsContact) {
      const matches = matchContacts(target, contacts);
      if (matches.length === 1) subjectUrl = matches[0].url;
    }
    const ctx = { op, text: extractText, subjectUrl, today, contacts, meetingRows, opps, sows };
    let values: Record<string, string> = {};
    try { values = await spec.extract(ctx); } catch { /* card opens with blanks */ }
    const card: ActionCardData = { kind, op, title: spec.title(ctx), fields: spec.fields, values, needsContact: spec.needsContact, subjectUrl, status: "draft" };
    const lead = op === "create" ? `Here's a draft ${spec.label.toLowerCase()} from what you said — check it${spec.needsContact && !subjectUrl ? ", pick the contact" : ""} and confirm to save.` : `Here's the change — review and confirm to update.`;
    setActionBusy(false);
    if (chatIdRef.current === id) setChat([...prior, { role: "you", text: display }, { role: "ai", text: lead }, { role: "action", text: "", action: card }]);
    persistTo(id, [...prior.filter((t) => t.role !== "action").map((t) => ({ role: t.role as "you" | "ai", text: t.text })), { role: "you", text: display }, { role: "ai", text: lead }]);
  }

  function confirmAction(idx: number, values: Record<string, string>, subjectUrl?: string) {
    const card = chat[idx]?.action;
    if (!card) return;
    setActionBusy(true);
    try {
      const ctx = { op: card.op, text: "", subjectUrl, today, contacts, meetingRows, opps, sows };
      const res = SPECS[card.kind].write(values, ctx);
      setChat((c) => c.map((t, i) => (i === idx ? { ...t, action: { ...card, status: "saved", values, subjectUrl, savedSummary: res.summary }, undo: res.undo } : t)));
      reloadData();
    } catch {
      setChat((c) => [...c, { role: "ai", text: "That didn't save — please try again." }]);
    } finally {
      setActionBusy(false);
    }
  }
  function cancelAction(idx: number) {
    setChat((c) => c.map((t, i) => (i === idx ? { role: "ai", text: "No problem — I didn't save anything." } : t)));
  }
  function undoAction(idx: number) {
    chat[idx]?.undo?.();
    reloadData();
    setChat((c) => c.map((t, i) => (i === idx ? { role: "ai", text: "Undone — I removed that change." } : t)));
  }

  function startNew() { setChat([]); chatIdRef.current = null; setQ(""); setView("search"); }
  function openHistory() { setSaved(listChats()); setView("history"); }
  function openChat(c: SavedChat) { setChat(c.turns); chatIdRef.current = c.id; setQ(""); setView("chat"); }
  function removeChat(id: string) { deleteChat(id); setSaved(listChats()); }

  const renderRelated = (related?: RelatedHit[]) =>
    related && related.length > 0 ? (
      <div className="copilot-turn-related">
        {related.map((h, j) =>
          h.kind === "web" ? (
            <a key={"w" + j} className="copilot-related copilot-related--web" href={h.url} target="_blank" rel="noreferrer">
              <span className="copilot-related-main">{h.main}</span>
              <span className="copilot-related-meta">{h.meta}</span>
            </a>
          ) : (
            <button key={"r" + j} type="button" className="copilot-related" onClick={() => { if (h.kind === "company") { if (onOpenAccount) onOpenAccount(h.org); else onNavigate("contacts", { search: h.org }); } else onNavigate(h.tab, { openId: h.id }); onClose(); }}>
              <span className="copilot-related-main">{h.main}</span>
              <span className="copilot-related-meta">{h.meta}</span>
            </button>
          ),
        )}
      </div>
    ) : null;

  const chatTitle = chat.length ? titleFromTurns(chat) : "New chat";

  return (
    <div className="copilot-backdrop" onClick={onClose}>
      <div className={"copilot copilot--" + view} role="dialog" aria-label="Ask or search your book" onClick={(e) => e.stopPropagation()}>
        <input ref={docInputRef} type="file" accept=".txt,.md,.csv,.tsv,.json,.vtt,.srt,text/*,application/json" style={{ display: "none" }} onChange={(e) => { onPickFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
        {view === "chat" && (
          <div className="copilot-head">
            {saved.length > 0 && <button type="button" className="copilot-headbtn" onClick={openHistory}>‹ Chats</button>}
            <span className="copilot-head-title">{chatTitle}</span>
            <button type="button" className="copilot-headbtn" onClick={startNew}>+ New</button>
          </div>
        )}
        {view === "history" && (
          <div className="copilot-head">
            <span className="copilot-head-title">Your chats</span>
            <button type="button" className="copilot-headbtn" onClick={startNew}>+ New chat</button>
          </div>
        )}

        {view === "search" && (
          <>
            <div className="copilot-searchbar">
              {aiReady && <button type="button" className="copilot-attach" onClick={() => docInputRef.current?.click()} title="Attach a document" aria-label="Attach a document">⎘</button>}
              <input
                ref={inputRef}
                className="copilot-input"
                autoFocus
                placeholder={aiReady ? "Search, ask or take an action…" : "Search contacts, meetings, opportunities…"}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
              />
              {aiReady && <button type="button" className="copilot-send" disabled={(!q.trim() && !doc) || asking} onClick={() => ask()} aria-label="Ask" title="Ask (Enter)">→</button>}
            </div>
            {(doc || docNote) && (
              <div className="copilot-doc">
                {doc ? (<><span className="copilot-doc-name">⎘ {doc.name}</span><button type="button" className="copilot-doc-x" onClick={() => setDoc(null)} aria-label="Remove">✕</button></>) : <span className="copilot-doc-note">{docNote}</span>}
              </div>
            )}
            <div className="copilot-askrow">
              {(aiReady || saved.length > 0) && <button type="button" className="copilot-newsearch" onClick={openHistory}>Your chats ({saved.length}) ›</button>}
              <span className="copilot-hint">{aiReady ? "Press Enter — I'll search your records, answer, or take the action" : "results update as you type"}</span>
            </div>

            {aiReady && !q.trim() && (
              <div className="copilot-starters">
                {STARTER_PROMPTS.map((s) => (
                  <button key={s.label} type="button" className="copilot-starter" onClick={() => { if (s.submit) ask(s.prompt); else { setQ(s.prompt); inputRef.current?.focus(); } }}>
                    <span className="copilot-starter-group">{s.group}</span>
                    <span className="copilot-starter-label">{s.label}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="copilot-results">
              {groups?.empty && q.trim() && (
                aiReady
                  ? <button type="button" className="copilot-empty copilot-empty--ask" onClick={() => ask()}>No direct matches — press Enter and I'll answer from your book →</button>
                  : <p className="copilot-empty">No matches.</p>
              )}
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
          </>
        )}

        {view === "history" && (
          <div className="copilot-history">
            {saved.length === 0 ? (
              <p className="copilot-empty">No saved chats yet. Ask your book a question to start one.</p>
            ) : (
              saved.map((c) => (
                <div key={c.id} className="copilot-chatitem">
                  <button type="button" className="copilot-chatitem-main" onClick={() => openChat(c)}>
                    <span className="copilot-chatitem-title">{c.title}</span>
                    <span className="copilot-chatitem-meta">{relativeTime(c.updatedAt)} · {c.turns.length} message{c.turns.length === 1 ? "" : "s"}</span>
                  </button>
                  <button type="button" className="copilot-chatitem-del" onClick={() => removeChat(c.id)} aria-label="Delete chat" title="Delete">✕</button>
                </div>
              ))
            )}
          </div>
        )}

        {view === "chat" && (
          <>
            <div className="copilot-chat" ref={threadRef}>
              {chat.map((t, i) =>
                t.role === "action" && t.action ? (
                  <div key={i} className="copilot-turn copilot-turn--action">
                    <ActionCard
                      data={t.action}
                      contacts={contactOptions}
                      busy={actionBusy}
                      onConfirm={(v, u) => confirmAction(i, v, u)}
                      onCancel={() => cancelAction(i)}
                      onUndo={t.undo ? () => undoAction(i) : undefined}
                    />
                  </div>
                ) : (
                  <div key={i} className={"copilot-turn copilot-turn--" + t.role}>
                    <span className="copilot-turn-who">{t.role === "you" ? "You" : "Your book"}</span>
                    <div className="copilot-turn-text">{t.text}</div>
                    {t.role === "ai" && renderRelated(t.related)}
                  </div>
                ),
              )}
              {(asking || actionBusy) && <div className="copilot-turn copilot-turn--ai"><span className="copilot-turn-who">Your book</span><div className="copilot-turn-text copilot-turn-text--thinking">{actionBusy ? "Working…" : "Thinking…"}</div></div>}
            </div>
            {(doc || docNote) && (
              <div className="copilot-doc copilot-doc--composer">
                {doc ? (<><span className="copilot-doc-name">⎘ {doc.name}</span><button type="button" className="copilot-doc-x" onClick={() => setDoc(null)} aria-label="Remove">✕</button></>) : <span className="copilot-doc-note">{docNote}</span>}
              </div>
            )}
            <div className="copilot-composer">
              <button type="button" className="copilot-attach" onClick={() => docInputRef.current?.click()} title="Attach a document" aria-label="Attach a document">⎘</button>
              <input
                className="copilot-composer-input"
                autoFocus
                placeholder="Ask, or attach a transcript to log a meeting…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
              />
              <button type="button" className="copilot-ask" disabled={(!q.trim() && !doc) || asking} onClick={() => ask()}>{asking ? "…" : "Send"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
