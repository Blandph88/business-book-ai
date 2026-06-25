// A slim "This week" strip for the top of the Overview (the home/network view). It surfaces the
// same agenda the Dashboard owns — how many actions are due (and how many overdue) — and links
// straight to the Dashboard, so the daily action list stays one click away from the home charts.
import { useEffect, useState } from "react";
import { loadContacts } from "../data/contacts";
import { loadAllMeetings } from "../storage/meetings";
import { loadAllOpportunities } from "../storage/opportunities";
import { loadAllSows } from "../storage/revenue";
import { buildMeetingRows } from "../data/meetings";
import { buildAgenda, todayISO } from "../data/agenda";
import type { Navigate } from "./TabNav";
import "./WeekStrip.css";

export function WeekStrip({ onNavigate }: { onNavigate?: Navigate }) {
  const [count, setCount] = useState<number | null>(null);
  const [overdue, setOverdue] = useState(0);

  useEffect(() => {
    const meetings = loadAllMeetings();
    const opps = Object.values(loadAllOpportunities());
    const sows = Object.values(loadAllSows());
    loadContacts()
      .then((rows) => {
        const agenda = buildAgenda(buildMeetingRows(rows, meetings), opps, todayISO(), sows);
        setCount(agenda.length);
        setOverdue(agenda.filter((a) => a.overdue).length);
      })
      .catch(() => setCount(0));
  }, []);

  if (count === null) return null; // don't flash an empty bar before the agenda loads

  return (
    <button
      type="button"
      className="week-strip"
      onClick={() => onNavigate?.("dashboard")}
      title="Open your Dashboard"
    >
      <span className="week-strip-cal" aria-hidden="true">📅</span>
      <span className="week-strip-text">
        <strong>This week</strong>
        {count === 0 ? (
          <span className="week-strip-sub">You’re all caught up — nothing due.</span>
        ) : (
          <span className="week-strip-sub">
            {count} to action{overdue > 0 ? ` · ${overdue} overdue` : ""}
          </span>
        )}
      </span>
      <span className="week-strip-cta">Open Dashboard →</span>
    </button>
  );
}
