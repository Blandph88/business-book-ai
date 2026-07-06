// "Import your LinkedIn" modal. Mode-aware:
//   • demo  → explains the LinkedIn export + on-device privacy promise ("real importer once you own it").
//   • owned → a real file picker for Connections.csv (+ optional messages.csv), parses + classifies +
//             saves the buyer's network entirely in the browser, then re-renders the app onto it
//             (via onImported — NOT a page reload; under the seal a reload replays the stale
//             pre-import seed, so we remount in-place to read the data just written this session).

import { useEffect, useState } from "react";
import { getAppMode } from "../lib/appMode";
import { importLinkedIn, carryOverEnrichment, type ImportResult } from "../data/linkedinImport";
import { saveImportedContacts, loadImportedContacts, hasImportedContacts } from "../storage/importedContacts";
import { aiAvailable } from "../ai/ai";
import { countScoreable } from "../ai/sentiment";
import { startWarmthAnalysis } from "../ai/warmthTask";
import "./ImportModal.css";

function Steps() {
  return (
    <ol className="imp-steps">
      <li>On LinkedIn: <strong>Settings &amp; Privacy → Data Privacy → Get a copy of your data</strong>.</li>
      <li>Tick <strong>Connections</strong> and <strong>Messages</strong>, request the archive, then download the ZIP when it's ready (usually a few minutes).</li>
      <li>Unzip it, and upload <strong>Connections.csv</strong> and <strong>messages.csv</strong> here.</li>
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
  // Relationship-warmth pass: after import we AUTO-START it as a background task (a top-of-app banner shows
  // progress). It reads the messages each contact sent and scores how keen they are — feeding warmth ranking.
  const [aiOn, setAiOn] = useState<boolean | null>(null);
  const scoreable = result ? countScoreable(result.contacts) : 0;
  // Is there already an imported book? A re-import REPLACES it (saveImportedContacts writes one keyed
  // record — latest export wins), so repeated uploads don't accumulate. We just surface that so it's not a
  // surprise. Owner-logged meetings/opportunities/edits live in their own stores and are kept.
  const [hasExisting, setHasExisting] = useState(false);

  useEffect(() => {
    if (result && scoreable) aiAvailable().then(setAiOn);
  }, [result, scoreable]);

  useEffect(() => {
    if (!demo) hasImportedContacts().then(setHasExisting);
  }, [demo]);

  // Auto-start the background analysis once, as soon as we know AI is available and there's something to score.
  useEffect(() => {
    if (result && scoreable && aiOn) void startWarmthAnalysis();
  }, [result, scoreable, aiOn]);

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
      // Re-import: carry the warmth/opportunity scans over for URL-matched contacts so refreshing the
      // book with a newer export doesn't wipe hours of analysis (the fresh import still supplies the
      // up-to-date funnel/messages). owned-mode only — the demo book isn't imported.
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
      <div className="imp-modal" onClick={(e) => e.stopPropagation()}>
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
            <p className="imp-privacy">🔒 Everything stayed on this computer — nothing was uploaded.</p>
            {scoreable > 0 && (
              <div className="imp-warmth">
                {aiOn ? (
                  <p className="imp-warmth-lead">✨ Analysing the tone of {scoreable.toLocaleString()} message threads to rank your leads by how keen each contact <em>actually</em> was — running in the background. <strong>Open your book and keep working</strong>; progress shows at the top.</p>
                ) : aiOn === false ? (
                  <p className="imp-warmth-note">Set up AI to rank your leads by the tone of your message threads — you can start this any time from your book.</p>
                ) : null}
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
              <p className="imp-replace-note">This replaces your current imported book — your logged meetings, opportunities and edits are kept.</p>
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
