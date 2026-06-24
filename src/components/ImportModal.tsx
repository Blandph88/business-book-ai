// "Import your LinkedIn" modal. Mode-aware:
//   • demo  → explains the LinkedIn export + on-device privacy promise ("real importer once you own it").
//   • owned → a real file picker for Connections.csv (+ optional messages.csv), parses + classifies +
//             saves the buyer's network entirely in the browser, then reloads into the owned app.

import { useState } from "react";
import { getAppMode } from "../lib/appMode";
import { importLinkedIn, type ImportResult } from "../data/linkedinImport";
import { saveImportedContacts } from "../storage/importedContacts";
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

export function ImportModal({ onClose }: { onClose: () => void }) {
  const demo = getAppMode() === "demo";
  const [conn, setConn] = useState<File | null>(null);
  const [msgs, setMsgs] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

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
      await saveImportedContacts(res.contacts);
      setResult(res);
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
            <button className="imp-btn imp-btn-primary" onClick={() => location.reload()}>Open my book of business</button>
          </div>
        ) : (
          <div className="imp-body">
            <p className="imp-lead">
              Upload the files from your LinkedIn data export. They're read <strong>on your computer</strong> — nothing is sent anywhere.
            </p>
            <Steps />
            <div className="imp-pick">
              <FilePick label="Connections.csv" required file={conn} onPick={setConn} />
              <FilePick label="messages.csv" hint="adds your outreach funnel" file={msgs} onPick={setMsgs} />
            </div>
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
