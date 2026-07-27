// A paste-a-transcript input modal (#9). The user pastes a raw call/meeting transcript; INSERT
// runs it through the model and fills the meeting write-up's EMPTY fields (notes appended, actions,
// sentiment, pain points, opportunity) — additive, never rewriting what the user typed. While it
// reads, the copilot's working treatment (glyph · staged label · seconds · ~tokens) shows under the
// input; on success the parent closes this modal and the form fields are populated for review + Save.

import { useEffect, useState } from "react";
import "./AiSuggest.css";

const GLYPHS = ["+", "✦", "✶", "✷", "✸", "✹", "✺", "✳", "∗"];
function WorkingLine({ startMs, tokens }: { startMs: number; tokens: number }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 420);
    return () => clearInterval(t);
  }, []);
  const secs = startMs ? Math.max(0, Math.floor((Date.now() - startMs) / 1000)) : 0;
  const word = tokens > 0 ? "Writing the write-up" : secs >= 8 ? "Reading the transcript — long ones take a while on local hardware" : "Reading the transcript";
  return (
    <p className="aisg-working">
      <span className="aisg-working-glyph" key={tick % GLYPHS.length}>{GLYPHS[tick % GLYPHS.length]}</span>
      <span>{word}…</span>
      {secs > 0 && <span className="aisg-working-meta">· {secs}s{tokens > 0 ? ` · ~${tokens} tok` : ""}</span>}
    </p>
  );
}

export function TranscriptModal({ onClose, onInsert, busy, startMs, tokens, error, contactName }: {
  onClose: () => void;
  onInsert: (transcript: string) => void;
  busy: boolean;
  startMs: number;
  tokens: number;
  error?: string | null;
  // The meeting's contact — a transcript that never mentions them gets a wrong-meeting warning
  // before inserting (live test: NatWest content landed silently in a Volkswagen contact's write-up).
  contactName?: string;
}) {
  const [t, setT] = useState("");
  const [confirmMismatch, setConfirmMismatch] = useState(false);
  const mismatch = (() => {
    if (!contactName || !t.trim()) return false;
    const low = t.toLowerCase();
    return !contactName.toLowerCase().split(/\s+/).filter((w) => w.length >= 2).some((w) => low.includes(w));
  })();
  const insert = () => {
    if (mismatch && !confirmMismatch) { setConfirmMismatch(true); return; }
    onInsert(t);
  };
  return (
    <div className="aisg-backdrop" onClick={(e) => { e.stopPropagation(); if (!busy) onClose(); }}>
      <div className="aisg-panel" role="dialog" aria-label="Dissect a transcript" onClick={(e) => e.stopPropagation()}>
        <header className="aisg-header">
          <div>
            <h3 className="aisg-title">Dissect a transcript</h3>
            <p className="aisg-subtitle">Paste a call or meeting transcript — AI fills the empty write-up fields.</p>
          </div>
          <button type="button" className="aisg-close" title="Close" onClick={onClose}>✕</button>
        </header>
        <div className="aisg-body">
          <textarea className="aisg-text" rows={10} value={t} onChange={(e) => setT(e.target.value)} placeholder="Paste the transcript here…" disabled={busy} />
          {busy && <WorkingLine startMs={startMs} tokens={tokens} />}
          {!busy && error && <p className="aisg-error">{error}</p>}
          {!busy && confirmMismatch && mismatch && (
            <p className="aisg-error">This transcript never mentions {contactName} — is it the right meeting? Insert will fill THIS write-up.</p>
          )}
        </div>
        <footer className="aisg-footer">
          <span className="aisg-spacer" />
          <button type="button" className="aisg-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="aisg-primary" onClick={insert} disabled={busy || !t.trim()}>{busy ? "Inserting…" : confirmMismatch && mismatch ? "Insert anyway" : "Insert"}</button>
        </footer>
        <p className="aisg-note">Runs on your machine — the transcript stays local.</p>
      </div>
    </div>
  );
}
