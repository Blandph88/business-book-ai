import { useEffect, useMemo, useState } from "react";
import type { Contact } from "../data/contacts";
import type { Meeting } from "../storage/meetings";
import type { MeetingRow } from "../data/meetings";
import { deriveContactInfo, meetingMissingFields } from "../data/meetings";
import { ContactLinks } from "../components/BrandIcons";
import { todayISO } from "../data/agenda";
import {
  MEETING_STAGE,
  MEETING_TYPE,
  SENTIMENT,
  OPPORTUNITY_SPOTTED,
  OWNER_NAME,
} from "../data/vocab";

// Defaults filled into an empty meeting so the owner isn't retyping the obvious: us =
// the owner, them = the contact, location = the usual city. All stay editable.
const DEFAULT_LOCATION = "Riyadh, Saudi Arabia";
function withDefaults(draft: MeetingDraft, clientName?: string): MeetingDraft {
  return {
    ...draft,
    attendees_ours: draft.attendees_ours || OWNER_NAME,
    attendees_client: draft.attendees_client || clientName || undefined,
    location: draft.location || DEFAULT_LOCATION,
  };
}

// The slide-in detail/edit panel for a single meeting (CLAUDE.md §4).
//
// Why a panel instead of inline-editable cells: a meeting write-up is long free
// text (purpose, notes, org insights, pain points, actions, follow-up). Cramped
// table inputs can't hold that, so the table is now read-only and the actual
// editing happens here in large fields.
//
// Save model: this form buffers ALL edits in local `draft` state and only writes
// to storage when the owner clicks Save (the parent's onSave → saveMeeting). Cancel,
// the backdrop, and Escape all close WITHOUT saving. That explicit boundary also
// gives the future minutes-import (build step 6/7) a single clean write target — it
// will build a Meeting and call the same saveMeeting this form uses.

// What the parent is asking the panel to do:
//   - { mode: "edit", row }  → edit an existing meeting or materialise a seed
//   - { mode: "new" }        → create a brand-new meeting (contact chosen here, or
//                              pre-selected via contactUrl from a "Log meeting" shortcut)
export type MeetingFormTarget =
  | { mode: "edit"; row: MeetingRow }
  | { mode: "new"; contactUrl?: string };

// The editable subset of a Meeting (everything except the identity/link fields,
// which the parent owns). Keeping this as Partial keeps "empty" fields simply absent.
type MeetingDraft = Omit<Meeting, "id" | "contact_url" | "meeting_no">;

// Pull just the editable fields off a row into a fresh draft object.
function draftFromRow(row: MeetingRow): MeetingDraft {
  return {
    meeting_stage: row.meeting_stage,
    date_agreed: row.date_agreed,
    date_scheduled: row.date_scheduled,
    date_held: row.date_held,
    type: row.type,
    location: row.location,
    attendees_ours: row.attendees_ours,
    attendees_client: row.attendees_client,
    purpose: row.purpose,
    notes: row.notes,
    org_insights: row.org_insights,
    pain_points: row.pain_points,
    opportunity_spotted: row.opportunity_spotted,
    linked_opportunity_id: row.linked_opportunity_id,
    actions_mine: row.actions_mine,
    actions_theirs: row.actions_theirs,
    followup: row.followup,
    followup_date: row.followup_date,
    sentiment: row.sentiment,
  };
}

// A new meeting starts essentially empty, at the first lifecycle stage.
const EMPTY_DRAFT: MeetingDraft = {
  meeting_stage: "Agreed - not scheduled",
};

export function MeetingForm({
  target,
  contacts,
  ownerPhone,
  priorMeetings = [],
  isDecisionMaker = false,
  onToggleDecisionMaker,
  onSave,
  onDelete,
  onScheduleFollowup,
  onOpenContact,
  onOpenOpportunity,
  onOpenPrevMeeting,
  onOpenAccount,
  onClose,
}: {
  target: MeetingFormTarget;
  // Contacts sorted for the "new meeting" picker (ignored in edit mode).
  contacts: Contact[];
  // Whether the meeting's contact is flagged as the decision-maker (a contact edit), and
  // a one-click toggle to set/clear it right here — capturing the insight where you learn
  // it rather than going to the Contacts tab.
  isDecisionMaker?: boolean;
  onToggleDecisionMaker?: () => void;
  // This contact's EARLIER meetings (meeting_no < this one) — linked at the top so the
  // owner can review prior notes. Empty for meeting #1 / new meetings.
  priorMeetings?: MeetingRow[];
  // The owner's manual phone override for this contact, if any — wins over the pipeline
  // number for the header's WhatsApp link (matches the table's WhatsApp column).
  ownerPhone?: string;
  // Persist: receives the editable draft plus, for new meetings, the chosen contact.
  onSave: (draft: MeetingDraft, newContactUrl?: string) => void;
  // Remove an existing (non-seed) meeting. Absent for new/seed targets.
  onDelete?: (id: string) => void;
  // Create a follow-up meeting 2 months after this one (edit mode only).
  onScheduleFollowup?: () => void;
  // Cross-tab links: open this meeting's contact / linked opportunity in its own tab.
  onOpenContact?: (contactUrl: string) => void;
  onOpenOpportunity?: (opportunityId: string) => void;
  // Open one of this contact's earlier meetings (from the "previous meetings" links).
  onOpenPrevMeeting?: (id: string) => void;
  // Open the meeting org's "account" overlay (clicking the org name).
  onOpenAccount?: (org: string) => void;
  onClose: () => void;
}) {
  const isNew = target.mode === "new";

  // Local working copy. Nothing here touches storage until Save. Empty attendees /
  // location are pre-filled with sensible defaults so they save as real values.
  const [draft, setDraft] = useState<MeetingDraft>(
    isNew
      ? withDefaults({ ...EMPTY_DRAFT })
      : withDefaults(draftFromRow(target.row), target.row.contactInfo.name),
  );
  // The chosen contact, only used in "new" mode. Pre-filled when the form was opened
  // from a contact's "Log meeting" shortcut.
  const [contactUrl, setContactUrl] = useState(
    target.mode === "new" ? target.contactUrl ?? "" : "",
  );

  // Escape closes the panel without saving (same as Cancel / backdrop).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Update one field of the local draft.
  function set<K extends keyof MeetingDraft>(field: K, value: MeetingDraft[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  // The read-only "who" header. In edit mode it's derived from the linked contact;
  // in new mode the owner is still choosing, so show the picker's current pick.
  const info = isNew
    ? deriveContactInfo(contacts.find((c) => c.url === contactUrl))
    : target.row.contactInfo;
  const meetingNo = isNew ? undefined : target.row.meeting_no;

  // Save is only blocked in new mode until a contact is chosen.
  const canSave = !isNew || contactUrl !== "";

  function handleSave() {
    if (!canSave) return;
    onSave(draft, isNew ? contactUrl : undefined);
  }

  // ── Overdue flagging ──────────────────────────────────────────────────────
  // A meeting lands in the Dashboard's "This week" as OVERDUE for one of two reasons
  // (mirrors data/agenda.ts exactly, so what the form flags matches what surfaced it):
  //   • it's still "Scheduled" but the scheduled date has passed, or
  //   • its follow-up date is in the past.
  // We compute this live off the draft, so as soon as the owner marks it Held, reschedules,
  // or clears the follow-up, the flag clears. ISO dates compare correctly as strings.
  const today = useMemo(() => todayISO(), []);
  const overdueDays = (d?: string) => (d && d < today ? daysBetween(d, today) : 0);
  const scheduledOverdue =
    draft.meeting_stage === "Scheduled" ? overdueDays(draft.date_scheduled) : 0;
  const followupOverdue = overdueDays(draft.followup_date);
  const anyOverdue = scheduledOverdue > 0 || followupOverdue > 0;

  // One-click: mark this meeting as held today (fills Date held if empty). Updates the
  // draft so the owner can review and Save — same buffer-and-save model as every field.
  const notHeldYet =
    draft.meeting_stage === "Agreed - not scheduled" ||
    draft.meeting_stage === "Scheduled";
  function markHeldToday() {
    setDraft((d) => ({
      ...d,
      meeting_stage: "Held",
      date_held: d.date_held || today,
    }));
  }

  // New mode: default "attendees (client)" to the chosen contact once one is picked.
  useEffect(() => {
    if (!isNew || !contactUrl) return;
    setDraft((d) =>
      d.attendees_client ? d : { ...d, attendees_client: info.name },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, contactUrl]);

  // Completeness obligation: once a meeting has a held date, every write-up field must be
  // filled. Computed live off the draft, so the banner clears as fields are completed.
  const missing = draft.date_held ? meetingMissingFields(draft) : [];

  return (
    // Backdrop: clicking it (but not the panel) cancels.
    <div className="mform-backdrop" onClick={onClose}>
      <aside
        className="mform-panel"
        role="dialog"
        aria-label="Meeting details"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header: who the meeting is with ─────────────────────────────── */}
        <header className="mform-header">
          <div>
            <h3 className="mform-title">
              {isNew ? (
                "New meeting"
              ) : (
                <>
                  {info.name}
                  <ContactLinks
                    url={target.mode === "edit" ? target.row.contact_url : undefined}
                    phone={ownerPhone?.trim() || info.phone}
                  />
                </>
              )}
              {meetingNo ? (
                <span className="mform-meeting-no"> · meeting #{meetingNo}</span>
              ) : null}
            </h3>
            {!isNew && (
              <p className="mform-subtitle">
                {onOpenAccount && info.organisation && info.organisation !== "—" ? (
                  <button
                    type="button"
                    className="org-link"
                    title="View this organisation’s account"
                    onClick={() => onOpenAccount(info.organisation)}
                  >
                    {info.organisation}
                  </button>
                ) : (
                  info.organisation
                )}
                {info.seniority && info.seniority !== "—"
                  ? ` · ${info.seniority}`
                  : ""}
              </p>
            )}
            {/* Cross-tab record links, in the same header position as the contact and
                opportunity forms (the linked opportunity used to sit at the bottom). */}
            {target.mode === "edit" && (onOpenContact || onOpenOpportunity) && (
              <p className="mform-links">
                {onOpenContact && target.row.contact_url && (
                  <button
                    type="button"
                    className="mform-inline-btn"
                    onClick={() => onOpenContact(target.row.contact_url)}
                  >
                    Open contact →
                  </button>
                )}
                {onOpenOpportunity && draft.linked_opportunity_id && (
                  <button
                    type="button"
                    className="mform-inline-btn"
                    onClick={() => onOpenOpportunity(draft.linked_opportunity_id!)}
                  >
                    View opportunity →
                  </button>
                )}
              </p>
            )}
            {/* Earlier meetings with this contact (for #2+), to review prior notes. */}
            {priorMeetings.length > 0 && (
              <p className="mform-links">
                <span className="mform-prev-label">Previous:</span>
                {priorMeetings.map((pm) => (
                  <button
                    key={pm.id}
                    type="button"
                    className="mform-inline-btn"
                    title={`Open meeting #${pm.meeting_no}`}
                    onClick={() => onOpenPrevMeeting?.(pm.id)}
                  >
                    #{pm.meeting_no}
                  </button>
                ))}
              </p>
            )}
            {/* One-click: flag this contact as the decision-maker (writes their decision
                role straight away — capture it where you learn it). */}
            {!isNew && onToggleDecisionMaker && (
              <button
                type="button"
                className={
                  isDecisionMaker
                    ? "mform-dm-toggle mform-dm-toggle--on"
                    : "mform-dm-toggle"
                }
                title={
                  isDecisionMaker
                    ? "Decision-maker — click to unset"
                    : "Mark this contact as the decision-maker"
                }
                onClick={onToggleDecisionMaker}
              >
                {isDecisionMaker ? "★ Decision-maker" : "☆ Mark decision-maker"}
              </button>
            )}
          </div>
          <button
            type="button"
            className="mform-close"
            title="Close without saving"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="mform-body">
          {/* Completeness obligation: a held meeting must have a full write-up. */}
          {missing.length > 0 && (
            <div className="mform-overdue-banner mform-writeup-banner" role="alert">
              <strong>📝 Complete the write-up.</strong> This meeting is held but{" "}
              {missing.length} field{missing.length === 1 ? "" : "s"} still need
              {missing.length === 1 ? "s" : ""} filling: {missing.join(", ")}. It stays in
              “This week” until done.
            </div>
          )}

          {/* Overdue banner: names exactly what's late and how to clear it, pointing at
              the highlighted date field(s) below. */}
          {anyOverdue && (
            <div className="mform-overdue-banner" role="alert">
              <strong>⚠ Overdue.</strong>{" "}
              {scheduledOverdue > 0 && (
                <>
                  This meeting was scheduled {scheduledOverdue} day
                  {scheduledOverdue === 1 ? "" : "s"} ago but is still “Scheduled”.
                  Mark it <em>Held</em> (and set <em>Date held</em>), or move{" "}
                  <em>Date scheduled</em>.{" "}
                </>
              )}
              {followupOverdue > 0 && (
                <>
                  The follow-up was due {followupOverdue} day
                  {followupOverdue === 1 ? "" : "s"} ago — action it, then update or
                  clear <em>Follow-up date</em>.
                </>
              )}
            </div>
          )}

          {/* Quick actions (edit mode): one click to advance the meeting's state. */}
          {!isNew && notHeldYet && (
            <div className="mform-actions">
              <button
                type="button"
                className="mform-secondary"
                title="Set stage to Held and date held to today"
                onClick={markHeldToday}
              >
                ✓ Mark held today
              </button>
            </div>
          )}

          {/* New mode: choose the contact first. */}
          {isNew && (
            <Field label="Contact">
              <select
                className="mform-control"
                value={contactUrl}
                onChange={(e) => setContactUrl(e.target.value)}
              >
                <option value="">Choose a contact…</option>
                {contacts.map((c) => (
                  <option key={c.url} value={c.url}>
                    {`${c.first} ${c.last}`.trim()}
                    {c.organisation ? ` — ${c.organisation}` : ""}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {/* ── Logistics ───────────────────────────────────────────────── */}
          <fieldset className="mform-section">
            <legend>Logistics</legend>
            <div className="mform-grid">
              <Field label="Stage">
                <Select
                  value={draft.meeting_stage}
                  options={MEETING_STAGE}
                  onChange={(v) =>
                    set("meeting_stage", v as Meeting["meeting_stage"])
                  }
                />
              </Field>
              <Field label="Type">
                <Select
                  value={draft.type}
                  options={MEETING_TYPE}
                  onChange={(v) => set("type", (v || undefined) as Meeting["type"])}
                />
              </Field>
              <Field label="Date agreed">
                <DateInput
                  value={draft.date_agreed}
                  onChange={(v) => set("date_agreed", v)}
                />
              </Field>
              <Field label="Date scheduled">
                <DateInput
                  value={draft.date_scheduled}
                  onChange={(v) => set("date_scheduled", v)}
                  overdue={scheduledOverdue > 0}
                />
                {scheduledOverdue > 0 && (
                  <span className="mform-overdue-tag">
                    Overdue by {scheduledOverdue} day
                    {scheduledOverdue === 1 ? "" : "s"}
                  </span>
                )}
              </Field>
              <Field label="Date held">
                <DateInput
                  value={draft.date_held}
                  onChange={(v) => set("date_held", v)}
                />
              </Field>
              <Field label="Location">
                <input
                  type="text"
                  className="mform-control"
                  value={draft.location ?? ""}
                  onChange={(e) => set("location", e.target.value)}
                />
              </Field>
              <Field label="Attendees (ours)">
                <input
                  type="text"
                  className="mform-control"
                  value={draft.attendees_ours ?? ""}
                  onChange={(e) => set("attendees_ours", e.target.value)}
                />
              </Field>
              <Field label="Attendees (client)">
                <input
                  type="text"
                  className="mform-control"
                  value={draft.attendees_client ?? ""}
                  onChange={(e) => set("attendees_client", e.target.value)}
                />
              </Field>
            </div>
          </fieldset>

          {/* ── Write-up: the long free-text fields this redesign is for ──── */}
          <fieldset className="mform-section">
            <legend>Write-up</legend>
            <Field label="Purpose">
              <TextArea
                value={draft.purpose}
                onChange={(v) => set("purpose", v)}
              />
            </Field>
            <Field label="Notes">
              <TextArea
                value={draft.notes}
                onChange={(v) => set("notes", v)}
                rows={6}
              />
            </Field>
            <Field label="Org insights">
              <TextArea
                value={draft.org_insights}
                onChange={(v) => set("org_insights", v)}
              />
            </Field>
            <Field label="Pain points">
              <TextArea
                value={draft.pain_points}
                onChange={(v) => set("pain_points", v)}
              />
            </Field>
            <Field label="Actions (mine)">
              <TextArea
                value={draft.actions_mine}
                onChange={(v) => set("actions_mine", v)}
              />
            </Field>
            <Field label="Actions (theirs)">
              <TextArea
                value={draft.actions_theirs}
                onChange={(v) => set("actions_theirs", v)}
              />
            </Field>
            <Field label="Follow-up">
              <TextArea
                value={draft.followup}
                onChange={(v) => set("followup", v)}
              />
            </Field>
            <Field label="Sentiment">
              <Select
                value={draft.sentiment}
                options={SENTIMENT}
                onChange={(v) =>
                  set("sentiment", (v || undefined) as Meeting["sentiment"])
                }
              />
            </Field>
          </fieldset>

          {/* ── Outcome ─────────────────────────────────────────────────── */}
          <fieldset className="mform-section">
            <legend>Outcome</legend>
            <div className="mform-grid">
              <Field label="Follow-up date">
                <DateInput
                  value={draft.followup_date}
                  onChange={(v) => set("followup_date", v)}
                  overdue={followupOverdue > 0}
                />
                {followupOverdue > 0 && (
                  <span className="mform-overdue-tag">
                    Overdue by {followupOverdue} day
                    {followupOverdue === 1 ? "" : "s"}
                  </span>
                )}
              </Field>
              <Field label="Opportunity spotted">
                <Select
                  value={draft.opportunity_spotted}
                  options={OPPORTUNITY_SPOTTED}
                  onChange={(v) =>
                    set(
                      "opportunity_spotted",
                      (v || undefined) as Meeting["opportunity_spotted"],
                    )
                  }
                />
              </Field>
              {/* The linked opportunity (auto-created when opportunity_spotted = Yes, §7).
                  The clickable link lives in the header now; this just shows the status. */}
              <Field label="Linked opportunity">
                <span className="mform-readonly">
                  {draft.linked_opportunity_id ? "Linked (see header ↑)" : "—"}
                </span>
              </Field>
            </div>
          </fieldset>
        </div>

        {/* ── Footer: Cancel · (Delete) · Save ────────────────────────────── */}
        <footer className="mform-footer">
          {!isNew && onDelete && (
            <button
              type="button"
              className="mform-delete"
              onClick={() => onDelete(target.row.id)}
            >
              Delete meeting
            </button>
          )}
          {!isNew && onScheduleFollowup && (
            <button
              type="button"
              className="mform-secondary"
              title="Create a follow-up meeting 2 months after this one"
              onClick={onScheduleFollowup}
            >
              + Follow-up (2 months)
            </button>
          )}
          <span className="mform-footer-spacer" />
          <button type="button" className="mform-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="mform-save"
            disabled={!canSave}
            onClick={handleSave}
          >
            Save
          </button>
        </footer>
      </aside>
    </div>
  );
}

// ── Small labeled-field helpers ──────────────────────────────────────────────
// Form-mode replacements for the old inline cell helpers: a label above each
// control, so the long form stays readable and every field is one element.

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mform-field">
      <span className="mform-label">{label}</span>
      {children}
    </label>
  );
}

function TextArea({
  value,
  onChange,
  rows = 3,
}: {
  value?: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <textarea
      className="mform-control mform-textarea"
      rows={rows}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function DateInput({
  value,
  onChange,
  overdue = false,
}: {
  value?: string;
  onChange: (v: string) => void;
  // When true, outline the field red to flag an overdue date.
  overdue?: boolean;
}) {
  return (
    <input
      type="date"
      className={overdue ? "mform-control mform-overdue" : "mform-control"}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// Whole days from `fromISO` to `toISO` (positive = toISO is later). Parsed at local
// midnight so a daylight-saving shift can't push the count off by one. Mirrors the
// helper in data/agenda.ts (kept local so the form has no extra export dependency).
function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T00:00:00`).getTime();
  const b = new Date(`${toISO}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function Select({
  value,
  options,
  onChange,
}: {
  value?: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      className="mform-control"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
