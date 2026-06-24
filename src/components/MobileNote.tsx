// The device-gated "best on a laptop" nudge (CSS shows it only on html.is-mobile). Mirrors
// Freehold's mobile pattern: the full data-owning app is desktop-only (File System Access), so on
// a phone you browse read-optimised and open on a laptop to edit + connect your data file.

import { useState } from "react";

export default function MobileNote() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="mobile-note">
      <span>
        📱 <strong>Best on a laptop.</strong> Business Book runs fully on desktop, where your data
        lives in a file you own. Browse here — open on your laptop to edit and connect your data.
      </span>
      <button className="mobile-note-x" aria-label="Dismiss" onClick={() => setDismissed(true)}>
        ×
      </button>
    </div>
  );
}
