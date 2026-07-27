// The human-in-the-loop surface every AI feature shares. It runs a generator, shows the result in an
// EDITABLE box, and lets the user Regenerate (optionally with a tweak like "shorter"/"warmer"), Copy,
// or Use it. Nothing is ever written or sent automatically — the model proposes, the user decides.

import { useCallback, useEffect, useRef, useState } from "react";
import { explainFailure } from "../ai/health";
import "./AiSuggest.css";

export type AiTweak = { label: string; instruction: string };

export function AiSuggest({
  title,
  subtitle,
  generate,
  tweaks,
  onClose,
  onAccept,
  acceptLabel = "Use this",
  editable = true,
}: {
  title: string;
  subtitle?: string;
  // Produce a suggestion. Called on open and on every Regenerate; the optional tweak is an extra
  // instruction (e.g. "Make it shorter").
  generate: (tweak?: string) => Promise<string>;
  tweaks?: AiTweak[];
  onClose: () => void;
  onAccept?: (text: string) => void;
  acceptLabel?: string;
  editable?: boolean;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Ignore an in-flight generation that resolves after the panel closes (no setState-after-unmount).
  const alive = useRef(true);
  // StrictMode-safe: the body RE-ARMS the flag on every (re)mount — the cleanup-only version left
  // alive=false after StrictMode's simulated remount, so results/errors/busy-clears were silently
  // discarded and every generation on this surface looked like an infinite stall (the 475s hang).
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const run = useCallback(
    (tweak?: string) => {
      setLoading(true);
      setError(null);
      // TURN BUDGET (same contract as the copilot): a local model's queue can stall indefinitely —
      // the dashboard Draft button sat on "Thinking…" forever in the re-verify. Cap the wait and
      // explain honestly from live backend state instead.
      const budget = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("turn-budget")), 90_000));
      Promise.race([generate(tweak), budget])
        .then((t) => { if (alive.current) setText(t.trim()); })
        .catch(async (e) => {
          if (!alive.current) return;
          const msg = e instanceof Error && e.message === "turn-budget"
            ? await explainFailure("turn-budget")
            : await explainFailure("error");
          if (alive.current) setError(msg);
        })
        .finally(() => { if (alive.current) setLoading(false); });
    },
    [generate],
  );

  // Generate once on open. (Intentionally not re-running when `generate` identity changes mid-open.)
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
  }, [run]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function copy() {
    try {
      void navigator.clipboard?.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="aisg-backdrop" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="aisg-panel" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="aisg-header">
          <div>
            <h3 className="aisg-title">{title}</h3>
            {subtitle && <p className="aisg-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="aisg-close" title="Close" onClick={onClose}>✕</button>
        </header>

        <div className="aisg-body">
          {loading ? (
            <div className="aisg-loading">Thinking…</div>
          ) : error ? (
            <div className="aisg-error">{error}</div>
          ) : editable ? (
            <textarea className="aisg-text" value={text} onChange={(e) => setText(e.target.value)} rows={8} />
          ) : (
            <div className="aisg-readonly">{text}</div>
          )}
        </div>

        {!loading && !error && tweaks && tweaks.length > 0 && (
          <div className="aisg-tweaks">
            {tweaks.map((t) => (
              <button key={t.label} type="button" className="aisg-chip" onClick={() => run(t.instruction)}>
                {t.label}
              </button>
            ))}
          </div>
        )}

        <footer className="aisg-footer">
          <button type="button" className="aisg-ghost" onClick={() => run()} disabled={loading}>Regenerate</button>
          <span className="aisg-spacer" />
          <button type="button" className="aisg-ghost" onClick={copy} disabled={loading || !!error}>{copied ? "Copied" : "Copy"}</button>
          {onAccept && (
            <button type="button" className="aisg-primary" onClick={() => onAccept(text)} disabled={loading || !!error}>{acceptLabel}</button>
          )}
        </footer>
        <p className="aisg-note">AI-generated — review before you use it.</p>
      </div>
    </div>
  );
}
