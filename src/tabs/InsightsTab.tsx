// The AI Insights hub — where the background enrichment SCANS live. Each reads your messages with your AI
// (on your machine) and enriches your book. They run ONE AT A TIME (single-slot; two on-device scans would
// fight over the GPU); progress shows in the top banner. A scan button opens an EXPLAINER modal first —
// what it reads, what it lights up, the on-device trade-off — then starts it (in the owned app). In the demo
// the sample book is already enriched, so the modal just explains what happens when you own it.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import "./InsightsTab.css";
import { getAppMode } from "../lib/appMode";
import { loadContacts, type Contact } from "../data/contacts";
import { aiAvailable, aiAvailability, isCapableBackend } from "../ai/ai";
import { hasWarmthSignal, countScoreable, scanRedactEnabled, setScanRedact } from "../ai/sentiment";
import { countOppScoreable } from "../ai/oppScan";
import { countUnclassified } from "../ai/enrich";
import { subscribeWarmth, getWarmthState, startWarmthAnalysis, startOpportunityScan, startClassifyScan, isAnalysisRunning } from "../ai/warmthTask";

type Job = "warmth" | "opportunities" | "classify";

const SCAN_INFO: Record<Job, { title: string; what: string; lights: string[]; caveat: string }> = {
  warmth: {
    title: "Relationship warmth",
    what: "Reads the messages each contact sent you and rates how warm and keen they are — from their own words, entirely on your machine.",
    lights: [
      "Your warmest-leads ranking (sorted by real tone, not just funnel stage)",
      "The Warmth column & filter on Contacts",
      "The Relationship-temperature chart on Home",
    ],
    caveat: "On an in-browser model it scores your top ~300 most-engaged relationships and can take a while. A cloud key or a local model does your whole book, much faster.",
  },
  opportunities: {
    title: "Opportunity scan",
    what: "Reads your threads for latent opportunities — a need, project, budget, or “we're looking for…” that could become work but isn't in your pipeline yet.",
    lights: [
      "The “Opportunities in messages” card on the Dashboard",
      "The Opportunity filter on Contacts",
      "Ask the assistant “any opportunities in my messages”",
    ],
    caveat: "Heavier than the warmth scan. On an in-browser model it covers your top ~300 threads; a cloud key or local model does them all, faster.",
  },
  classify: {
    title: "Company sectors",
    what: "Classifies the firms we couldn't auto-sort into an industry group, using your AI (grounded with a quick web lookup when search is on). It works per unique firm — a few dozen calls, not one per contact — so it's quick.",
    lights: [
      "Fills the “Other / smaller firms” tail in your sector charts + funnel",
      "Sharpens the sector filter + market-penetration views",
    ],
    caveat: "Company-level, so it's the fastest of the three.",
  },
};

export function InsightsTab() {
  const task = useSyncExternalStore(subscribeWarmth, getWarmthState);
  const isDemo = getAppMode() === "demo";
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [aiOn, setAiOn] = useState<boolean | null>(null);
  const [modal, setModal] = useState<Job | null>(null);
  const [cloud, setCloud] = useState(false); // active backend is a remote cloud provider → data leaves the machine
  const [redact, setRedact] = useState(scanRedactEnabled());

  const reload = useCallback(() => { loadContacts().then(setContacts); }, []);
  useEffect(() => { reload(); aiAvailable().then(setAiOn); aiAvailability().then((a) => setCloud(isCapableBackend(a.backend) && !a.local)); }, [reload]);
  useEffect(() => { if (task.status === "done") reload(); }, [task.status, reload]);

  const candidates = contacts.filter(hasWarmthSignal).length;
  const warmthScored = contacts.filter((c) => c.warmthSentiment).length;
  const oppFound = contacts.filter((c) => c.latentOpp?.text).length;
  // Demo: no real message threads (so `candidates` is 0), but the sample book is pre-seeded — show the seeded
  // counts as "done" so the hub looks lit up. Owned: real candidate counts drive "X of Y · N to go".
  const warmthTotal = isDemo ? warmthScored : candidates;
  const warmthRemaining = isDemo ? 0 : countScoreable(contacts);
  const oppTotal = isDemo ? warmthScored : candidates;
  const oppScanned = isDemo ? warmthScored : contacts.filter((c) => c.latentOpp).length;
  const oppRemaining = isDemo ? 0 : countOppScoreable(contacts);
  const unclassified = isDemo ? 0 : countUnclassified(contacts);

  const running = isAnalysisRunning();
  const anyMessages = candidates > 0 || warmthScored > 0;

  const cards: { job: Job; done: number; total: number; remaining: number; status: string; desc: string }[] = [
    {
      job: "warmth",
      done: warmthScored, total: warmthTotal, remaining: warmthRemaining,
      desc: "Rates how warm and keen each contact is, from the tone of their replies — powering your warmest-leads ranking, the Warmth column/filter, and the temperature chart.",
      status: isDemo
        ? `Sample data — ${warmthScored.toLocaleString()} relationships scored (this is what the scan produces).`
        : warmthScored > 0 ? `${warmthScored.toLocaleString()} of ${candidates.toLocaleString()} relationships scored${warmthRemaining > 0 ? ` · ${warmthRemaining.toLocaleString()} to go` : " · all done"}` : `${candidates.toLocaleString()} relationships ready to analyse`,
    },
    {
      job: "opportunities",
      done: oppScanned, total: oppTotal, remaining: oppRemaining,
      desc: "Reads threads for latent opportunities — a need, project, or “we're looking for…” that isn't in your pipeline yet. Heavier than warmth, so run it when you can spare your AI for a while.",
      status: isDemo
        ? `Sample data — ${oppFound.toLocaleString()} opportunities spotted (this is what the scan produces).`
        : oppScanned > 0 ? `${oppFound.toLocaleString()} opportunities found · ${oppScanned.toLocaleString()} of ${candidates.toLocaleString()} scanned${oppRemaining > 0 ? ` · ${oppRemaining.toLocaleString()} to go` : " · all done"}` : `${candidates.toLocaleString()} threads ready to scan`,
    },
    {
      job: "classify",
      done: 0, total: 0, remaining: unclassified,
      desc: "Sorts the firms we couldn't auto-classify into an industry group with your AI — one call per unique firm, so it's quick. Cleans up the “Other / smaller firms” tail in your charts.",
      status: isDemo
        ? "Sample data — firms are already classified."
        : unclassified > 0 ? `${unclassified.toLocaleString()} contacts sit at firms we couldn't auto-classify.` : "All firms classified.",
    },
  ];

  return (
    <section className="insights">
      <div className="insights-head">
        <h2>AI Insights</h2>
        <p className="insights-lead">
          Scans read your message threads with your AI — on your machine — and enrich your book. They run one
          at a time; progress appears at the top and you can keep working while they run.
        </p>
      </div>

      {!anyMessages && !isDemo ? (
        <p className="insights-empty">Import your LinkedIn <strong>messages</strong> to unlock these — the scans read the threads where people replied to you.</p>
      ) : (
        <div className="insights-grid">
          {cards.map((card) => {
            const info = SCAN_INFO[card.job];
            const isThis = running && task.job === card.job;
            // The CARD shows OVERALL progress against the whole book. While THIS scan runs it climbs live:
            // overall done = (all candidates) − (this run's remaining) = card.total − task.total + task.done.
            // (The BANNER separately shows just this run's progress over its remaining batch — they differ by
            // design.) Robust to incremental saves — derived from the stable total + this-run counts.
            const badgeTotal = card.total;
            const badgeDone = isThis && task.total ? Math.min(badgeTotal, card.total - task.total + task.done) : card.done;
            const pct = badgeTotal ? Math.min(100, Math.round((badgeDone / badgeTotal) * 100)) : 0;
            return (
              <div className="insight-card" key={card.job}>
                <div className="insight-head">
                  <h3>{info.title}</h3>
                  {badgeTotal > 0 && <span className="insight-badge">{badgeDone.toLocaleString()} / {badgeTotal.toLocaleString()}</span>}
                </div>
                <p className="insight-desc">{card.desc}</p>
                <p className="insight-status">{isThis ? "Running… progress shown at the top." : card.status}</p>
                {badgeTotal > 0 && <div className="insight-bar"><div className="insight-fill" style={{ width: `${pct}%` }} /></div>}
                <div className="insight-actions">
                  <button type="button" className="insight-btn insight-btn-primary" disabled={isThis} onClick={() => setModal(card.job)}>
                    {isThis ? "Running…" : isDemo ? "How it works" : "Run analysis…"}
                  </button>
                </div>
                {running && !isThis && <p className="insight-note">Waiting — another scan is running (they run one at a time).</p>}
              </div>
            );
          })}
        </div>
      )}

      {cloud && (
        <label className="insights-privacy">
          <input type="checkbox" checked={redact} onChange={(e) => { setRedact(e.target.checked); setScanRedact(e.target.checked); }} />
          <span>
            <strong>Redact identities before sending to your cloud model.</strong> Names, emails and phone numbers are
            stripped from your messages before a scan sends them to your provider — the scans judge tone/intent, so
            scores are unaffected. Your local book keeps the originals; only the outgoing snippets are scrubbed.
          </span>
        </label>
      )}

      {modal && (
        <ScanModal
          job={modal}
          isDemo={isDemo}
          aiOn={aiOn}
          running={running}
          remaining={modal === "warmth" ? warmthRemaining : modal === "opportunities" ? oppRemaining : unclassified}
          onClose={() => setModal(null)}
          onStart={(force) => {
            if (modal === "warmth") startWarmthAnalysis({ force });
            else if (modal === "opportunities") startOpportunityScan({ force });
            else startClassifyScan();
            setModal(null);
          }}
        />
      )}
    </section>
  );
}

function ScanModal({
  job, isDemo, aiOn, running, remaining, onClose, onStart,
}: {
  job: Job; isDemo: boolean; aiOn: boolean | null; running: boolean; remaining: number;
  onClose: () => void; onStart: (force: boolean) => void;
}) {
  const info = SCAN_INFO[job];
  const allDone = remaining === 0;      // owned + everything scored → the action re-analyses from scratch
  const canRun = !isDemo && aiOn === true && !running; // only the owned app, AI set up, nothing else running
  // The explanation ALWAYS shows (above). This note just layers on the current status — including a nudge to
  // set up AI (before buying, in the demo) — without hiding what the analysis does.
  const note = isDemo
    ? aiOn === false
      ? "You're exploring sample data — it already shows example results. In the app you own, this runs on your real messages, on your machine. AI isn't set up yet — worth setting it up (before you buy) so it's ready to go on your own book."
      : "You're exploring sample data — it already shows example results. In the app you own, this runs on your real messages, on your machine."
    : aiOn === false
      ? "AI isn't set up yet — set it up in your AI settings on Freehold to run this. It reads your messages entirely on your machine."
      : running
        ? "Another scan is running — this will be free to start once that finishes."
        : "";
  return (
    <div className="insight-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={info.title}>
      <div className="insight-modal" onClick={(e) => e.stopPropagation()}>
        <button className="insight-modal-x" onClick={onClose} aria-label="Close">×</button>
        <h3 className="insight-modal-title">{info.title}</h3>
        <p className="insight-modal-what">{info.what}</p>
        <p className="insight-modal-sub">What it lights up:</p>
        <ul className="insight-modal-list">
          {info.lights.map((l) => <li key={l}>{l}</li>)}
        </ul>
        <p className="insight-modal-caveat">{info.caveat} It runs in the background — you can keep working, and pause or cancel any time.</p>

        {note && <p className="insight-modal-note">{note}</p>}
        <div className="insight-modal-actions">
          {canRun ? (
            <>
              <button className="insight-btn insight-btn-ghost" onClick={onClose}>Cancel</button>
              <button className="insight-btn insight-btn-primary" onClick={() => onStart(allDone)}>{allDone ? "Re-analyse all" : "Start analysis"}</button>
            </>
          ) : (
            <button className="insight-btn insight-btn-primary" onClick={onClose}>Got it</button>
          )}
        </div>
      </div>
    </div>
  );
}
