import { useEffect, useMemo, useRef, useState } from "react";
import "./MeetingsTab.css";
import { loadContacts, type Contact } from "../data/contacts";
import {
  loadAllMeetings,
  saveMeeting,
  deleteMeeting,
  type Meeting,
  type MeetingsById,
} from "../storage/meetings";
import {
  buildMeetingRows,
  nextMeetingNo,
  meetingId,
  deriveContactInfo,
  type MeetingRow,
} from "../data/meetings";
import { saveOpportunity } from "../storage/opportunities";
import { buildOpportunityFromMeeting } from "../data/opportunities";
import { nextMeetingDateISO } from "../data/timeline";
import {
  loadAllEdits,
  saveEdits,
  editsFor,
  type OwnerEdits,
} from "../storage/ownerEdits";
import {
  MEETING_STAGE,
  MEETING_TYPE,
  SENTIMENT,
  SECTOR_GROUPS,
} from "../data/vocab";
import type { TabIntent, Navigate } from "../components/TabNav";
import { TableControls } from "../components/TableControls";
import { ColumnHeader } from "../components/ColumnHeader";
import {
  LinkedInIcon,
  WhatsAppIcon,
  LinkedInCell,
  WhatsAppCell,
} from "../components/BrandIcons";
import {
  useTableControls,
  type ControlsConfig,
  type ControlsInitial,
} from "../data/tableControls";
import { MeetingForm, type MeetingFormTarget } from "./MeetingForm";
import { StatsBar } from "../components/StatsBar";

const YESNO = ["Yes", "No"] as const;

// What the Meetings list can be searched, filtered, and sorted by. Virtual seed rows
// (agreed-to-meet contacts not yet written up) flow through the same controls. Every
// column is sortable; categorical columns carry a header filter dropdown.
const MEETINGS_CONTROLS: ControlsConfig<MeetingRow> = {
  searchPlaceholder: "Search contact or organisation…",
  searchText: (m) => `${m.contactInfo.name} ${m.contactInfo.organisation}`,
  filters: [
    { key: "sector_group", label: "Sector group", options: SECTOR_GROUPS, get: (m) => m.contactInfo.sector_group },
    { key: "stage", label: "Stage", options: MEETING_STAGE, get: (m) => m.meeting_stage ?? "" },
    { key: "type", label: "Type", options: MEETING_TYPE, get: (m) => m.type ?? "" },
    { key: "sentiment", label: "Sentiment", options: SENTIMENT, get: (m) => m.sentiment ?? "" },
    { key: "opp", label: "Opportunity?", options: YESNO, get: (m) => m.opportunity_spotted ?? "" },
  ],
  sorts: [
    { key: "name", label: "Contact", get: (m) => m.contactInfo.name },
    { key: "organisation", label: "Organisation", get: (m) => m.contactInfo.organisation },
    { key: "meeting_no", label: "#", get: (m) => m.meeting_no },
    { key: "sector_group", label: "Sector group", get: (m) => m.contactInfo.sector_group },
    // Stage sorts by the workflow order in §5, not alphabetically.
    { key: "stage", label: "Stage", get: (m) => MEETING_STAGE.indexOf(m.meeting_stage as (typeof MEETING_STAGE)[number]) },
    { key: "type", label: "Type", get: (m) => m.type ?? "" },
    { key: "date", label: "Date", get: (m) => relevantDate(m) ?? "" },
    { key: "sentiment", label: "Sentiment", get: (m) => m.sentiment ?? "" },
    { key: "opp", label: "Opp?", get: (m) => m.opportunity_spotted ?? "" },
    { key: "followup", label: "Follow-up", get: (m) => m.followup_date ?? "" },
  ],
  defaultSortKey: "name",
};

// The Meetings tab (CLAUDE.md §4): one row per meeting.
//
// It reads the SAME enriched CSV as Contacts (read-only source of truth) and seeds
// a meeting for every contact who agreed to meet. Those seeds are VIRTUAL — built
// on the fly in ../data/meetings.ts and only written to storage once the owner edits
// them. Owner-created/follow-up meetings are saved straight away. All persistence is
// browser localStorage, kept separate from the CSV (../storage/meetings.ts).
//
// Layout: the table is a READ-ONLY, scannable summary (a few key columns). Clicking
// a row opens a slide-in form (./MeetingForm.tsx) where the meeting is actually
// edited — meeting write-ups are long free text that cramped table cells can't hold.
// The form buffers edits and only persists on Save.

type Props = {
  // Optional cross-tab deep link: preset a filter (e.g. Stage = Held from the Dashboard)
  // and/or open a specific meeting's form on arrival.
  intent?: TabIntent | null;
  // Jump to another tab (used by the form's links to the contact / linked opportunity).
  onNavigate?: Navigate;
  // Open the organisation "account" overlay (clicking an org name).
  onOpenAccount?: (org: string) => void;
  // Called when the user finishes with a form (Save OR close) — lets App return to the
  // originating overview tab (no-ops when there's no such origin).
  onReturn?: () => void;
};

export function MeetingsTab({
  intent,
  onNavigate,
  onOpenAccount,
  onReturn,
}: Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [edits, setEdits] = useState<Record<string, OwnerEdits>>({});
  const [saved, setSaved] = useState<MeetingsById>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [errorMsg, setErrorMsg] = useState("");

  // "Saved ✓" flash after a change, so persistence is visible (as on Contacts).
  const [justSaved, setJustSaved] = useState(false);

  // The currently-open form panel, or null when closed. Either editing an existing
  // row or creating a brand-new meeting.
  const [formTarget, setFormTarget] = useState<MeetingFormTarget | null>(null);

  // Load the CSV and any previously saved meetings once, on mount.
  useEffect(() => {
    loadContacts()
      .then((rows) => {
        setContacts(rows);
        setSaved(loadAllMeetings());
        setEdits(loadAllEdits());
        setStatus("ready");
      })
      .catch((err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
  }, []);

  // The rendered rows: every saved meeting + a virtual seed per agreed-to-meet
  // contact without one. Recomputed whenever the data changes.
  const rows = useMemo(
    () => buildMeetingRows(contacts, saved),
    [contacts, saved],
  );

  // Headline counts (from the FULL set, so they stay fixed as you filter). "People met" is
  // distinct contacts with a held meeting (a person met twice still counts once).
  const statCounts = useMemo(() => {
    const peopleMet = new Set(
      rows.filter((r) => r.date_held).map((r) => r.contact_url),
    ).size;
    return {
      meetings: rows.length,
      scheduled: rows.filter((r) => r.meeting_stage === "Scheduled").length,
      held: rows.filter((r) => r.meeting_stage === "Held").length,
      peopleMet,
    };
  }, [rows]);

  // Seed the controls from a deep-link intent (search and/or one filter) on mount.
  const initial = useMemo<ControlsInitial | undefined>(
    () =>
      intent
        ? {
            query: intent.search,
            filters: intent.filter
              ? { [intent.filter.key]: intent.filter.value }
              : undefined,
          }
        : undefined,
    [intent],
  );

  // Search / filter / sort state and the rows to actually render.
  const { filtered, controlsProps } = useTableControls(
    rows,
    MEETINGS_CONTROLS,
    initial,
  );

  // The stage stats double as one-click filters via the shared "stage" filter; "Meetings"
  // clears it. "People met" is a distinct-people metric (not a row subset) → display-only.
  const stageFilter = controlsProps.filterValues.stage ?? "";
  const selectStage = (stage: string) => controlsProps.setFilter("stage", stage);
  const stats = [
    { label: "Meetings", value: statCounts.meetings, onSelect: () => selectStage(""), active: stageFilter === "" },
    { label: "Scheduled", value: statCounts.scheduled, onSelect: () => selectStage("Scheduled"), active: stageFilter === "Scheduled" },
    { label: "Held", value: statCounts.held, onSelect: () => selectStage("Held"), active: stageFilter === "Held" },
    { label: "People met", value: statCounts.peopleMet },
  ];

  // Consume a deep-link intent once data has loaded:
  //   - openId   → open that meeting's form (and filter the list to it)
  //   - createFor → open a NEW meeting form pre-linked to that contact (from the
  //                 contact form's "Log meeting" shortcut)
  // Remember the last intent we acted on (rather than a one-shot "opened" flag) so a NEW
  // deep link — e.g. clicking a meeting in the account overlay while already on this tab —
  // re-opens. App makes a fresh intent object per navigate, so an identity check suffices.
  const handledIntent = useRef<TabIntent | null>(null);
  useEffect(() => {
    if (!intent || intent === handledIntent.current) return;
    if (intent.openId && rows.length > 0) {
      const row = rows.find((r) => r.id === intent.openId);
      if (row) {
        setFormTarget({ mode: "edit", row });
        // Filter the list to this contact's meeting(s) so the opened row stands alone.
        if (!intent.search) controlsProps.setQuery(row.contactInfo.name);
        handledIntent.current = intent;
      }
    } else if (intent.createFor && contacts.length > 0) {
      setFormTarget({ mode: "new", contactUrl: intent.createFor });
      handledIntent.current = intent;
    }
  }, [rows, contacts, intent, controlsProps]);

  // Contacts sorted by name, for the "add meeting" contact picker in the form.
  const contactOptions = useMemo(
    () =>
      [...contacts].sort((a, b) =>
        `${a.first} ${a.last}`.localeCompare(`${b.first} ${b.last}`),
      ),
    [contacts],
  );

  function flashSaved() {
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 1200);
  }

  // Persist the form's draft. Two cases:
  //   - editing an existing row (or a virtual seed): merge the draft onto the row's
  //     identity (id / contact_url / meeting_no) and save under the same id. A seed
  //     materialises here on its first save, under its deterministic id — no dup.
  //   - new meeting: the contact was chosen in the form; compute the next meeting_no
  //     for that contact so a follow-up becomes #2 and the id stays unique.
  function handleSave(
    draft: Omit<Meeting, "id" | "contact_url" | "meeting_no">,
    newContactUrl?: string,
  ) {
    if (!formTarget) return;

    let meeting: Meeting;
    if (formTarget.mode === "new") {
      if (!newContactUrl) return;
      const no = nextMeetingNo(newContactUrl, rows);
      meeting = {
        ...draft,
        id: meetingId(newContactUrl, no),
        contact_url: newContactUrl,
        meeting_no: no,
      };
    } else {
      const { id, contact_url, meeting_no } = formTarget.row;
      meeting = { ...draft, id, contact_url, meeting_no };
    }

    // §7 auto-create: the moment a meeting is marked "Opportunity spotted = Yes"
    // and isn't already linked, create a linked Opportunity pre-filled from the
    // meeting (org/contact/notes→description/followup→next_step). The opportunity's
    // id is DETERMINISTIC from the meeting id, so toggling Yes again never creates a
    // duplicate. Toggling back to No leaves the opportunity in place — the owner can
    // delete it from the Opportunities tab; we don't throw away commercial work.
    if (meeting.opportunity_spotted === "Yes" && !meeting.linked_opportunity_id) {
      const info = deriveContactInfo(
        contacts.find((c) => c.url === meeting.contact_url),
      );
      const opp = buildOpportunityFromMeeting(meeting, info);
      saveOpportunity(opp);
      meeting = { ...meeting, linked_opportunity_id: opp.id };
    }

    // Auto follow-up once a meeting is held: the Outcome "Follow-up date" always mirrors
    // the contact's ACTUAL next meeting. If a later meeting already exists, inherit its
    // scheduled date; otherwise create one (+2 months) and inherit that — so the field and
    // the next meeting row can never disagree.
    if (meeting.date_held) {
      const no = meeting.meeting_no + 1;
      const fid = meetingId(meeting.contact_url, no);
      const existing = saved[fid];
      const followupDate =
        existing?.date_scheduled ??
        meeting.followup_date ??
        nextMeetingDateISO(meeting.date_held);
      meeting = { ...meeting, followup_date: followupDate };

      let nextSaved = saveMeeting(meeting);
      // Create the next meeting only when this is the contact's latest meeting.
      if (!existing) {
        const latestNo = Math.max(
          0,
          ...rows
            .filter((r) => r.contact_url === meeting.contact_url)
            .map((r) => r.meeting_no),
        );
        if (meeting.meeting_no >= latestNo) {
          const followup: Meeting = {
            id: fid,
            contact_url: meeting.contact_url,
            meeting_no: no,
            meeting_stage: "Scheduled",
            date_agreed: meeting.date_held,
            date_scheduled: followupDate,
          };
          nextSaved = saveMeeting(followup);
        }
      }
      setSaved(nextSaved);
    } else {
      setSaved(saveMeeting(meeting));
    }
    setFormTarget(null);
    flashSaved();
    onReturn?.();
  }

  // One-click: toggle the meeting contact's decision-maker flag (a contact owner-edit,
  // saved immediately — independent of the meeting's buffered Save).
  function toggleDecisionMaker(contactUrl: string) {
    const cur = editsFor(edits, contactUrl);
    const next: OwnerEdits = {
      ...cur,
      decision_role:
        cur?.decision_role === "Decision Maker" ? undefined : "Decision Maker",
    };
    setEdits(saveEdits(contactUrl, next));
  }

  // Remove a saved meeting. For a manually-added meeting it disappears; for a
  // materialised seed of an agreed-to-meet contact it reverts to a fresh virtual
  // seed (reappears at "Agreed - not scheduled").
  function handleDelete(id: string) {
    setSaved(deleteMeeting(id));
    setFormTarget(null);
    flashSaved();
  }

  if (status === "loading") {
    return <p className="meetings-status">Loading meetings…</p>;
  }

  if (status === "error") {
    return (
      <div className="meetings-status meetings-status--error">
        <p>Couldn’t load meetings.</p>
        <p className="meetings-error-detail">{errorMsg}</p>
      </div>
    );
  }

  return (
    <section className="meetings">
      <div className="meetings-toolbar">
        <h2>Meetings</h2>
        <span className="meetings-count">{rows.length} meetings</span>
        <button
          type="button"
          className="meetings-add"
          onClick={() => setFormTarget({ mode: "new" })}
        >
          + Add meeting
        </button>
        <span
          className={
            justSaved ? "meetings-saved meetings-saved--on" : "meetings-saved"
          }
        >
          Saved ✓
        </span>
      </div>

      <p className="meetings-hint">
        Every contact who agreed to meet starts here at “Agreed - not scheduled”.
        Click any row to open it and write it up — changes save when you press Save
        and survive a reload.
      </p>

      <StatsBar stats={stats} />

      <TableControls {...controlsProps} />

      <div className="meetings-table-wrap">
        <table className="meetings-table">
          <thead>
            <tr>
              <th className="cell-icon-head" title="LinkedIn"><LinkedInIcon /></th>
              <th className="cell-icon-head" title="WhatsApp"><WhatsAppIcon /></th>
              <ColumnHeader label="Contact" controls={controlsProps} sortKey="name" />
              <ColumnHeader label="Organisation" controls={controlsProps} sortKey="organisation" />
              <ColumnHeader label="#" controls={controlsProps} sortKey="meeting_no" />
              <ColumnHeader label="Sector group" controls={controlsProps} sortKey="sector_group" filter={{ key: "sector_group", options: SECTOR_GROUPS }} />
              <ColumnHeader label="Stage" controls={controlsProps} sortKey="stage" filter={{ key: "stage", options: MEETING_STAGE }} />
              <ColumnHeader label="Type" controls={controlsProps} sortKey="type" filter={{ key: "type", options: MEETING_TYPE }} />
              <ColumnHeader label="Date" controls={controlsProps} sortKey="date" />
              <ColumnHeader label="Sentiment" controls={controlsProps} sortKey="sentiment" filter={{ key: "sentiment", options: SENTIMENT }} />
              <ColumnHeader label="Opp?" controls={controlsProps} sortKey="opp" filter={{ key: "opp", options: YESNO }} />
              <ColumnHeader label="Follow-up" controls={controlsProps} sortKey="followup" />
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.id}
                className={
                  row.isSeed
                    ? "meetings-row meetings-seed-row"
                    : "meetings-row"
                }
                role="button"
                tabIndex={0}
                onClick={() => setFormTarget({ mode: "edit", row })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setFormTarget({ mode: "edit", row });
                  }
                }}
              >
                <LinkedInCell url={row.contact_url} />
                <WhatsAppCell
                  phone={
                    editsFor(edits, row.contact_url)?.phone ||
                    row.contactInfo.phone
                  }
                />
                <td>{row.contactInfo.name}</td>
                <td>
                  {onOpenAccount && row.contactInfo.organisation ? (
                    <button
                      type="button"
                      className="org-link"
                      title="View this organisation’s account"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenAccount(row.contactInfo.organisation);
                      }}
                    >
                      {row.contactInfo.organisation}
                    </button>
                  ) : (
                    row.contactInfo.organisation
                  )}
                </td>
                <td className="cell-num">{row.meeting_no}</td>
                <td>{row.contactInfo.sector_group}</td>
                <td>{row.meeting_stage || "—"}</td>
                <td>{row.type || "—"}</td>
                <td>{relevantDate(row) || "—"}</td>
                <td>{row.sentiment || "—"}</td>
                <td>{row.opportunity_spotted || "—"}</td>
                <td>{row.followup_date || "—"}</td>
                <td className="cell-actions">
                  {row.isSeed ? null : (
                    <button
                      type="button"
                      className="meetings-remove"
                      title="Remove this meeting"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(row.id);
                      }}
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formTarget && (
        <MeetingForm
          target={formTarget}
          contacts={contactOptions}
          ownerPhone={
            formTarget.mode === "edit"
              ? editsFor(edits, formTarget.row.contact_url)?.phone
              : undefined
          }
          priorMeetings={
            formTarget.mode === "edit"
              ? rows.filter(
                  (r) =>
                    r.contact_url === formTarget.row.contact_url &&
                    r.meeting_no < formTarget.row.meeting_no,
                )
              : []
          }
          isDecisionMaker={
            formTarget.mode === "edit" &&
            editsFor(edits, formTarget.row.contact_url)?.decision_role ===
              "Decision Maker"
          }
          onToggleDecisionMaker={
            formTarget.mode === "edit"
              ? () => toggleDecisionMaker(formTarget.row.contact_url)
              : undefined
          }
          onSave={handleSave}
          onDelete={
            formTarget.mode === "edit" && !formTarget.row.isSeed
              ? handleDelete
              : undefined
          }
          onOpenContact={
            onNavigate
              ? (url) => onNavigate("contacts", { openId: url })
              : undefined
          }
          onOpenOpportunity={
            onNavigate
              ? (id) => onNavigate("opportunities", { openId: id })
              : undefined
          }
          onOpenPrevMeeting={(id) => {
            const row = rows.find((r) => r.id === id);
            if (row) setFormTarget({ mode: "edit", row });
          }}
          onOpenAccount={onOpenAccount}
          onClose={() => {
            setFormTarget(null);
            onReturn?.();
          }}
        />
      )}
    </section>
  );
}

// The single most relevant date to show in the summary row: the latest concrete
// milestone reached — held, else scheduled, else agreed.
function relevantDate(row: MeetingRow): string | undefined {
  return row.date_held || row.date_scheduled || row.date_agreed;
}
