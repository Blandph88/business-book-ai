import { useEffect, useMemo, useRef, useState } from "react";
import "./ContactsTab.css";
import { loadContacts, type Contact } from "../data/contacts";
import {
  loadAllEdits,
  saveEdits,
  editsFor,
  type OwnerEdits,
} from "../storage/ownerEdits";
import { loadAllMeetings, type MeetingsById } from "../storage/meetings";
import {
  loadAllOpportunities,
  type Opportunity,
} from "../storage/opportunities";
import { buildMeetingRows, type MeetingRow } from "../data/meetings";
import { warmthCell, warmthLabel, WARMTH_LEVELS } from "../ai/compute";
import {
  RELATIONSHIP_STRENGTH,
  PRIORITY,
  SENIORITY,
  SECTOR_GROUPS,
} from "../data/vocab";
import type { TabIntent, Navigate } from "../components/TabNav";
import { TableControls } from "../components/TableControls";
import { ColumnHeader } from "../components/ColumnHeader";
import {
  useTableControls,
  type ControlsConfig,
  type ControlsInitial,
} from "../data/tableControls";
import { ContactForm, type ContactRow } from "./ContactForm";
import { NewContactForm } from "./NewContactForm";
import { type Option } from "./formControls";
import { StatsBar } from "../components/StatsBar";
import {
  LinkedInIcon,
  WhatsAppIcon,
  LinkedInCell,
  WhatsAppCell,
} from "../components/BrandIcons";
import { getAppMode } from "../lib/appMode";
import { useAiAvailable } from "../ai/ai";
import { countUnclassified } from "../ai/enrich";

const YESNO = ["Yes", "No"] as const;
const yn = (b: boolean) => (b ? "Yes" : "No");

// A real LinkedIn network can be 25k+ contacts. Rendering every row as a <tr> (×13 cells)
// locks up / crashes the tab, so we only mount a window of rows and grow it on demand.
// The search + per-column filters above are the primary way to find people; this cap just
// keeps the initial paint instant. The window resets whenever the filtered set changes.
const RENDER_BASE = 150;
const RENDER_STEP = 350;

// What the Contacts list can be searched, filtered, and sorted by. Every column header is
// click-to-sort; categorical dimensions are filtered from the toolbar dropdowns. Messaged /
// Responded / Agreed-to-meet appear BOTH as toolbar dropdowns and as headline stat-bar
// quick-filters (shared keys, so they stay in sync); only "Met" is stat-bar-only (toolbar:
// false). Filter options reuse the shared vocab constants so they can't drift.
// (`ContactRow` = a contact merged with its owner edits, defined in ./ContactForm.)
const CONTACTS_CONTROLS: ControlsConfig<ContactRow> = {
  searchPlaceholder: "Search name, organisation, position…",
  searchText: (c) => `${c.first} ${c.last} ${c.organisation} ${c.position}`,
  searchFields: [
    { key: "name", label: "Name", get: (c) => `${c.first} ${c.last}` },
    { key: "company", label: "Company", get: (c) => c.organisation ?? "" },
    { key: "title", label: "Title", get: (c) => c.position ?? "" },
  ],
  filters: [
    { key: "seniority", label: "Seniority", options: SENIORITY, get: (c) => c.seniority },
    { key: "sector_group", label: "Sector group", options: SECTOR_GROUPS, get: (c) => c.sector_group },
    { key: "relationship", label: "Relationship", options: RELATIONSHIP_STRENGTH, get: (c) => c.relationship_strength ?? "" },
    { key: "warmth", label: "Warmth", options: WARMTH_LEVELS, get: (c) => warmthLabel(c.warmthSentiment) }, // LLM message-tone; unscored won't match any level
    { key: "owed", label: "Owes reply", options: YESNO, get: (c) => (c.thread && !c.thread.lastFromOwner ? "Yes" : "No") }, // deterministic: they messaged last
    { key: "opportunity", label: "Opportunity spotted", options: YESNO, get: (c) => (c.latentOpp?.text ? "Yes" : "No") }, // a lead spotted in messages by the Opportunity scan (precursor to a pipeline opportunity)
    { key: "priority", label: "Priority", options: PRIORITY, get: (c) => c.priority ?? "" },
    // Messaged / Responded / Agreed-to-meet also get toolbar dropdowns (they share the same keys
    // as the headline stat-bar quick-filters, so a stat click and a dropdown stay in sync). Only
    // "Met" stays stat-bar-only (toolbar: false) to keep the toolbar from getting crowded.
    { key: "messaged", label: "Messaged", options: YESNO, get: (c) => yn(c.messaged) },
    { key: "responded", label: "Responded", options: YESNO, get: (c) => yn(c.two_way) },
    { key: "agreed", label: "Agreed to meet", options: YESNO, get: (c) => yn(c.agreed_to_meet) },
    { key: "met", label: "Met", options: YESNO, get: (c) => yn(c.met), toolbar: false },
  ],
  // Sort getters for EVERY column (clickable headers). Categorical orders follow §5.
  sorts: [
    { key: "name", label: "Name", get: (c) => `${c.first} ${c.last}` },
    { key: "organisation", label: "Organisation", get: (c) => c.organisation },
    { key: "position", label: "Position", get: (c) => c.position },
    { key: "seniority", label: "Seniority", get: (c) => SENIORITY.indexOf(c.seniority as (typeof SENIORITY)[number]) },
    { key: "sector_group", label: "Sector group", get: (c) => c.sector_group },
    { key: "relationship", label: "Relationship", get: (c) => RELATIONSHIP_STRENGTH.indexOf(c.relationship_strength as (typeof RELATIONSHIP_STRENGTH)[number]) },
    { key: "warmth", label: "Warmth", get: (c) => c.warmthSentiment?.score ?? -1 }, // LLM message-tone score; unscored sort last
    { key: "priority", label: "Priority", get: (c) => PRIORITY.indexOf(c.priority as (typeof PRIORITY)[number]) },
    { key: "next_action", label: "Next action", get: (c) => c.next_action ?? "" },
    { key: "next_action_date", label: "Next action date", get: (c) => c.next_action_date ?? "" },
    { key: "messaged", label: "Messaged", get: (c) => (c.messaged ? 1 : 0) },
    { key: "responded", label: "Responded", get: (c) => (c.two_way ? 1 : 0) },
    { key: "agreed", label: "Agreed", get: (c) => (c.agreed_to_meet ? 1 : 0) },
    { key: "met", label: "Met", get: (c) => (c.met ? 1 : 0) },
  ],
  defaultSortKey: "name",
};

// The funnel stats double as one-click filters (these are the filter keys they drive).
const CONTACT_FUNNEL_KEYS = ["messaged", "responded", "agreed", "met"] as const;

type Props = {
  // Optional cross-tab deep link (e.g. from a Dashboard click): preset a filter/search
  // and/or open a specific contact's form on arrival.
  intent?: TabIntent | null;
  // Jump to another tab (used by the form's links to this contact's meetings / opps).
  onNavigate?: Navigate;
  // Open the organisation "account" overlay (clicking an org name).
  onOpenAccount?: (org: string) => void;
  // Called when the user finishes with a form (Save OR close) — lets App return to the
  // Dashboard/Metrics tab it was reached from. No-ops when there's no such origin, so a
  // form opened from within this tab just stays put.
  onReturn?: () => void;
  // Open the global "Import your LinkedIn" modal (owned by App).
  onImport?: () => void;
};

// The Contacts tab (CLAUDE.md §4): the universe of contacts.
//
// Layout (matching the Meetings/Opportunities tabs): a READ-ONLY, scannable summary
// table. Clicking a row opens a slide-in panel (./ContactForm.tsx) where the owner's
// CRM fields are actually edited — the form buffers edits and only persists on Save.
export function ContactsTab({
  intent,
  onNavigate,
  onOpenAccount,
  onReturn,
  onImport,
}: Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [edits, setEdits] = useState<Record<string, OwnerEdits>>({});
  // Saved meetings + opportunities, loaded so the form can show each contact's linked
  // records inline (and their counts on the header links).
  const [meetings, setMeetings] = useState<MeetingsById>({});
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [errorMsg, setErrorMsg] = useState("");

  // "Saved ✓" flash after a save, so the owner can see persistence happened.
  const [justSaved, setJustSaved] = useState(false);

  // Company sector-classification is an AI enrichment SCAN — it lives in the Insights hub now (explainer
  // modal + background banner + single-slot runner, so it can't collide with the warmth/opportunity scans).
  // Here we just surface the unclassified count contextually and point there.
  const aiReady = useAiAvailable();
  const owned = getAppMode() === "owned";
  const unclassified = useMemo(() => countUnclassified(contacts), [contacts]);

  // The currently-open contact panel, or null when closed.
  const [formTarget, setFormTarget] = useState<ContactRow | null>(null);
  // Whether the "add a new contact" slide-in is open.
  const [addingContact, setAddingContact] = useState(false);

  // Reload contacts + edits from storage (after adding a manual contact).
  function reloadContacts() {
    loadContacts().then((rows) => { setContacts(rows); setEdits(loadAllEdits()); }).catch(() => {});
  }
  // Organisations already in the book, for the new-contact org picker (free-text adds a new one).
  const orgOptions = useMemo<Option[]>(
    () => [...new Set(contacts.map((c) => c.organisation?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)).map((o) => ({ value: o, label: o })),
    [contacts],
  );

  // Load the CSV and any previously saved edits once, on mount.
  useEffect(() => {
    loadContacts()
      .then((rows) => {
        setContacts(rows);
        setEdits(loadAllEdits());
        setMeetings(loadAllMeetings());
        setOpps(Object.values(loadAllOpportunities()));
        setStatus("ready");
      })
      .catch((err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
  }, []);

  // Persist one contact's edits (the whole buffered object) and refresh state.
  function handleSave(url: string, next: OwnerEdits) {
    setEdits(saveEdits(url, next));
    setFormTarget(null);
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 1200);
    onReturn?.();
  }

  // Each contact's meetings, from the SAME row builder the Meetings tab uses (so it
  // includes the virtual seed an agreed-to-meet contact starts with — matching what the
  // "Meetings →" link shows). The form lists these inline and uses the length as a badge.
  const meetingsByUrl = useMemo(() => {
    const map: Record<string, MeetingRow[]> = {};
    for (const m of buildMeetingRows(contacts, meetings)) {
      (map[m.contact_url] ??= []).push(m);
    }
    return map;
  }, [contacts, meetings]);

  // Merge each contact with its owner edits so the controls can filter/sort on both and the
  // summary row can show both. `met` is DERIVED here (the pipeline flag OR a held meeting) so
  // the "Met" stat and its click-to-filter share one definition.
  const rows = useMemo<ContactRow[]>(
    () =>
      contacts.map((c) => ({
        ...c,
        ...editsFor(edits, c.url),
        met: c.met || (meetingsByUrl[c.url] ?? []).some((m) => !!m.date_held),
      })),
    [contacts, edits, meetingsByUrl],
  );

  // Each contact's opportunities: by the opp's own contact_url, else via its source
  // meeting's contact (mirrors how the Opportunities tab resolves the link).
  const oppsByUrl = useMemo(() => {
    const map: Record<string, Opportunity[]> = {};
    for (const o of opps) {
      const url =
        o.contact_url ??
        (o.source_meeting_id
          ? meetings[o.source_meeting_id]?.contact_url
          : undefined);
      if (url) (map[url] ??= []).push(o);
    }
    return map;
  }, [opps, meetings]);

  // Funnel counts (from the FULL set, so they stay fixed as you filter).
  const funnelCounts = useMemo(
    () => ({
      contacts: rows.length,
      messaged: rows.filter((c) => c.messaged).length,
      responded: rows.filter((c) => c.two_way).length,
      agreed: rows.filter((c) => c.agreed_to_meet).length,
      met: rows.filter((c) => c.met).length,
    }),
    [rows],
  );

  // Seed the controls from a deep-link intent (search + one filter), applied on mount.
  const initial = useMemo<ControlsInitial | undefined>(
    () =>
      intent
        ? {
            query: intent.search,
            searchField: intent.searchField,
            filters: (() => {
              const f: Record<string, string> = {};
              if (intent.filter) f[intent.filter.key] = intent.filter.value;
              for (const x of intent.filters ?? []) f[x.key] = x.value;
              return Object.keys(f).length ? f : undefined;
            })(),
          }
        : undefined,
    [intent],
  );

  // Search / filter / sort state and the rows to actually render.
  const { filtered, controlsProps } = useTableControls(
    rows,
    CONTACTS_CONTROLS,
    initial,
  );

  // The funnel stats are one-click filters: clicking a stage filters the list to it (and
  // clears the other funnel stages); "Contacts" clears them back to the whole network. The
  // applied stage renders active (highlighted, not clickable).
  const activeFunnel =
    CONTACT_FUNNEL_KEYS.find((k) => controlsProps.filterValues[k] === "Yes") ?? null;
  const selectFunnel = (key: (typeof CONTACT_FUNNEL_KEYS)[number] | null) => {
    for (const k of CONTACT_FUNNEL_KEYS) controlsProps.setFilter(k, k === key ? "Yes" : "");
  };
  const stats = [
    { label: "Contacts", value: funnelCounts.contacts, onSelect: () => selectFunnel(null), active: activeFunnel === null },
    { label: "Messaged", value: funnelCounts.messaged, onSelect: () => selectFunnel("messaged"), active: activeFunnel === "messaged" },
    { label: "Responded", value: funnelCounts.responded, onSelect: () => selectFunnel("responded"), active: activeFunnel === "responded" },
    { label: "Agreed to meet", value: funnelCounts.agreed, onSelect: () => selectFunnel("agreed"), active: activeFunnel === "agreed" },
    { label: "Met", value: funnelCounts.met, onSelect: () => selectFunnel("met"), active: activeFunnel === "met" },
  ];

  // Cap how many rows we mount (see RENDER_BASE). Reset to the base whenever the filtered
  // set changes (new search/filter/sort) so a fresh query starts from the top.
  const [renderLimit, setRenderLimit] = useState(RENDER_BASE);
  useEffect(() => setRenderLimit(RENDER_BASE), [filtered]);
  const shown = useMemo(
    () => filtered.slice(0, renderLimit),
    [filtered, renderLimit],
  );
  const hiddenCount = filtered.length - shown.length;

  // Open the contact named by a deep link, once data has loaded. We remember the last
  // intent we acted on (not just "have we opened anything?") so a NEW deep link — e.g.
  // clicking a person in the account overlay while already on this tab — re-opens, rather
  // than being blocked by a one-shot guard. App makes a fresh intent object per navigate,
  // so an identity check is enough.
  const handledIntent = useRef<TabIntent | null>(null);
  useEffect(() => {
    if (!intent?.openId || intent === handledIntent.current || rows.length === 0)
      return;
    const row = rows.find((r) => r.url === intent.openId);
    if (row) {
      setFormTarget(row);
      // Filter the list to just this contact so the opened row stands alone.
      if (!intent.search) controlsProps.setQuery(`${row.first} ${row.last}`.trim());
      handledIntent.current = intent;
    }
  }, [rows, intent, controlsProps]);

  if (status === "loading") {
    return <p className="contacts-status">Loading contacts…</p>;
  }

  if (status === "error") {
    return (
      <div className="contacts-status contacts-status--error">
        <p>Couldn’t load contacts.</p>
        <p className="contacts-error-detail">{errorMsg}</p>
      </div>
    );
  }

  // Owned copy with nothing imported yet → an empty state that invites the import.
  if (getAppMode() === "owned" && contacts.length === 0) {
    return (
      <section className="contacts">
        <div className="contacts-empty">
          <h2>Import your LinkedIn network</h2>
          <p>
            Turn your LinkedIn connections &amp; messages into a working book of business —
            classified, searchable, and read entirely on your computer.
          </p>
          <button className="imp-btn imp-btn-primary" onClick={onImport}>
            ⬆ Import your LinkedIn
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="contacts">
      <div className="contacts-toolbar">
        <h2>Contacts</h2>
        <span className="contacts-count">{contacts.length} contacts</span>
        <button type="button" className="mform-secondary" onClick={() => setAddingContact(true)}>
          + Add contact
        </button>
        <span
          className={
            justSaved
              ? "contacts-saved contacts-saved--on"
              : "contacts-saved"
          }
        >
          Saved ✓
        </span>
        {aiReady && owned && unclassified > 0 && (
          <span className="contacts-enrich">
            <button type="button" className="mform-secondary" onClick={() => onNavigate?.("insights")}>
              Classify {unclassified.toLocaleString()} unknown firms →
            </button>
          </span>
        )}
      </div>

      <p className="contacts-hint">
        Pipeline data comes from the LinkedIn export and is read-only. Click any row
        to open it and maintain your own CRM fields — changes save when you press Save
        and survive a reload. Search and use the filters above to narrow the list; click a
        column header to sort.
      </p>

      <StatsBar stats={stats} />

      <TableControls {...controlsProps} />

      <div className="contacts-table-wrap">
        <table className="contacts-table">
          <thead>
            <tr>
              <th className="cell-icon-head" title="LinkedIn"><LinkedInIcon /></th>
              <th className="cell-icon-head" title="WhatsApp"><WhatsAppIcon /></th>
              <ColumnHeader label="Name" controls={controlsProps} sortKey="name" />
              <ColumnHeader label="Organisation" controls={controlsProps} sortKey="organisation" />
              <ColumnHeader label="Position" controls={controlsProps} sortKey="position" />
              <ColumnHeader label="Seniority" controls={controlsProps} sortKey="seniority" />
              <ColumnHeader label="Sector group" controls={controlsProps} sortKey="sector_group" />
              <ColumnHeader label="Relationship" controls={controlsProps} sortKey="relationship" />
              <ColumnHeader label="Warmth" controls={controlsProps} sortKey="warmth" />
              <ColumnHeader label="Priority" controls={controlsProps} sortKey="priority" />
              <ColumnHeader label="Next action" controls={controlsProps} sortKey="next_action" />
              <ColumnHeader label="Next action date" controls={controlsProps} sortKey="next_action_date" />
              <ColumnHeader label="Messaged" controls={controlsProps} sortKey="messaged" />
              <ColumnHeader label="Responded" controls={controlsProps} sortKey="responded" />
              <ColumnHeader label="Agreed?" controls={controlsProps} sortKey="agreed" />
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr
                key={c.url}
                className="contacts-row"
                role="button"
                tabIndex={0}
                onClick={() => setFormTarget(c)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setFormTarget(c);
                  }
                }}
              >
                <LinkedInCell url={c.url} />
                <WhatsAppCell phone={c.phone} />
                <td>{`${c.first} ${c.last}`.trim()}</td>
                <td>
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
                </td>
                <td>{c.position}</td>
                <td>{c.seniority}</td>
                <td>{c.sector_group}</td>
                <td>{c.relationship_strength || "—"}</td>
                <td>{warmthCell(c)}</td>
                <td>{c.priority || "—"}</td>
                <td>{c.next_action || "—"}</td>
                <td>{c.next_action_date || "—"}</td>
                <td className="cell-bool">{c.messaged ? "Yes" : "—"}</td>
                <td className="cell-bool">{c.two_way ? "Yes" : "—"}</td>
                <td className="cell-bool">{c.agreed_to_meet ? "Yes" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hiddenCount > 0 && (
        <div className="contacts-more">
          <span>
            Showing {shown.length.toLocaleString()} of{" "}
            {filtered.length.toLocaleString()}. Use the search box or column filters
            above to narrow down
            {filtered.length === rows.length ? " your whole network" : ""}.
          </span>
          <button
            type="button"
            className="contacts-more-btn"
            onClick={() => setRenderLimit((n) => n + RENDER_STEP)}
          >
            Show {Math.min(RENDER_STEP, hiddenCount).toLocaleString()} more
          </button>
        </div>
      )}

      {formTarget && (
        <ContactForm
          contact={formTarget}
          // The raw pipeline number (auto-extracted) vs the owner's manual override,
          // passed separately so the form edits only the override (see ContactForm).
          pipelinePhone={
            contacts.find((c) => c.url === formTarget.url)?.phone ?? ""
          }
          ownerPhone={editsFor(edits, formTarget.url)?.phone}
          meetingCount={meetingsByUrl[formTarget.url]?.length ?? 0}
          oppCount={oppsByUrl[formTarget.url]?.length ?? 0}
          meetings={meetingsByUrl[formTarget.url] ?? []}
          opportunities={oppsByUrl[formTarget.url] ?? []}
          lastMet={
            (meetingsByUrl[formTarget.url] ?? [])
              .map((m) => m.date_held)
              .filter((d): d is string => Boolean(d))
              .sort()
              .pop()
          }
          met={(meetingsByUrl[formTarget.url] ?? []).some((m) => !!m.date_held)}
          onSave={handleSave}
          onOpenMeetings={
            onNavigate
              ? () =>
                  onNavigate("meetings", {
                    search: `${formTarget.first} ${formTarget.last}`.trim(),
                  })
              : undefined
          }
          onOpenOpportunities={
            onNavigate
              ? () =>
                  onNavigate("opportunities", {
                    search: `${formTarget.first} ${formTarget.last}`.trim(),
                  })
              : undefined
          }
          // Open one specific linked meeting / opportunity from the inline lists.
          onOpenMeeting={
            onNavigate ? (id) => onNavigate("meetings", { openId: id }) : undefined
          }
          onOpenOpportunity={
            onNavigate
              ? (id) => onNavigate("opportunities", { openId: id })
              : undefined
          }
          // Shortcuts: create a new meeting / opportunity already linked to this contact.
          onLogMeeting={
            onNavigate
              ? () => onNavigate("meetings", { createFor: formTarget.url })
              : undefined
          }
          onAddOpportunity={
            onNavigate
              ? () => onNavigate("opportunities", { createFor: formTarget.url })
              : undefined
          }
          onOpenAccount={
            onOpenAccount && formTarget.organisation
              ? () => onOpenAccount(formTarget.organisation)
              : undefined
          }
          onClose={() => {
            setFormTarget(null);
            // Closing a deep-linked form round-trips to the origin, same as saving
            // (no-ops when the form was opened from within this tab).
            onReturn?.();
          }}
        />
      )}

      {addingContact && (
        <NewContactForm
          orgOptions={orgOptions}
          onSaved={(url) => {
            setAddingContact(false);
            reloadContacts();
            setJustSaved(true);
            window.setTimeout(() => setJustSaved(false), 1200);
            // Open the freshly-added contact so they can keep editing / log a meeting.
            void url;
          }}
          onClose={() => setAddingContact(false)}
        />
      )}
    </section>
  );
}
