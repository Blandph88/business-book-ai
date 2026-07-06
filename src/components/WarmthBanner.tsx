// The background progress banner for the relationship-warmth pass. Reads the global warmthTask store, and
// runs its OWN 1-second timer so it visibly animates (rotating verb + ticking ETA) even while a single slow
// batch is mid-flight — so it never looks frozen sitting on "84 / 3225". Shows progress, estimated time
// left, tokens used, the contact being scored, and (on the in-browser model) a nudge to use a cloud key.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { subscribeWarmth, getWarmthState, pauseWarmthAnalysis, resumeWarmthAnalysis, cancelWarmthAnalysis, dismissWarmth } from "../ai/warmthTask";
import { formatDuration, formatTokens } from "../data/format";
import "./WarmthBanner.css";

const VERBS = ["Reading", "Weighing", "Sensing", "Scoring", "Gauging", "Judging", "Interpreting", "Reading the room"];

export function WarmthBanner() {
  const state = useSyncExternalStore(subscribeWarmth, getWarmthState);
  const [tick, setTick] = useState(0);
  // Rolling samples of (time, done) so the ETA reflects the RECENT rate, not the slow warm-up batch (which
  // otherwise implies an absurd "10h left"). Reset per run (keyed on startedAt).
  const samplesRef = useRef<{ startedAt: number; pts: { t: number; done: number }[] }>({ startedAt: 0, pts: [] });

  // 1s heartbeat while running → keeps the verb rotating + ETA ticking so it's obviously alive.
  useEffect(() => {
    if (state.status !== "running") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  // Auto-dismiss the "done" banner after a few seconds. (Running/paused are NEVER auto-hidden.)
  useEffect(() => {
    if (state.status !== "done") return;
    const id = setTimeout(() => dismissWarmth(), 8000);
    return () => clearTimeout(id);
  }, [state.status]);

  // Sample (time, done) each render while running → a rolling-window rate for a sane ETA.
  useEffect(() => {
    const s = samplesRef.current;
    if (state.status !== "running") { s.pts = []; s.startedAt = 0; return; }
    if (s.startedAt !== state.startedAt) { s.startedAt = state.startedAt; s.pts = []; }
    const now = Date.now();
    s.pts.push({ t: now, done: state.done });
    while (s.pts.length > 2 && now - s.pts[0].t > 120_000) s.pts.shift(); // keep ~last 2 minutes
  }, [state.status, state.startedAt, state.done, tick]);

  if (state.status !== "running" && state.status !== "done" && state.status !== "paused") return null;

  if (state.status === "done") {
    return (
      <div className="warmth-banner warmth-banner--done" role="status">
        <span className="warmth-banner-check" aria-hidden>✓</span>
        <span className="warmth-banner-text">
          {state.capped
            ? `${state.label} — analysed your ${state.scored.toLocaleString()} most-engaged of ${state.scoreable.toLocaleString()}; a powerful on-device model or cloud key does the rest.`
            : `${state.label} — done (${state.scored.toLocaleString()}).`}
        </span>
        <button className="warmth-banner-x" onClick={dismissWarmth} aria-label="Dismiss">×</button>
      </div>
    );
  }

  const { done, total, tokens, current, startedAt, backend, capped, scoreable, label, status } = state;
  const paused = status === "paused";
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const elapsed = !paused && startedAt ? (Date.now() - startedAt) / 1000 : 0;
  // ETA from the ROLLING window, not cumulative — so the slow first batch doesn't imply "10h".
  const pts = samplesRef.current.pts;
  const oldest = pts[0];
  const rate = oldest && done > oldest.done ? (done - oldest.done) / Math.max(1, (Date.now() - oldest.t) / 1000) : 0;
  const eta = rate > 0 && total > done ? formatDuration((total - done) / rate) : "estimating…";
  const verb = VERBS[tick % VERBS.length];
  const onBrowser = backend === "webllm" || backend === "builtin";

  return (
    <div className={paused ? "warmth-banner warmth-banner--paused" : "warmth-banner"} role="status" aria-live="polite">
      <div className="warmth-banner-main">
        <div className="warmth-banner-line">
          <span className="warmth-banner-verb">
            {label}{paused ? " · Paused" : <> · {verb}<span className="warmth-banner-dots" aria-hidden>…</span></>}
          </span>
          {!paused && current && <span className="warmth-banner-current">{current}</span>}
          {total > 0 && <span className="warmth-banner-count">{done.toLocaleString()} / {total.toLocaleString()}</span>}
        </div>
        {total > 0 && <div className="warmth-banner-bar"><div className="warmth-banner-fill" style={{ width: `${pct}%` }} /></div>}
        {!paused && (
          <div className="warmth-banner-meta">
            {done === 0 ? (
              // Nothing has completed yet — the first batch is still generating (can be ~a minute on a local
              // model). Reassure instead of showing "0 tokens · estimating…", which reads as frozen/broken.
              <span>Warming up — first results in a moment… · {formatDuration(elapsed)} so far</span>
            ) : (
              <>
                <span>{eta === "estimating…" ? eta : `~${eta} left`}</span>
                <span aria-hidden>·</span>
                <span>{formatDuration(elapsed)} so far</span>
                <span aria-hidden>·</span>
                <span>~{formatTokens(tokens)} tokens used</span>
              </>
            )}
          </div>
        )}
        {paused ? (
          <div className="warmth-banner-note">Paused — resume any time to carry on where it left off.</div>
        ) : onBrowser && capped ? (
          <div className="warmth-banner-note">
            On-device, scoring your <strong>top {total.toLocaleString()}</strong> most-engaged (met / agreed to meet, then most-messaged) of {scoreable.toLocaleString()}. A cloud key or powerful on-device model does your whole book — and much faster.
          </div>
        ) : onBrowser ? (
          <div className="warmth-banner-note">A cloud key or powerful on-device model runs this much faster.</div>
        ) : null}
      </div>
      <div className="warmth-banner-controls">
        {paused ? (
          <button className="warmth-banner-ctl warmth-banner-ctl--primary" onClick={resumeWarmthAnalysis}>Resume</button>
        ) : (
          <button className="warmth-banner-ctl" onClick={pauseWarmthAnalysis}>Pause</button>
        )}
        <button className="warmth-banner-ctl warmth-banner-ctl--ghost" onClick={cancelWarmthAnalysis}>Cancel</button>
      </div>
    </div>
  );
}
