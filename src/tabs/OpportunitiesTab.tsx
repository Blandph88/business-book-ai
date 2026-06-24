import { useEffect, useMemo, useRef, useState } from "react";
import "./OpportunitiesTab.css";
import {
  loadAllOpportunities,
  saveOpportunity,
  deleteOpportunity,
  type Opportunity,
  type OpportunitiesById,
} from "../storage/opportunities";
import {
  weightedValue,
  opportunityContact,
  opportunityStatus,
  opportunityPhase,
  openWeightedPipeline,
  OPPORTUNITY_OUTCOMES,
  UNASSIGNED_GROUP,
} from "../data/opportunities";
import { loadContacts, type Contact } from "../data/contacts";
import { loadAllMeetings, type MeetingsById } from "../storage/meetings";
import { loadAllSows, type Sow } from "../storage/revenue";
import { sowForOpportunity } from "../data/revenue";
import { loadAllEdits, editsFor, type OwnerEdits } from "../storage/ownerEdits";
import { formatMoney } from "../data/format";
import {
  probabilityLabel,
  SERVICE_LINE,
  OPPORTUNITY_PHASES,
  OPPORTUNITY_STEPS,
  stepShort,
  stepIndex,
  SECTOR_GROUPS,
} from "../data/vocab";

// Phase filter options include the terminal "Lost" bucket; step options are the short
// labels in workflow order (used by both the table dropdown and the sort).
const PHASE_OPTIONS = [...OPPORTUNITY_PHASES, "Lost"];
const STEP_OPTIONS = OPPORTUNITY_STEPS.map((s) => s.short);
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
import {
  OpportunityForm,
  type OpportunityFormTarget,
} from "./OpportunityForm";
import { StatsBar } from "../components/StatsBar";

// The static parts of the Opportunities controls. The Sector-group filter/sort is added
// in the component because it depends on the linked contact (resolved at runtime). Every
// column is sortable; categorical columns carry a header filter dropdown. The default
// sort keeps the previous behaviour — most valuable (weighted) pursuits lead.
const OPPS_CONTROLS_BASE: ControlsConfig<Opportunity> = {
  searchPlaceholder: "Search opportunity or organisation…",
  searchText: (o) => `${o.opportunity_name} ${o.organisation} ${o.primary_contact}`,
  filters: [
    { key: "service_line", label: "Service line", options: SERVICE_LINE, get: (o) => o.service_line },
    // Phase = the roll-up bucket (used by the Dashboard funnel deep-link); Step = the
    // granular workflow position.
    { key: "phase", label: "Phase", options: PHASE_OPTIONS, get: (o) => opportunityPhase(o) },
    { key: "step", label: "Step", options: STEP_OPTIONS, get: (o) => stepShort(o.current_step) },
    { key: "status", label: "Status", options: OPPORTUNITY_OUTCOMES, get: (o) => opportunityStatus(o) },
  ],
  sorts: [
    { key: "name", label: "Opportunity", get: (o) => o.opportunity_name },
    { key: "organisation", label: "Organisation", get: (o) => o.organisation },
    { key: "service_line", label: "Service line", get: (o) => o.service_line },
    // Sort by workflow order (the step index), not alphabetically.
    { key: "step", label: "Step", get: (o) => stepIndex(o.current_step) },
    { key: "est_value", label: "Est. value", get: (o) => o.est_value ?? 0 },
    { key: "prob", label: "Prob.", get: (o) => o.probability ?? 0 },
    { key: "weighted", label: "Weighted value", get: (o) => weightedValue(o) },
    { key: "status", label: "Status", get: (o) => OPPORTUNITY_OUTCOMES.indexOf(opportunityStatus(o)) },
  ],
  defaultSortKey: "weighted",
  defaultSortDir: "desc",
};

const SECTOR_OPTIONS = [...SECTOR_GROUPS, UNASSIGNED_GROUP];

// The Opportunities tab (CLAUDE.md §4): the commercial funnel, one row per
// opportunity. Same shape as the Meetings tab — a read-only, scannable summary
// table; clicking a row opens the slide-in form where it's actually edited. All
// persistence is browser localStorage (../storage/opportunities.ts).
//
// Opportunities arrive two ways: created here with "+ Add opportunity", or
// auto-created from a meeting when opportunity_spotted = "Yes" (§7) — those show
// here automatically once the meeting is saved, and are edited the same way.

// A stable random id for a manually-created opportunity. (Meeting-sourced ones get
// a deterministic id instead — see ../data/opportunities.ts.)
function newOpportunityId(): string {
  return `opp:${crypto.randomUUID()}`;
}

type Props = {
  // Optional cross-tab deep link: preset a filter (e.g. Stage = … from the Dashboard)
  // and/or open a specific opportunity's form on arrival.
  intent?: TabIntent | null;
  // Jump to another tab (used by the form's links to the contact / source meeting).
  onNavigate?: Navigate;
  // Open the organisation "account" overlay (clicking an org name).
  onOpenAccount?: (org: string) => void;
  // Called when the user finishes with a form (Save OR close) — lets App return to the
  // originating overview tab (no-ops when there's no such origin).
  onReturn?: () => void;
};

export function OpportunitiesTab({
  intent,
  onNavigate,
  onOpenAccount,
  onReturn,
}: Props) {
  const [saved, setSaved] = useState<OpportunitiesById>({});
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [edits, setEdits] = useState<Record<string, OwnerEdits>>({});
  const [meetings, setMeetings] = useState<MeetingsById>({});
  const [sows, setSows] = useState<Sow[]>([]);
  const [justSaved, setJustSaved] = useState(false);
  const [formTarget, setFormTarget] = useState<OpportunityFormTarget | null>(
    null,
  );

  // Load saved opportunities + the contacts (for the linked-contact picker and the
  // sector filter) + meetings (to resolve the contact of meeting-created opps) + SoWs
  // (to show View/Create SoW on the form) on mount.
  useEffect(() => {
    setSaved(loadAllOpportunities());
    setMeetings(loadAllMeetings());
    setSows(Object.values(loadAllSows()));
    setEdits(loadAllEdits());
    loadContacts()
      .then(setContacts)
      .catch(() => setContacts([]));
  }, []);

  // All saved opportunities. Ordering is now handled by the controls below (which
  // default to weighted-value descending — the previous behaviour).
  const rows = useMemo(() => Object.values(saved), [saved]);

  // Headline stats: count + open/won + the open weighted pipeline value.
  const stats = useMemo(
    () => [
      { label: "Opportunities", value: rows.length },
      { label: "Open", value: rows.filter((o) => opportunityStatus(o) === "Open").length },
      { label: "Weighted pipeline", value: formatMoney(openWeightedPipeline(rows)), highlight: true },
      { label: "Won", value: rows.filter((o) => opportunityStatus(o) === "Won").length },
    ],
    [rows],
  );

  // Each opportunity's linked contact (direct, or via the source meeting), and its sector
  // group. The contact feeds the Sector-group filter + the LinkedIn/WhatsApp icon columns.
  const oppContact = useMemo(() => {
    const byUrl = new Map(contacts.map((c) => [c.url, c]));
    const m = new Map<string, Contact | null>();
    for (const o of rows) m.set(o.id, opportunityContact(o, byUrl, meetings));
    return m;
  }, [rows, contacts, meetings]);
  const oppSector = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of rows) {
      m.set(o.id, oppContact.get(o.id)?.sector_group ?? UNASSIGNED_GROUP);
    }
    return m;
  }, [rows, oppContact]);

  // Controls with the runtime-resolved Sector-group filter + sort prepended.
  const controls = useMemo<ControlsConfig<Opportunity>>(
    () => ({
      ...OPPS_CONTROLS_BASE,
      filters: [
        {
          key: "sector_group",
          label: "Sector group",
          options: SECTOR_OPTIONS,
          get: (o: Opportunity) => oppSector.get(o.id) ?? UNASSIGNED_GROUP,
        },
        ...(OPPS_CONTROLS_BASE.filters ?? []),
      ],
      sorts: [
        { key: "sector_group", label: "Sector group", get: (o: Opportunity) => oppSector.get(o.id) ?? UNASSIGNED_GROUP },
        ...(OPPS_CONTROLS_BASE.sorts ?? []),
      ],
    }),
    [oppSector],
  );

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
  const { filtered, controlsProps } = useTableControls(rows, controls, initial);

  // Consume a deep-link intent once loaded:
  //   - openId    → open that opportunity's form (and filter the list to it)
  //   - createFor → open a NEW opportunity form pre-linked to that contact (from the
  //                 contact form's "Add opportunity" shortcut)
  // Remember the last intent we acted on (rather than a one-shot "opened" flag) so a NEW
  // deep link — e.g. clicking an opportunity in the account overlay while already on this
  // tab — re-opens. App makes a fresh intent object per navigate, so identity is enough.
  const handledIntent = useRef<TabIntent | null>(null);
  useEffect(() => {
    if (!intent || intent === handledIntent.current) return;
    if (intent.openId && rows.length > 0) {
      const opp = rows.find((o) => o.id === intent.openId);
      if (opp) {
        setFormTarget({ mode: "edit", opp });
        // Filter the list down to this opportunity so the opened row stands alone.
        if (!intent.search) {
          controlsProps.setQuery(opp.opportunity_name || opp.organisation || "");
        }
        handledIntent.current = intent;
      }
    } else if (intent.createFor && contacts.length > 0) {
      setFormTarget({ mode: "new", contactUrl: intent.createFor });
      handledIntent.current = intent;
    }
  }, [rows, contacts, intent, controlsProps]);

  function flashSaved() {
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 1200);
  }

  // Persist the form's draft. A new opportunity gets a random id here; an edited
  // one keeps its existing id (which may be the deterministic meeting-sourced id).
  function handleSave(opp: Opportunity) {
    const toSave: Opportunity =
      opp.id === "" ? { ...opp, id: newOpportunityId() } : opp;
    setSaved(saveOpportunity(toSave));
    setFormTarget(null);
    flashSaved();
    onReturn?.();
  }

  function handleDelete(id: string) {
    setSaved(deleteOpportunity(id));
    setFormTarget(null);
    flashSaved();
  }

  return (
    <section className="opps">
      <div className="opps-toolbar">
        <h2>Opportunities</h2>
        <span className="opps-count">{rows.length} opportunities</span>
        <button
          type="button"
          className="opps-add"
          onClick={() => setFormTarget({ mode: "new" })}
        >
          + Add opportunity
        </button>
        <span
          className={justSaved ? "opps-saved opps-saved--on" : "opps-saved"}
        >
          Saved ✓
        </span>
      </div>

      <p className="opps-hint">
        Your commercial funnel. Weighted value (estimated value × probability) is
        calculated automatically. Opportunities spotted in a meeting appear here on
        their own. Click any row to edit it.
      </p>

      {rows.length > 0 && <StatsBar stats={stats} />}

      {rows.length === 0 ? (
        <p className="opps-empty">
          No opportunities yet. Add one, or mark a meeting’s “Opportunity spotted”
          as Yes to create one automatically.
        </p>
      ) : (
        <>
          <TableControls {...controlsProps} />
          {filtered.length === 0 ? (
            <p className="opps-empty">No opportunities match these filters.</p>
          ) : (
            <div className="opps-table-wrap">
              <table className="opps-table">
            <thead>
              <tr>
                <th className="cell-icon-head" title="LinkedIn"><LinkedInIcon /></th>
                <th className="cell-icon-head" title="WhatsApp"><WhatsAppIcon /></th>
                <ColumnHeader label="Opportunity" controls={controlsProps} sortKey="name" />
                <ColumnHeader label="Organisation" controls={controlsProps} sortKey="organisation" />
                <ColumnHeader label="Sector group" controls={controlsProps} sortKey="sector_group" filter={{ key: "sector_group", options: SECTOR_OPTIONS }} />
                <ColumnHeader label="Service line" controls={controlsProps} sortKey="service_line" filter={{ key: "service_line", options: SERVICE_LINE }} />
                <ColumnHeader label="Phase" controls={controlsProps} sortKey="step" filter={{ key: "phase", options: PHASE_OPTIONS }} />
                <ColumnHeader label="Step" controls={controlsProps} sortKey="step" filter={{ key: "step", options: STEP_OPTIONS }} />
                <ColumnHeader label="Est. value" controls={controlsProps} sortKey="est_value" className="cell-num" />
                <ColumnHeader label="Prob." controls={controlsProps} sortKey="prob" className="cell-num" />
                <ColumnHeader label="Weighted" controls={controlsProps} sortKey="weighted" className="cell-num" />
                <ColumnHeader label="Status" controls={controlsProps} sortKey="status" filter={{ key: "status", options: OPPORTUNITY_OUTCOMES }} />
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((opp) => (
                <tr
                  key={opp.id}
                  className="opps-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => setFormTarget({ mode: "edit", opp })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setFormTarget({ mode: "edit", opp });
                    }
                  }}
                >
                  <LinkedInCell url={oppContact.get(opp.id)?.url} />
                  <WhatsAppCell
                    phone={
                      editsFor(edits, oppContact.get(opp.id)?.url ?? "")?.phone ||
                      oppContact.get(opp.id)?.phone
                    }
                  />
                  <td>{opp.opportunity_name || "—"}</td>
                  <td>
                    {onOpenAccount && opp.organisation ? (
                      <button
                        type="button"
                        className="org-link"
                        title="View this organisation’s account"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenAccount(opp.organisation);
                        }}
                      >
                        {opp.organisation}
                      </button>
                    ) : (
                      opp.organisation || "—"
                    )}
                  </td>
                  <td>{oppSector.get(opp.id) ?? UNASSIGNED_GROUP}</td>
                  <td>{opp.service_line}</td>
                  <td>{opportunityPhase(opp)}</td>
                  <td>{stepShort(opp.current_step)}</td>
                  <td className="cell-num">
                    {opp.est_value != null ? formatMoney(opp.est_value) : "—"}
                  </td>
                  <td className="cell-num">
                    {opp.probability != null
                      ? probabilityLabel(opp.probability)
                      : "—"}
                  </td>
                  <td className="cell-num">{formatMoney(weightedValue(opp))}</td>
                  <td>{opportunityStatus(opp)}</td>
                  <td className="cell-actions">
                    <button
                      type="button"
                      className="opps-remove"
                      title="Remove this opportunity"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(opp.id);
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {formTarget && (
        <OpportunityForm
          target={formTarget}
          contacts={contacts}
          linkedSowId={
            formTarget.mode === "edit"
              ? sowForOpportunity(formTarget.opp.id, sows)?.id
              : undefined
          }
          sourceMeeting={
            formTarget.mode === "edit" && formTarget.opp.source_meeting_id
              ? meetings[formTarget.opp.source_meeting_id]
              : undefined
          }
          onSave={handleSave}
          onDelete={formTarget.mode === "edit" ? handleDelete : undefined}
          onOpenContact={
            onNavigate
              ? (url) => onNavigate("contacts", { openId: url })
              : undefined
          }
          onOpenMeeting={
            onNavigate
              ? (id) => onNavigate("meetings", { openId: id })
              : undefined
          }
          onOpenAccount={onOpenAccount}
          onOpenSow={
            onNavigate
              ? (id) => onNavigate("revenue", { openId: id })
              : undefined
          }
          onCreateSow={
            onNavigate && formTarget.mode === "edit"
              ? () =>
                  onNavigate("revenue", { createSowFor: formTarget.opp.id })
              : undefined
          }
          onClose={() => {
            setFormTarget(null);
            onReturn?.();
          }}
        />
      )}
    </section>
  );
}
