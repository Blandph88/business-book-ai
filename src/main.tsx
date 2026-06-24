import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { bootstrapSeedMinutes } from "./data/importMinutes";
import { bootstrapSeedExtras } from "./data/seedExtras";
import { resetDemoIfStale } from "./data/resetDemo";
import { applyDeviceClass } from "./lib/device";
import { getAppMode } from "./lib/appMode";

// Device-gate the mobile shell (phones/tablets only) before first paint.
applyDeviceClass();

// React entry point. Mounts <App /> into the #root div in index.html.
// StrictMode is a dev-only helper that surfaces common mistakes early.
function render() {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

// Startup order matters, and it all runs BEFORE the tabs mount (so each tab's
// mount-time loadAll*() sees the final state):
//   1. hydrateFromDisk() — restore owner data from data/owner_data.json if the browser
//      is missing it (recovers a cleared/fresh browser), then re-seed the file.
//   2. bootstrapSeedMinutes() — merge any compiled minutes (web/public/seed_meetings.json)
//      into the local stores, non-destructively, once per minute.
// Both are best-effort: if either can't reach its source the app still boots.
//   1. bootstrapSeedMinutes() — meetings + opportunities (public/seed_meetings.json).
//   2. bootstrapSeedExtras()  — SoWs + owner-edits (public/seed_extras.json).
// Both are best-effort: if either can't reach its source the app still boots.
// Demo mode applies the baked-in sample seeds; owned mode boots clean to the buyer's own
// imported data (no demo meetings/opps/SoWs). resetDemoIfStale() runs first so a changed demo
// dataset wipes the old (now-orphaned) demo rows before the fresh seed lands.
const seeded =
  getAppMode() === "demo"
    ? Promise.resolve()
        .then(resetDemoIfStale)
        .then(bootstrapSeedMinutes)
        .then(bootstrapSeedExtras)
    : Promise.resolve();
void seeded.finally(render);
