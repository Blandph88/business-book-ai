// A paste-a-transcript input modal (#9). The user pastes a raw call/meeting transcript; on Extract
// the parent runs it through the model and fills the meeting write-up (notes, actions, sentiment,
// pain points, opportunity). Human-in-the-loop: the parent fills its form fields for review + Save.

import { useState } from "react";
import "./AiSuggest.css";

export function TranscriptModal({ onClose, onExtract, busy }: { onClose: () => void; onExtract: (transcript: string) => void; busy: boolean }) {
  const [t, setT] = useState("");
  return (
    <div className="aisg-backdrop" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="aisg-panel" role="dialog" aria-label="Dissect a transcript" onClick={(e) => e.stopPropagation()}>
        <header className="aisg-header">
          <div>
            <h3 className="aisg-title">Dissect a transcript</h3>
            <p className="aisg-subtitle">Paste a call or meeting transcript — AI fills the write-up.</p>
          </div>
          <button type="button" className="aisg-close" title="Close" onClick={onClose}>✕</button>
        </header>
        <div className="aisg-body">
          <textarea className="aisg-text" rows={10} value={t} onChange={(e) => setT(e.target.value)} placeholder="Paste the transcript here…" />
        </div>
        <footer className="aisg-footer">
          <span className="aisg-spacer" />
          <button type="button" className="aisg-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="aisg-primary" onClick={() => onExtract(t)} disabled={busy || !t.trim()}>{busy ? "Reading…" : "Extract"}</button>
        </footer>
        <p className="aisg-note">Runs on your machine — the transcript stays local.</p>
      </div>
    </div>
  );
}
