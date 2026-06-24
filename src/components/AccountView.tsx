import { useEffect, useMemo, useState } from "react";
import "./AccountView.css";
import { loadContacts, type Contact } from "../data/contacts";
import { loadAllMeetings, type MeetingsById } from "../storage/meetings";
import {
  loadAllOpportunities,
  type Opportunity,
} from "../storage/opportunities";
import { loadAllSows, type Sow } from "../storage/revenue";
import { contractedRevenue } from "../data/revenue";
import { buildMeetingRows, type MeetingRow } from "../data/meetings";
import {
  opportunityContact,
  opportunityStatus,
  opportunityPhase,
  openWeightedPipeline,
  weightedValue,
} from "../data/opportunities";
import { formatMoney } from "../data/format";
import { ContactLinks } from "./BrandIcons";
import type { Navigate } from "./TabNav";

// A read-only "account" overlay for one organisation: everyone we know there, every
// meeting held/planned with them, and every opportunity in their name — the institution
// view, since the owner sells into institutions, not just individuals. Opened by clicking
// an organisation name anywhere (a form subtitle or a table cell). Every row deep-links
// into the relevant tab (filtered + form open) and closes the overlay on the way.
//
// It loads its own snapshot of the data (contacts CSV + saved meetings/opps) on mount, so
// it stays a self-contained component the App can drop in without threading data down.

// Cap the people list in the overlay — a big firm (e.g. EY) can have thousands of contacts;
// the overlay is a summary, so we show the first N and link out to the full filtered Contacts.
const PEOPLE_CAP = 50;

// The single most relevant date to show for a meeting row: latest milestone reached.
function meetingDate(m: MeetingRow): string {
  return m.date_held || m.date_scheduled || m.date_agreed || "—";
}

export function AccountView({
  org,
  onNavigate,
  onClose,
}: {
  // The exact organisation string to gather (matches the value stored on contacts/opps).
  org: string;
  // Deep-link into a tab. The App wraps this to also close the overlay.
  onNavigate: Navigate;
  onClose: () => void;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [meetings, setMeetings] = useState<MeetingsById>({});
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [sows, setSows] = useState<Sow[]>([]);

  useEffect(() => {
    setMeetings(loadAllMeetings());
    setOpps(Object.values(loadAllOpportunities()));
    setSows(Object.values(loadAllSows()));
    loadContacts()
      .then(setContacts)
      .catch(() => setContacts([]));
  }, []);

  // Escape closes the overlay (same as the ✕ / backdrop).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The three filtered lists for this org, recomputed when the data lands.
  const people = useMemo(
    () => contacts.filter((c) => c.organisation === org),
    [contacts, org],
  );
  const meetingRows = useMemo(
    () =>
      buildMeetingRows(contacts, meetings).filter(
        (m) => m.contactInfo.organisation === org,
      ),
    [contacts, meetings, org],
  );
  const orgOpps = useMemo(() => {
    const byUrl = new Map(contacts.map((c) => [c.url, c]));
    return opps.filter((o) => {
      // An opp belongs to this org by its own organisation, or via its linked contact.
      const viaContact = opportunityContact(o, byUrl, meetings)?.organisation;
      return o.organisation === org || viaContact === org;
    });
  }, [opps, contacts, meetings, org]);

  const orgSows = useMemo(
    () => sows.filter((s) => s.organisation === org),
    [sows, org],
  );

  // The open weighted pipeline for this account (Won/Lost excluded — see §6 rule 4).
  const pipeline = openWeightedPipeline(orgOpps);

  return (
    <div className="mform-backdrop" onClick={onClose}>
      <aside
        className="mform-panel account-panel"
        role="dialog"
        aria-label={`${org} account`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mform-header">
          <div>
            <h3 className="mform-title">{org || "Account"}</h3>
            <p className="mform-subtitle">
              {people.length} {people.length === 1 ? "person" : "people"} ·{" "}
              {meetingRows.length}{" "}
              {meetingRows.length === 1 ? "meeting" : "meetings"} ·{" "}
              {orgOpps.length}{" "}
              {orgOpps.length === 1 ? "opportunity" : "opportunities"}
              {pipeline > 0 ? ` · ${formatMoney(pipeline)} open pipeline` : ""}
            </p>
          </div>
          <button
            type="button"
            className="mform-close"
            title="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="mform-body">
          {/* ── People at this org ──────────────────────────────────────── */}
          <section className="account-section">
            <h4 className="account-heading">People ({people.length})</h4>
            {people.length === 0 ? (
              <p className="account-empty">No contacts at this organisation.</p>
            ) : (
              <ul className="account-list">
                {people.slice(0, PEOPLE_CAP).map((c) => (
                  <li key={c.url}>
                    <button
                      type="button"
                      className="account-row"
                      onClick={() => onNavigate("contacts", { openId: c.url })}
                    >
                      <span className="account-row-main">
                        {`${c.first} ${c.last}`.trim()}
                      </span>
                      <span className="account-row-meta">
                        {[c.seniority, c.function].filter(Boolean).join(" · ") ||
                          "—"}
                      </span>
                    </button>
                    <ContactLinks url={c.url} phone={c.phone} />
                  </li>
                ))}
                {people.length > PEOPLE_CAP && (
                  <li className="account-more">
                    <button
                      type="button"
                      className="account-more-btn"
                      onClick={() => onNavigate("contacts", { search: org })}
                    >
                      View all {people.length.toLocaleString()} people in Contacts →
                    </button>
                  </li>
                )}
              </ul>
            )}
          </section>

          {/* ── Meetings with this org ──────────────────────────────────── */}
          <section className="account-section">
            <h4 className="account-heading">
              Meetings ({meetingRows.length})
            </h4>
            {meetingRows.length === 0 ? (
              <p className="account-empty">No meetings logged yet.</p>
            ) : (
              <ul className="account-list">
                {meetingRows.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="account-row"
                      onClick={() => onNavigate("meetings", { openId: m.id })}
                    >
                      <span className="account-row-main">
                        {m.contactInfo.name}
                        <span className="account-row-no"> · #{m.meeting_no}</span>
                      </span>
                      <span className="account-row-meta">
                        {(m.meeting_stage || "—") + " · " + meetingDate(m)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Opportunities in this org's name ────────────────────────── */}
          <section className="account-section">
            <h4 className="account-heading">
              Opportunities ({orgOpps.length})
            </h4>
            {orgOpps.length === 0 ? (
              <p className="account-empty">No opportunities yet.</p>
            ) : (
              <ul className="account-list">
                {orgOpps.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      className="account-row"
                      onClick={() =>
                        onNavigate("opportunities", { openId: o.id })
                      }
                    >
                      <span className="account-row-main">
                        {o.opportunity_name || "(unnamed)"}
                      </span>
                      <span className="account-row-meta">
                        {opportunityPhase(o)} · {opportunityStatus(o)} ·{" "}
                        {formatMoney(weightedValue(o))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Signed work (SoWs) at this org ──────────────────────────── */}
          {orgSows.length > 0 && (
            <section className="account-section">
              <h4 className="account-heading">
                Contracts ({orgSows.length})
              </h4>
              <ul className="account-list">
                {orgSows.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="account-row"
                      onClick={() => onNavigate("revenue", { openId: s.id })}
                    >
                      <span className="account-row-main">
                        {s.engagement_name || "(unnamed)"}
                      </span>
                      <span className="account-row-meta">
                        {s.status} · {formatMoney(contractedRevenue(s))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
