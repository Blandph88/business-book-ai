// FLAG-AN-ANSWER modal (the no-telemetry learning loop, part a — user-facing). Shows the composed
// bug report IN FULL and EDITABLE before anything happens: nothing is sent anywhere: the user reads
// it, optionally adds what went wrong, and copies it to paste into a Freehold bug report. The report
// carries their own question + answer (their data, their explicit copy = consent) plus content-free
// device diagnostics.

import { useEffect, useState } from "react";
import { failuresReportText } from "../ai/failureLog";
import "./FlagModal.css";

export type FlagMeta = {
  aiLabel?: string;
  aiModel?: string;
  local?: boolean;
  cloud?: boolean;
  genMs?: number;
  genTok?: number;
  computed?: boolean; // the answer was a deterministic table (vs a model narration)
};

// Pure, testable: assemble the report text. `nowMs` is passed so the caller owns the clock read.
export function composeFlagReport(question: string, answer: string, meta: FlagMeta, nowMs: number): string {
  const version = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "?";
  const tier = [meta.aiLabel, meta.aiModel ? `(${meta.aiModel})` : "", meta.local ? "on-device/local" : meta.cloud ? "cloud" : ""].filter(Boolean).join(" ");
  const timing = [
    meta.genMs != null ? `~${Math.max(1, Math.round(meta.genMs / 1000))}s` : "",
    meta.genTok ? `~${meta.genTok} tokens` : "",
    meta.computed ? "computed table" : "model answer",
  ].filter(Boolean).join(" · ");
  const stamp = new Date(nowMs).toISOString().replace("T", " ").slice(0, 19);
  return [
    "Business Book — flagged answer",
    `App v${version}${tier ? ` · AI: ${tier}` : ""} · ${stamp}`,
    timing ? `Timing: ${timing}` : "",
    "",
    "── Question ──",
    question || "(none)",
    "",
    "── Answer ──",
    answer || "(none)",
    "",
    "── Device diagnostics (no book content) ──",
    failuresReportText(nowMs),
    "",
    "── What went wrong? (add a line, then Copy) ──",
    "",
  ].filter((l) => l !== undefined).join("\n");
}

export function FlagModal({ question, answer, meta, nowMs, onClose, onCopied }: {
  question: string;
  answer: string;
  meta: FlagMeta;
  nowMs: number;
  onClose: () => void;
  onCopied: (finalReport: string) => void;
}) {
  const [text, setText] = useState(() => composeFlagReport(question, answer, meta, nowMs));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* clipboard blocked — the text is selectable */ }
    onCopied(text);
  };

  return (
    <div className="flag-backdrop" onClick={onClose}>
      <div className="flag-panel" role="dialog" aria-label="Flag this answer" onClick={(e) => e.stopPropagation()}>
        <header className="flag-header">
          <div>
            <h3 className="flag-title">Flag this answer</h3>
            <p className="flag-subtitle">Nothing is sent. Review it, add what went wrong, then copy it into a Freehold bug report.</p>
          </div>
          <button type="button" className="flag-close" title="Close" onClick={onClose}>✕</button>
        </header>
        <textarea className="flag-text" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        <footer className="flag-footer">
          <span className="flag-spacer" />
          <button type="button" className="flag-ghost" onClick={onClose}>Close</button>
          <button type="button" className="flag-primary" onClick={copy}>{copied ? "Copied ✓" : "Copy report"}</button>
        </footer>
      </div>
    </div>
  );
}
