// "Import your LinkedIn" modal. Mode-aware:
//   • demo  → explains the LinkedIn export + on-device privacy promise ("real importer once you own it").
//   • owned → a real file picker for Connections.csv (+ optional messages.csv), parses + classifies +
//             saves the buyer's network entirely in the browser, then re-renders the app onto it
//             (via onImported — NOT a page reload; under the seal a reload replays the stale
//             pre-import seed, so we remount in-place to read the data just written this session).

import { useEffect, useRef, useState } from "react";
import { getAppMode } from "../lib/appMode";
import { importLinkedIn, carryOverEnrichment, type ImportResult } from "../data/linkedinImport";
import { saveImportedContacts, loadImportedContacts, hasImportedContacts } from "../storage/importedContacts";
import { aiAvailability, type AiAvailability } from "../ai/ai";
import { countScoreable } from "../ai/sentiment";
import { startWarmthAnalysis, cancelWarmthAnalysis, awaitAnalysisStopped } from "../ai/warmthTask";
import "./ImportModal.css";

function Steps() {
  return (
    <ol className="imp-steps">
      <li>On LinkedIn: <strong>Settings &amp; Privacy → Data Privacy → Get a copy of your data</strong>.</li>
      <li>Tick <strong>Connections</strong> (ready in a few minutes) and, for the outreach funnel + warmth, <strong>Messages</strong> — note the archive <strong>with messages can take up to 24 hours</strong>.</li>
      <li>When LinkedIn emails you the ZIP, unzip it and upload <strong>Connections.csv</strong> here. You can start with Connections now and add <strong>messages.csv</strong> later — re-importing keeps everything you've done.</li>
    </ol>
  );
}

function FilePick({
  label, file, onPick, required, hint,
}: { label: string; file: File | null; onPick: (f: File | null) => void; required?: boolean; hint?: string }) {
  return (
    <label className="imp-file">
      <span className="imp-file-label">
        {label}
        {required && <em className="imp-req"> · required</em>}
        {hint && <em className="imp-hint"> · {hint}</em>}
      </span>
      <input type="file" accept=".csv,text/csv" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      <span className="imp-file-state">{file ? `✓ ${file.name}` : "No file chosen"}</span>
    </label>
  );
}

export function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const demo = getAppMode() === "demo";
  const [conn, setConn] = useState<File | null>(null);
  const [msgs, setMsgs] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  // Relationship-warmth pass. It reads the messages each contact sent and scores how keen they are. We
  // AUTO-START it only on an ON-DEVICE model (stays on the machine); a CLOUD model (BYOK) would send message
  // snippets off-device, so that requires an explicit opt-in (see the done screen).
  const [avail, setAvail] = useState<AiAvailability | null>(null);
  const [cloudScanStarted, setCloudScanStarted] = useState(false);
  const scoreable = result ? countScoreable(result.contacts) : 0;
  // Is there already an imported book? A re-import REPLACES it (saveImportedContacts writes one keyed
  // record — latest export wins), so repeated uploads don't accumulate. We just surface that so it's not a
  // surprise. Owner-logged meetings/opportunities/edits live in their own stores and are kept.
  const [hasExisting, setHasExisting] = useState(false);

  // A11y: this is a modal dialog, so move focus in on open, TRAP Tab within it, close on Escape, and restore
  // focus to whatever opened it on close — otherwise keyboard/screen-reader users get stranded behind it.
  const modalRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(
      modalRef.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [],
    ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
    (focusables()[0] ?? modalRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCloseRef.current(); return; }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, []);

  useEffect(() => {
    if (result && scoreable) aiAvailability().then(setAvail);
  }, [result, scoreable]);

  useEffect(() => {
    if (!demo) hasImportedContacts().then(setHasExisting);
  }, [demo]);

  // Auto-start the background analysis ONLY on an on-device model (no egress). Cloud (BYOK) waits for opt-in.
  useEffect(() => {
    if (result && scoreable && avail?.willRun && !avail.byok) void startWarmthAnalysis();
  }, [result, scoreable, avail]);

  async function runImport() {
    if (!conn) return;
    setBusy(true);
    setError(null);
    try {
      const connText = await conn.text();
      const msgText = msgs ? await msgs.text() : "";
      const res = importLinkedIn(connText, msgText);
      if (!res.contacts.length) {
        setError("No contacts found. Make sure you picked Connections.csv from your LinkedIn export.");
        setBusy(false);
        return;
      }
      // A background scan (warmth/opportunity/classify) snapshots the book when it starts and persists
      // incrementally for a long time. Stop any in-flight scan and wait for its current batch to drain BEFORE
      // we write the new import, so its write can't clobber the fresh book and so the post-import scan restarts
      // on the new data (the runner is single-slot and would otherwise no-op while the old loop is alive).
      // merge-on-persist backs this up, so it's safe even if a slow on-device batch outlives the wait.
      if (!demo) { cancelWarmthAnalysis(); await awaitAnalysisStopped(); }
      // Re-import: carry prior WORK the fresh export can't supply — the warmth/opportunity scans (hours of
      // analysis) AND, when messages.csv wasn't re-uploaded, the funnel flags + message history. Without this a
      // Connections-only refresh would silently wipe messaged/responded/agreed + who-owes-a-reply. owned-mode
      // only — the demo book isn't imported.
      const prev = demo ? [] : await loadImportedContacts();
      const contacts = carryOverEnrichment(res.contacts, prev);
      await saveImportedContacts(contacts);
      setResult({ ...res, contacts });
    } catch (e) {
      setError(
        e instanceof Error
          ? `Import failed: ${e.message}`
          : "Couldn't read that file. Make sure it's the .csv from your LinkedIn data export.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="imp-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Import your LinkedIn">
      <div className="imp-modal" ref={modalRef} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <button className="imp-close" onClick={onClose} aria-label="Close">×</button>
        <h2 className="imp-title">Import your LinkedIn network</h2>

        {demo ? (
          <div className="imp-body">
            <p className="imp-lead">
              You're exploring sample data. In the app you <strong>own</strong>, this button imports your
              real LinkedIn network — read entirely on your machine.
            </p>
            <Steps />
            <p className="imp-privacy">🔒 Your connections never leave your computer. The app has no server and can't upload anything — that's the whole point.</p>
            <button className="imp-btn imp-btn-primary" onClick={onClose}>Got it — keep exploring</button>
          </div>
        ) : result ? (
          <div className="imp-body imp-done">
            <p className="imp-done-headline">✓ Imported {result.counts.total.toLocaleString()} contacts</p>
            <ul className="imp-done-stats">
              <li><strong>{result.counts.messaged.toLocaleString()}</strong> messaged</li>
              <li><strong>{result.counts.responded.toLocaleString()}</strong> responded</li>
              <li><strong>{result.counts.agreed.toLocaleString()}</strong> agreed to meet</li>
            </ul>
            {result.warnings.length > 0 && (
              <ul className="imp-warn" role="status">
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
            <p className="imp-privacy">🔒 Everything stayed on this computer — nothing was uploaded.</p>
            {scoreable > 0 && avail && (
              <div className="imp-warmth">
                {avail.willRun && !avail.byok ? (
                  <p className="imp-warmth-lead">✨ Analysing the tone of {scoreable.toLocaleString()} message threads to rank your leads by how keen each contact <em>actually</em> was — running on your machine, in the background. <strong>Open your book and keep working</strong>; progress shows at the top.</p>
                ) : avail.willRun && avail.byok ? (
                  cloudScanStarted ? (
                    <p className="imp-warmth-lead">✨ Analysing {scoreable.toLocaleString()} message threads to rank your leads — running in the background. Progress shows at the top.</p>
                  ) : (
                    <>
                      <p className="imp-warmth-note">Rank your leads by the tone of your message threads? Your AI is set to your own cloud key, so this sends short, <strong>redacted</strong> message snippets to your provider to score them.</p>
                      <button className="imp-btn imp-btn-primary" onClick={() => { setCloudScanStarted(true); void startWarmthAnalysis(); }}>Analyse my messages</button>
                    </>
                  )
                ) : (
                  <p className="imp-warmth-note">Set up AI to rank your leads by the tone of your message threads — you can start this any time from your book.</p>
                )}
              </div>
            )}
            <button className="imp-btn imp-btn-primary" onClick={onImported}>Open my book of business</button>
          </div>
        ) : (
          <div className="imp-body">
            <p className="imp-lead">
              Upload the files from your LinkedIn data export. They're read <strong>on your computer</strong> — nothing is sent anywhere.
            </p>
            <Steps />
            <div className="imp-pick">
              <FilePick label="Connections.csv" required file={conn} onPick={setConn} />
              <FilePick label="messages.csv" hint="adds your funnel + relationship warmth" file={msgs} onPick={setMsgs} />
            </div>
            {hasExisting && (
              <p className="imp-replace-note">This refreshes your imported book with the new export. Your logged meetings, opportunities, edits and relationship analysis are kept — and if you don't re-upload messages.csv, your existing funnel (who you've messaged, who replied, who owes a reply) stays too.</p>
            )}
            {error && <p className="imp-error">{error}</p>}
            <button className="imp-btn imp-btn-primary" disabled={!conn || busy} onClick={runImport}>
              {busy ? "Importing…" : "Import my network"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
