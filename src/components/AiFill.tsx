// A small "fill this form with AI" affordance for the entity forms — describe the record in a
// sentence (or paste a few lines) and the SAME extractor the copilot uses populates the fields. The
// user still reviews everything and clicks Save; nothing is written here. Shared so every tab's form
// gets the capability from one place.

import { useState } from "react";
import { todayISO } from "../data/agenda";
import { SPECS, type ActionKind } from "../ai/actions/actionSpecs";
import { useAiAvailable } from "../ai/ai";
import "./AiFill.css";

export function AiFill({ kind, placeholder, apply }: { kind: ActionKind; placeholder?: string; apply: (values: Record<string, string>) => void }) {
  const aiReady = useAiAvailable();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  if (!aiReady) return null;

  async function run() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const values = await SPECS[kind].extract({ op: "create", text, subjectUrl: undefined, today: todayISO(), contacts: [], meetingRows: [], opps: [], sows: [] });
      apply(values);
      setOpen(false);
      setText("");
    } catch { /* leave the form as-is */ } finally {
      setBusy(false);
    }
  }

  if (!open) return <button type="button" className="aifill-open" onClick={() => setOpen(true)}>Fill with AI</button>;

  return (
    <div className="aifill">
      <textarea
        className="aifill-text"
        rows={2}
        autoFocus
        placeholder={placeholder || "Describe it in a sentence and I'll fill the fields below…"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); }}
      />
      <div className="aifill-row">
        <button type="button" className="aifill-btn aifill-btn--primary" disabled={!text.trim() || busy} onClick={run}>{busy ? "Filling…" : "Fill"}</button>
        <button type="button" className="aifill-btn" onClick={() => { setOpen(false); setText(""); }}>Cancel</button>
        <span className="aifill-note">Review everything before you save.</span>
      </div>
    </div>
  );
}
