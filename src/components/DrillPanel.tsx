// The drill-down slide-in panel for the Dashboard.
//
// It's a presentational shell: a dimmed backdrop + a panel that slides in from the
// right (the same pattern as the Meetings detail view). The Dashboard decides WHAT
// goes inside — a detailed matrix, a list of contacts, or a list of opportunities —
// and passes it as children. The shell only handles the chrome: title, an optional
// Back button (used when a matrix drills down into contacts), and closing via the X,
// the Esc key, or a backdrop click.

import { useEffect, useMemo } from "react";
import type { Contact } from "../data/contacts";
import type { Opportunity } from "../storage/opportunities";
import { weightedValue, opportunityStatus, opportunityPhase } from "../data/opportunities";
import { formatMoney } from "../data/format";
import { ContactLinks } from "./BrandIcons";
import { SENIORITY } from "../data/vocab";
import { TableControls } from "./TableControls";
import { useTableControls, type ControlsConfig } from "../data/tableControls";
import "./DrillPanel.css";

// Below this many contacts a drill-down list is short enough to scan by eye, so we
// skip the search/filter toolbar to keep small selections clean.
const DRILL_CONTROLS_THRESHOLD = 8;

type DrillPanelProps = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onBack?: () => void; // shown when there's a level to go back to (matrix → contacts)
  children: React.ReactNode;
};

export function DrillPanel({
  title,
  subtitle,
  onClose,
  onBack,
  children,
}: DrillPanelProps) {
  // Close on Esc — registered once while the panel is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="drill-backdrop" onClick={onClose}>
      {/* Stop propagation so clicks inside the panel don't close it. */}
      <aside
        className="drill-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <header className="drill-head">
          {onBack && (
            <button
              type="button"
              className="drill-back"
              onClick={onBack}
              aria-label="Back"
            >
              ‹ Back
            </button>
          )}
          <div className="drill-titles">
            <h3 className="drill-title">{title}</h3>
            {subtitle && <p className="drill-sub">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="drill-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="drill-body">{children}</div>
      </aside>
    </div>
  );
}

// ── Wide modal ───────────────────────────────────────────────────────────────
// Same chrome as DrillPanel (title, optional Back, close via X / Esc / backdrop) but
// CENTRED and wide, for content that needs horizontal room — e.g. the org × function
// matrix, which has too many columns for the right-hand slide-in.
export function Modal({
  title,
  subtitle,
  onClose,
  onBack,
  children,
}: DrillPanelProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-box"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <header className="drill-head">
          {onBack && (
            <button
              type="button"
              className="drill-back"
              onClick={onBack}
              aria-label="Back"
            >
              ‹ Back
            </button>
          )}
          <div className="drill-titles">
            <h3 className="drill-title">{title}</h3>
            {subtitle && <p className="drill-sub">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="drill-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ── Contact list ─────────────────────────────────────────────────────────────
// One compact card per contact: name, role, where they sit, and the funnel flags
// they've reached. The LinkedIn link reuses the contact's url.
export function ContactList({
  contacts,
  onOpenAccount,
  onOpen,
}: {
  contacts: Contact[];
  // Clicking an organisation name opens its "account" overlay.
  onOpenAccount?: (org: string) => void;
  // Clicking a contact card opens that record (the parent decides contact vs meeting).
  onOpen?: (c: Contact) => void;
}) {
  // Function isn't a fixed vocabulary, so derive the filter's options from whatever
  // functions appear in THIS selection (sorted, blanks dropped).
  const functionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of contacts) if (c.function) set.add(c.function);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [contacts]);

  // Search / filter / sort just for this drill-down list. Rebuilt only when the
  // derived function options change.
  const config = useMemo<ControlsConfig<Contact>>(
    () => ({
      searchPlaceholder: "Search this list…",
      searchText: (c) => `${c.first} ${c.last} ${c.organisation} ${c.position}`,
      filters: [
        { key: "seniority", label: "Seniority", options: SENIORITY, get: (c) => c.seniority },
        { key: "function", label: "Function", options: functionOptions, get: (c) => c.function },
      ],
      sorts: [
        { key: "name", label: "Name", get: (c) => `${c.first} ${c.last}` },
        { key: "seniority", label: "Seniority", get: (c) => SENIORITY.indexOf(c.seniority as (typeof SENIORITY)[number]) },
      ],
      defaultSortKey: "name",
    }),
    [functionOptions],
  );

  const { filtered, controlsProps } = useTableControls(contacts, config);

  if (contacts.length === 0) {
    return <p className="drill-empty">No contacts in this selection.</p>;
  }

  // Only show the toolbar for selections big enough to be worth narrowing.
  const showControls = contacts.length > DRILL_CONTROLS_THRESHOLD;

  return (
    <>
      {showControls && <TableControls {...controlsProps} />}
      {filtered.length === 0 ? (
        <p className="drill-empty">No contacts match these filters.</p>
      ) : (
        <ul className="drill-list">
          {filtered.map((c) => {
            const clickable = !!onOpen;
            return (
        <li
          key={c.url}
          className={clickable ? "drill-contact drill-contact--click" : "drill-contact"}
          role={clickable ? "button" : undefined}
          tabIndex={clickable ? 0 : undefined}
          title={clickable ? "Open this record" : undefined}
          onClick={clickable ? () => onOpen!(c) : undefined}
          onKeyDown={
            clickable
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen!(c);
                  }
                }
              : undefined
          }
        >
          <div className="drill-contact-top">
            <span className="drill-contact-name">
              {c.first} {c.last}
              <ContactLinks url={c.url} phone={c.phone} />
              {clickable && <span className="drill-go"> →</span>}
            </span>
          </div>
          <div className="drill-contact-org">
            {c.position ? `${c.position} · ` : ""}
            {onOpenAccount && c.organisation ? (
              <button
                type="button"
                className="org-link"
                title="View this organisation’s account"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenAccount(c.organisation);
                }}
              >
                {c.organisation}
              </button>
            ) : (
              c.organisation
            )}
          </div>
          <div className="drill-meta">
            <span className="drill-tag">{c.sector_detail || c.sector_group}</span>
            <span className="drill-tag">{c.seniority}</span>
            <span className="drill-tag">{c.function}</span>
          </div>
          <div className="drill-flags">
            <Flag on={c.messaged} label="Messaged" />
            <Flag on={c.two_way} label="Responded" />
            <Flag on={c.agreed_to_meet} label="Agreed" />
          </div>
            </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={on ? "drill-flag drill-flag--on" : "drill-flag"}>
      {on ? "✓" : "–"} {label}
    </span>
  );
}

// ── Opportunity list ─────────────────────────────────────────────────────────
// Used when a pipeline-stage / breakdown bar is clicked. Weighted value is computed,
// never stored (§6 rule 4) — same helper the rest of the app uses. When
// `onOpenOpportunity` is supplied each card is clickable and jumps to that opportunity
// on the Opportunities tab (filtered, with its form open).
export function OpportunityList({
  opps,
  onOpenOpportunity,
  onOpenAccount,
}: {
  opps: Opportunity[];
  onOpenOpportunity?: (id: string) => void;
  // Clicking an organisation name opens its "account" overlay.
  onOpenAccount?: (org: string) => void;
}) {
  if (opps.length === 0) {
    return <p className="drill-empty">No opportunities in this stage.</p>;
  }
  return (
    <ul className="drill-list">
      {opps.map((o) => {
        const clickable = !!onOpenOpportunity;
        return (
          <li
            key={o.id}
            className={
              clickable ? "drill-contact drill-contact--click" : "drill-contact"
            }
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            title={clickable ? "Open this opportunity" : undefined}
            onClick={clickable ? () => onOpenOpportunity!(o.id) : undefined}
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenOpportunity!(o.id);
                    }
                  }
                : undefined
            }
          >
            <div className="drill-contact-top">
              <span className="drill-contact-name">
                {o.opportunity_name}
                {clickable && <span className="drill-go"> →</span>}
              </span>
              <span className="drill-tag">{opportunityStatus(o)}</span>
            </div>
            <div className="drill-contact-org">
              {onOpenAccount && o.organisation ? (
                <button
                  type="button"
                  className="org-link"
                  title="View this organisation’s account"
                  onClick={(e) => {
                    // Don't also trigger the card's "open opportunity" click.
                    e.stopPropagation();
                    onOpenAccount(o.organisation);
                  }}
                >
                  {o.organisation}
                </button>
              ) : (
                o.organisation
              )}
              {o.primary_contact ? ` · ${o.primary_contact}` : ""}
            </div>
            <div className="drill-meta">
              <span className="drill-tag">{opportunityPhase(o)}</span>
              <span className="drill-tag">{o.service_line}</span>
              <span className="drill-tag">Est {formatMoney(o.est_value)}</span>
              <span className="drill-tag">
                Weighted {formatMoney(weightedValue(o))}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
