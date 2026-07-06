import { useEffect, useState } from "react";
import { StageTracker } from "../components/StageTracker";
import type { Contact } from "../data/contacts";
import type { OwnerEdits } from "../storage/ownerEdits";
import type { MeetingRow } from "../data/meetings";
import type { Opportunity } from "../storage/opportunities";
import { weightedValue, opportunityStatus, opportunityPhase } from "../data/opportunities";
import { formatMoney } from "../data/format";
import {
  RELATIONSHIP_STRENGTH,
  PRIORITY,
  DECISION_ROLE,
} from "../data/vocab";
import { Field, TextField, TextArea, Select } from "./formControls";
import { ContactLinks } from "../components/BrandIcons";
import { useAiAvailable, aiPrompt, aiJson } from "../ai/ai";
import { draftMessagePrompt, briefContactPrompt, suggestCrmPrompt, type DraftKind, type CrmSuggest } from "../ai/prompts";
import { contactSignalsText } from "../ai/compute";
import { relevantNotes } from "../storage/memory";
import { AiSuggest } from "../components/AiSuggest";

// Default home country until an org→country mapping is wired up.
const DEFAULT_BASED_IN = "Saudi Arabia";

// The slide-in detail/edit panel for a single contact (CLAUDE.md §4), built on the
// SAME buffer-and-save model as MeetingForm / OpportunityForm: the read-only pipeline
// fields are shown for context and the owner-maintained fields are edited in a local
// `draft` that only hits storage on Save. Cancel / backdrop / Escape close without
// saving. It reuses the shared `mform-*` panel styles and the shared form controls.
//
// Unlike the other forms there is no "new" mode: contacts come from the LinkedIn
// pipeline, the owner never creates one — they only layer their CRM fields on top.

// The merged row the table renders (pipeline contact + its owner edits). Defined here
// so the parent and the form agree on the shape passed in.
export type ContactRow = Contact & OwnerEdits;

// Pull just the eight owner-editable fields off a row into a fresh draft, so editing
// never touches the read-only pipeline data.
function draftFromRow(row: ContactRow): OwnerEdits {
  return {
    based_in: row.based_in,
    relationship_strength: row.relationship_strength,
    priority: row.priority,
    decision_role: row.decision_role,
    last_contact_date: row.last_contact_date,
    next_action: row.next_action,
    next_action_date: row.next_action_date,
    notes: row.notes,
  };
}

export function ContactForm({
  contact,
  pipelinePhone,
  ownerPhone,
  meetingCount = 0,
  oppCount = 0,
  meetings = [],
  opportunities = [],
  lastMet,
  met = false,
  onSave,
  onOpenMeetings,
  onOpenOpportunities,
  onOpenMeeting,
  onOpenOpportunity,
  onLogMeeting,
  onAddOpportunity,
  onOpenAccount,
  onClose,
}: {
  contact: ContactRow;
  // The number auto-extracted from messages (read-only), shown as a placeholder.
  pipelinePhone: string;
  // The owner's manually-entered override, if any — this is what the field edits.
  ownerPhone: string | undefined;
  // How many meetings / opportunities are linked to this contact (badge on the links).
  meetingCount?: number;
  oppCount?: number;
  // This contact's actual meetings / opportunities, shown inline as clickable lists.
  meetings?: MeetingRow[];
  opportunities?: Opportunity[];
  // Derived from meetings: the most recent held date ("Last met"), and whether ever met.
  lastMet?: string;
  met?: boolean;
  // Persist this contact's edits (keyed by the stable url) — buffered until Save.
  onSave: (url: string, edits: OwnerEdits) => void;
  // Cross-tab links: this contact's meetings / opportunities, filtered to them.
  onOpenMeetings?: () => void;
  onOpenOpportunities?: () => void;
  // Open one specific linked meeting / opportunity (from the inline lists).
  onOpenMeeting?: (id: string) => void;
  onOpenOpportunity?: (id: string) => void;
  // Shortcuts: start a NEW meeting / opportunity already linked to this contact.
  onLogMeeting?: () => void;
  onAddOpportunity?: () => void;
  // Open this contact's organisation "account" overlay (clicking the org name).
  onOpenAccount?: () => void;
  onClose: () => void;
}) {
  // Local working copy. Nothing here touches storage until Save. The phone field edits
  // ONLY the owner override; the pipeline number stays untouched and is the placeholder.
  const [draft, setDraft] = useState<OwnerEdits>({
    ...draftFromRow(contact),
    based_in: contact.based_in || DEFAULT_BASED_IN,
    phone: ownerPhone,
  });

  // The number used for the WhatsApp link: the owner's override wins, else the pipeline
  // number. (Blank override never hides the auto-detected one.)
  const effectivePhone = draft.phone?.trim() || pipelinePhone;

  // AI affordances (draft a message / brief me) — only shown when the host can run inference.
  const aiReady = useAiAvailable();
  const [aiPanel, setAiPanel] = useState<"draft" | "brief" | null>(null);
  const [draftKind, setDraftKind] = useState<DraftKind>("first-touch");
  const [crmBusy, setCrmBusy] = useState(false);
  const [crmNote, setCrmNote] = useState<string | null>(null);

  // Auto-suggest CRM fields from what's known (relationship, priority, decision role, next action).
  // Fills the form's own fields so the owner reviews and Saves (A2). next_action/date persist and
  // surface in the table even though they have no input here, so we echo them in the note.
  async function suggestCrm() {
    if (crmBusy) return;
    setCrmBusy(true);
    setCrmNote(null);
    try {
      const j = await aiJson<CrmSuggest>(suggestCrmPrompt(contact, meetings, RELATIONSHIP_STRENGTH, PRIORITY, DECISION_ROLE, contactSignalsText(contact)));
      const nextDate = j.next_action_days > 0 ? new Date(Date.now() + j.next_action_days * 86_400_000).toISOString().slice(0, 10) : undefined;
      setDraft((d) => ({
        ...d,
        relationship_strength: (RELATIONSHIP_STRENGTH as readonly string[]).includes(j.relationship_strength) ? (j.relationship_strength as OwnerEdits["relationship_strength"]) : d.relationship_strength,
        priority: (PRIORITY as readonly string[]).includes(j.priority) ? (j.priority as OwnerEdits["priority"]) : d.priority,
        decision_role: (DECISION_ROLE as readonly string[]).includes(j.decision_role) ? (j.decision_role as OwnerEdits["decision_role"]) : d.decision_role,
        next_action: j.next_action?.trim() || d.next_action,
        next_action_date: nextDate ?? d.next_action_date,
      }));
      setCrmNote(j.next_action?.trim() ? `Suggested next action: ${j.next_action.trim()} — review & Save.` : "Filled the fields below — review & Save.");
    } catch {
      setCrmNote("Couldn't suggest those — try again or set them manually.");
    } finally {
      setCrmBusy(false);
    }
  }

  // Save, normalising a blank phone to "unset" so it never persists "" over the pipeline.
  function commit() {
    const cleaned: OwnerEdits = {
      ...draft,
      phone: draft.phone?.trim() ? draft.phone.trim() : undefined,
    };
    onSave(contact.url, cleaned);
  }

  // Escape closes the panel without saving (same as Cancel / backdrop).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Update one field of the local draft.
  function set<K extends keyof OwnerEdits>(field: K, value: OwnerEdits[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  const name = `${contact.first} ${contact.last}`.trim();
  const yn = (b: boolean) => (b ? "Yes" : "—");

  // The single most relevant date to show for a linked meeting (latest milestone).
  const meetingDate = (m: MeetingRow) =>
    m.date_held || m.date_scheduled || m.date_agreed || "—";

  return (
    // Backdrop: clicking it (but not the panel) cancels.
    <div className="mform-backdrop" onClick={onClose}>
      <aside
        className="mform-panel"
        role="dialog"
        aria-label="Contact details"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header: who the contact is ──────────────────────────────────── */}
        <header className="mform-header">
          <div>
            <h3 className="mform-title">
              {name || "Contact"}
              <ContactLinks url={contact.url} phone={effectivePhone} />
            </h3>
            <p className="mform-subtitle">
              {onOpenAccount && contact.organisation ? (
                <button
                  type="button"
                  className="org-link"
                  title="View this organisation’s account"
                  onClick={onOpenAccount}
                >
                  {contact.organisation}
                </button>
              ) : (
                contact.organisation
              )}
              {contact.seniority ? ` · ${contact.seniority}` : ""}
            </p>
            <StageTracker
              messaged={contact.messaged}
              responded={contact.two_way}
              agreed={contact.agreed_to_meet}
              met={contact.met}
              className="stage-track--form"
            />
            {(onOpenMeetings || onOpenOpportunities) && (
              <p className="mform-links">
                {onOpenMeetings && (
                  <button type="button" className="mform-inline-btn" onClick={onOpenMeetings}>
                    Meetings ({meetingCount}) →
                  </button>
                )}
                {onOpenOpportunities && (
                  <button type="button" className="mform-inline-btn" onClick={onOpenOpportunities}>
                    Opportunities ({oppCount}) →
                  </button>
                )}
              </p>
            )}
            {(onLogMeeting || onAddOpportunity) && (
              <p className="mform-links">
                {onLogMeeting && (
                  <button type="button" className="mform-inline-btn" onClick={onLogMeeting}>
                    + Log meeting
                  </button>
                )}
                {onAddOpportunity && (
                  <button type="button" className="mform-inline-btn" onClick={onAddOpportunity}>
                    + Add opportunity
                  </button>
                )}
              </p>
            )}
            {aiReady && (
              <p className="mform-links mform-ai-links">
                <button type="button" className="mform-inline-btn" onClick={() => { setDraftKind("first-touch"); setAiPanel("draft"); }}>
                  Draft: reach out
                </button>
                <button type="button" className="mform-inline-btn" onClick={() => { setDraftKind("follow-up"); setAiPanel("draft"); }}>
                  Follow up
                </button>
                <button type="button" className="mform-inline-btn" onClick={() => { setDraftKind("reconnect"); setAiPanel("draft"); }}>
                  Reconnect
                </button>
                <button type="button" className="mform-inline-btn" onClick={() => setAiPanel("brief")}>
                  Brief me
                </button>
              </p>
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
          {/* ── Linked records: this contact's meetings & opportunities ───── */}
          {(meetings.length > 0 || opportunities.length > 0) && (
            <fieldset className="mform-section">
              <legend>Linked records</legend>
              {meetings.length > 0 && (
                <>
                  <h5 className="cform-mini-head">Meetings ({meetings.length})</h5>
                  <ul className="account-list">
                    {meetings.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          className="account-row"
                          disabled={!onOpenMeeting}
                          onClick={() => onOpenMeeting?.(m.id)}
                        >
                          <span className="account-row-main">
                            Meeting #{m.meeting_no}
                          </span>
                          <span className="account-row-meta">
                            {(m.meeting_stage || "—") + " · " + meetingDate(m)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {opportunities.length > 0 && (
                <>
                  <h5 className="cform-mini-head">
                    Opportunities ({opportunities.length})
                  </h5>
                  <ul className="account-list">
                    {opportunities.map((o) => (
                      <li key={o.id}>
                        <button
                          type="button"
                          className="account-row"
                          disabled={!onOpenOpportunity}
                          onClick={() => onOpenOpportunity?.(o.id)}
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
                </>
              )}
            </fieldset>
          )}

          {/* ── Pipeline data: read-only, for context ─────────────────────── */}
          <fieldset className="mform-section">
            <legend>Pipeline (read-only)</legend>
            <div className="mform-grid">
              <Field label="Position">
                <span className="mform-readonly">{contact.position || "—"}</span>
              </Field>
              <Field label="Function">
                <span className="mform-readonly">{contact.function || "—"}</span>
              </Field>
              <Field label="Sector (detail)">
                <span className="mform-readonly">
                  {contact.sector_detail || "—"}
                </span>
              </Field>
              <Field label="Sector group">
                <span className="mform-readonly">
                  {contact.sector_group || "—"}
                </span>
              </Field>
              {/* Funnel stages (CLAUDE.md §5 terminology). "Responded" is the two-way
                  flag the funnel uses; "Met" is derived from a held meeting. */}
              <Field label="Messaged">
                <span className="mform-readonly">{yn(contact.messaged)}</span>
              </Field>
              <Field label="Responded">
                <span className="mform-readonly">{yn(contact.two_way)}</span>
              </Field>
              <Field label="Agreed to meet">
                <span className="mform-readonly">
                  {yn(contact.agreed_to_meet)}
                </span>
              </Field>
              <Field label="Met">
                <span className="mform-readonly">{yn(met)}</span>
              </Field>
            </div>
          </fieldset>

          {/* ── Owner-maintained CRM fields: the editable part ────────────── */}
          <fieldset className="mform-section">
            <legend>Your CRM fields</legend>
            {aiReady && (
              <div className="mform-ai-row">
                <button type="button" className="mform-secondary" disabled={crmBusy} onClick={suggestCrm}
                  title="Suggest relationship, priority, decision role and a next action from what's known">
                  {crmBusy ? "Thinking…" : "Auto-suggest with AI"}
                </button>
                {crmNote && <span className="mform-ai-note">{crmNote}</span>}
              </div>
            )}
            <div className="mform-grid">
              <Field label="Based in">
                <TextField
                  value={draft.based_in}
                  onChange={(v) => set("based_in", v)}
                />
              </Field>
              <Field label="Phone / WhatsApp">
                <TextField
                  value={draft.phone}
                  onChange={(v) => set("phone", v)}
                  placeholder={pipelinePhone || "e.g. +966 5X XXX XXXX"}
                />
              </Field>
              <Field label="Relationship">
                <Select
                  value={draft.relationship_strength}
                  options={RELATIONSHIP_STRENGTH}
                  onChange={(v) =>
                    set(
                      "relationship_strength",
                      (v || undefined) as OwnerEdits["relationship_strength"],
                    )
                  }
                />
              </Field>
              <Field label="Priority">
                <Select
                  value={draft.priority}
                  options={PRIORITY}
                  onChange={(v) =>
                    set("priority", (v || undefined) as OwnerEdits["priority"])
                  }
                />
              </Field>
              <Field label="Decision role">
                <Select
                  value={draft.decision_role}
                  options={DECISION_ROLE}
                  onChange={(v) =>
                    set(
                      "decision_role",
                      (v || undefined) as OwnerEdits["decision_role"],
                    )
                  }
                />
              </Field>
              <Field label="Last met">
                {/* Derived from the most recent held meeting — actions/next steps live on
                    the Meetings and Opportunities tabs, not here. */}
                <span className="mform-readonly">{lastMet || "—"}</span>
              </Field>
            </div>
            <Field label="Notes">
              <TextArea
                value={draft.notes}
                onChange={(v) => set("notes", v)}
                rows={5}
              />
            </Field>
          </fieldset>
        </div>

        {/* ── Footer: Clear · Cancel · Save ───────────────────────────────── */}
        <footer className="mform-footer">
          <button
            type="button"
            className="mform-delete"
            title="Remove all your CRM fields for this contact"
            onClick={() => onSave(contact.url, {})}
          >
            Clear my edits
          </button>
          <span className="mform-footer-spacer" />
          <button type="button" className="mform-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="mform-save" onClick={commit}>
            Save
          </button>
        </footer>
      </aside>

      {aiPanel === "draft" && (
        <AiSuggest
          title="Draft a message"
          subtitle={`To ${name || "this contact"} · ${draftKind === "first-touch" ? "first outreach" : draftKind === "follow-up" ? "follow-up" : "reconnect"}`}
          generate={(tweak) => aiPrompt(draftMessagePrompt(contact, meetings, draftKind, tweak, relevantNotes(`${name} ${contact.organisation || ""}`).map((n) => n.text).join("\n"), contactSignalsText(contact)))}
          tweaks={[
            { label: "Shorter", instruction: "Make it shorter — 1–2 sentences." },
            { label: "Warmer", instruction: "Make it warmer and more personal." },
            { label: "More direct", instruction: "Make it more direct and to the point." },
          ]}
          onClose={() => setAiPanel(null)}
        />
      )}
      {aiPanel === "brief" && (
        <AiSuggest
          title={`Brief: ${name || "contact"}`}
          subtitle="Pre-outreach summary"
          editable={false}
          generate={() => aiPrompt(briefContactPrompt(contact, meetings, relevantNotes(`${name} ${contact.organisation || ""}`).map((n) => n.text).join("\n"), contactSignalsText(contact)))}
          onClose={() => setAiPanel(null)}
        />
      )}
    </div>
  );
}
