import { useEffect, useMemo, useState } from "react";
import type { Opportunity } from "../storage/opportunities";
import type { Contact } from "../data/contacts";
import {
  weightedValue,
  serviceLineForFunction,
  opportunityStatus,
  opportunityPhase,
  meetingContext,
} from "../data/opportunities";
import type { Meeting } from "../storage/meetings";
import { nextStepInfo, addWeeks } from "../data/timeline";
import { todayISO, daysBetween } from "../data/agenda";
import {
  SERVICE_LINE,
  OPPORTUNITY_STEPS,
  CONSULTING_FIRMS,
  WON_STEP,
  stepDef,
  stepIndex,
  PROBABILITY,
  OTHER_FUNCTIONS,
  SECTOR_GROUPS,
  probabilityLabel,
  type OpportunityStep,
} from "../data/vocab";
import { formatMoney } from "../data/format";
import { Field, TextField, TextArea, DateInput, NumberInput, Select, MultiSelect } from "./formControls";

// The slide-in detail/edit panel for a single opportunity (CLAUDE.md §4), built on
// the same buffer-and-save model as MeetingForm: all edits live in local `draft`
// state and only hit storage on Save. Cancel / backdrop / Escape close without
// saving. It reuses the shared `mform-*` panel styles.
//
// The heart of the form is the WORKFLOW checklist: the granular selling-and-delivery
// steps (../data/vocab.ts OPPORTUNITY_STEPS), each with a date. "Advance" stamps the
// next step's date to today, suggests its win-probability, and sets the next activity's
// due date — so the form always prompts what's next (the dates roll up to phases for the
// Metrics/Dashboard funnels).

export type OpportunityFormTarget =
  | { mode: "edit"; opp: Opportunity }
  // contactUrl pre-links the new opportunity to a contact (from a "Add opportunity"
  // shortcut on the contact form).
  | { mode: "new"; contactUrl?: string };

// A new opportunity starts at the first workflow step, FAAS (the owner's default service
// line). Its Open/Won/Lost outcome is derived from the step + the lost flag.
const EMPTY: Opportunity = {
  id: "", // filled in by the parent on save (random id for manual opportunities)
  opportunity_name: "",
  organisation: "",
  primary_contact: "",
  service_line: "Strategy",
  current_step: "meeting",
};

export function OpportunityForm({
  target,
  contacts,
  linkedSowId,
  sourceMeeting,
  onSave,
  onDelete,
  onOpenContact,
  onOpenMeeting,
  onOpenAccount,
  onOpenSow,
  onCreateSow,
  onClose,
}: {
  target: OpportunityFormTarget;
  contacts: Contact[];
  // The SoW already linked to this opportunity, if any (drives View vs Create SoW).
  linkedSowId?: string;
  // The meeting this opportunity was spotted in, so the form can re-pull its pain
  // points / org insights into the description on demand.
  sourceMeeting?: Meeting;
  onSave: (opp: Opportunity) => void;
  onDelete?: (id: string) => void;
  // Cross-tab links: open this opportunity's contact / source meeting in its own tab.
  onOpenContact?: (contactUrl: string) => void;
  onOpenMeeting?: (meetingId: string) => void;
  // Open this opportunity's organisation "account" overlay (clicking the org name).
  onOpenAccount?: (org: string) => void;
  // Revenue loop: open the linked SoW, or create one from this (won) opportunity.
  onOpenSow?: (sowId: string) => void;
  onCreateSow?: () => void;
  onClose: () => void;
}) {
  const isNew = target.mode === "new";
  // A contact to pre-link a NEW opportunity to (from the contact form's shortcut).
  const presetContactUrl = target.mode === "new" ? target.contactUrl : undefined;

  const [draft, setDraft] = useState<Opportunity>(
    isNew ? { ...EMPTY } : { ...target.opp },
  );

  // For an existing opportunity linked to a contact but without its own function / sector
  // group (e.g. auto-created from a meeting), default to the linked contact's values.
  useEffect(() => {
    if (isNew || !draft.contact_url) return;
    if (draft.function && draft.sector_group) return;
    const c = contacts.find((x) => x.url === draft.contact_url);
    if (!c) return;
    setDraft((d) => ({
      ...d,
      function: d.function || c.function || undefined,
      sector_group: d.sector_group || c.sector_group || undefined,
    }));
  }, [contacts, isNew, draft.contact_url]);

  // Contacts for the linked-contact picker, sorted by name.
  const contactOptions = useMemo(
    () =>
      [...contacts].sort((a, b) =>
        `${a.first} ${a.last}`.localeCompare(`${b.first} ${b.last}`),
      ),
    [contacts],
  );

  // The function dropdown's choices: every function in the contacts + the current value,
  // with the "Other Functions" catch-all pinned LAST (§6 rule 3).
  const functionOptions = useMemo(() => {
    const fns = new Set<string>();
    for (const c of contacts) if (c.function) fns.add(c.function);
    if (draft.function) fns.add(draft.function);
    return [...fns]
      .filter((f) => f !== OTHER_FUNCTIONS)
      .sort((a, b) => a.localeCompare(b))
      .concat(OTHER_FUNCTIONS);
  }, [contacts, draft.function]);

  function pickContact(url: string) {
    const c = contacts.find((x) => x.url === url);
    setDraft((d) => {
      const fn = c ? c.function || d.function : d.function;
      return {
        ...d,
        contact_url: url || undefined,
        organisation: c ? c.organisation : d.organisation,
        primary_contact: c ? `${c.first} ${c.last}`.trim() : d.primary_contact,
        function: fn,
        sector_group: c ? c.sector_group || d.sector_group : d.sector_group,
        service_line: serviceLineForFunction(fn) ?? d.service_line,
      };
    });
  }

  // When opened from a contact's "Add opportunity" shortcut, pre-link the new opportunity.
  useEffect(() => {
    if (!isNew || !presetContactUrl || draft.contact_url || contacts.length === 0)
      return;
    const c = contacts.find((x) => x.url === presetContactUrl);
    pickContact(presetContactUrl);
    if (c) {
      const nm = `${c.first} ${c.last}`.trim();
      set("opportunity_name", `${c.organisation} — ${nm}`.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, presetContactUrl, contacts]);

  // Setting the buyer function pre-fills the seller service line (a suggested default).
  function setFunction(fn: string | undefined) {
    setDraft((d) => ({
      ...d,
      function: fn,
      service_line: serviceLineForFunction(fn) ?? d.service_line,
    }));
  }

  // Escape closes without saving (same as Cancel / backdrop).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function set<K extends keyof Opportunity>(field: K, value: Opportunity[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  // ── Workflow edits ────────────────────────────────────────────────────────
  function setStepDate(id: OpportunityStep, v: string) {
    setDraft((d) => ({
      ...d,
      step_dates: { ...(d.step_dates ?? {}), [id]: v || undefined },
    }));
  }
  // Mark a step done (click it in the checklist, or via Advance / Mark Won). "We're at
  // this step as of today": stamp the clicked step = today, then re-date every step after
  // the EARLIER of the old/new current relative to today using the standard offsets — so
  // skipped interim steps land at standard intervals working BACK from today, and future
  // steps re-plan forward. Steps before that point keep their dates. Probability follows
  // the step (stored on Save).
  function setStepDone(targetId: OpportunityStep) {
    setDraft((d) => {
      const tIdx = stepIndex(targetId);
      const tOffset = stepDef(targetId).offsetWeeks;
      const cIdx = stepIndex(d.current_step);
      const step_dates = { ...(d.step_dates ?? {}) };
      for (let j = Math.min(cIdx, tIdx) + 1; j < OPPORTUNITY_STEPS.length; j++) {
        const s = OPPORTUNITY_STEPS[j];
        step_dates[s.id] = addWeeks(today, s.offsetWeeks - tOffset);
      }
      step_dates[targetId] = today;
      return {
        ...d,
        current_step: targetId,
        step_dates,
        lost: undefined,
        probability: stepDef(targetId).prob,
      };
    });
  }
  // Advance to the next step (same behaviour as clicking it).
  function advance() {
    const nx = nextStepInfo(draft);
    if (nx) setStepDone(nx.step);
  }
  // Mark Won = jump to the signature step.
  function markWon() {
    setStepDone(WON_STEP);
  }
  function markLost() {
    setDraft((d) => ({ ...d, lost: true }));
  }
  function reopen() {
    setDraft((d) => ({ ...d, lost: undefined }));
  }

  // ── Attention flagging (live off the draft, clears as the deal moves) ──────
  const today = useMemo(() => todayISO(), []);
  const isLost = !!draft.lost;
  const isOpen = opportunityStatus(draft) === "Open";
  const curIdx = stepIndex(draft.current_step);
  const overdueDays = (d?: string) => (d && d < today ? daysBetween(d, today) : 0);

  // The next activity (step after the current one) — its planned date drives the "next
  // step" due date and the Advance button label.
  const next = nextStepInfo(draft);
  const nextStepOverdue = isOpen ? overdueDays(next?.date) : 0;

  // Step slippage: a step whose PLANNED date has passed but it hasn't been reached yet
  // (its index is beyond the current step). Only meaningful while the deal is open.
  const slipped = isOpen
    ? OPPORTUNITY_STEPS.filter(
        (s, i) => i > curIdx && overdueDays(draft.step_dates?.[s.id]) > 0,
      )
    : [];
  const slippedIds = new Set(slipped.map((s) => s.id));
  // For the banner's second line: slipped steps BEYOND the immediate next one (which the
  // first line already covers), so we don't say the same thing twice.
  const slippedLater = slipped.filter((s) => s.id !== next?.step);
  const anyAttention = nextStepOverdue > 0 || slipped.length > 0;

  // Auto-calculated weighted value (§6 rule 4 — read-only).
  const weighted = weightedValue(draft);

  const canSave = draft.opportunity_name.trim() !== "";
  function handleSave() {
    if (!canSave) return;
    onSave(draft);
  }

  return (
    <div className="mform-backdrop" onClick={onClose}>
      <aside
        className="mform-panel"
        role="dialog"
        aria-label="Opportunity details"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mform-header">
          <div>
            <h3 className="mform-title">
              {isNew ? "New opportunity" : draft.opportunity_name || "Opportunity"}
            </h3>
            {!isNew && draft.organisation && (
              <p className="mform-subtitle">
                {onOpenAccount ? (
                  <button
                    type="button"
                    className="org-link"
                    title="View this organisation’s account"
                    onClick={() => onOpenAccount(draft.organisation)}
                  >
                    {draft.organisation}
                  </button>
                ) : (
                  draft.organisation
                )}
              </p>
            )}
            {!isNew &&
              (onOpenContact || onOpenMeeting || (linkedSowId && onOpenSow)) && (
                <p className="mform-links">
                  {draft.contact_url && onOpenContact && (
                    <button
                      type="button"
                      className="mform-inline-btn"
                      onClick={() => onOpenContact(draft.contact_url!)}
                    >
                      Open contact →
                    </button>
                  )}
                  {draft.source_meeting_id && onOpenMeeting && (
                    <button
                      type="button"
                      className="mform-inline-btn"
                      onClick={() => onOpenMeeting(draft.source_meeting_id!)}
                    >
                      View source meeting →
                    </button>
                  )}
                  {linkedSowId && onOpenSow && (
                    <button
                      type="button"
                      className="mform-inline-btn"
                      onClick={() => onOpenSow(linkedSowId)}
                    >
                      View contract →
                    </button>
                  )}
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
          {/* Status line: phase · outcome · next activity. */}
          {!isNew && (
            <p className="mform-note oppflow-status">
              Phase <strong>{opportunityPhase(draft)}</strong> ·{" "}
              <strong>{opportunityStatus(draft)}</strong>
              {next && !isLost && (
                <>
                  {" "}· Next: {next.short}
                  {next.date ? ` (due ${next.date})` : ""}
                </>
              )}
            </p>
          )}

          {/* Attention banner: names what's slipping and points at the red field(s). */}
          {anyAttention && (
            <div className="mform-overdue-banner" role="alert">
              <strong>⚠ Needs attention.</strong>{" "}
              {nextStepOverdue > 0 && (
                <>
                  The next activity ({next?.short}) was due {nextStepOverdue} day
                  {nextStepOverdue === 1 ? "" : "s"} ago.{" "}
                </>
              )}
              {slippedLater.length > 0 && (
                <>
                  Later planned{" "}
                  {slippedLater.map((s) => s.short.toLowerCase()).join(", ")} date
                  {slippedLater.length === 1 ? " has" : "s have"} also passed. Advance the
                  step (its date stamps itself), or update the dates below.
                </>
              )}
            </div>
          )}

          {/* Quick actions: drive the workflow in one click. */}
          {!isNew && (
            <div className="mform-actions">
              {isLost ? (
                <button type="button" className="mform-secondary" onClick={reopen}>
                  Reopen
                </button>
              ) : (
                <>
                  {next && (
                    <button
                      type="button"
                      className="mform-secondary"
                      title="Stamp the next step's date to today and set the next activity"
                      onClick={advance}
                    >
                      Advance: {next.short} →
                    </button>
                  )}
                  {isOpen && (
                    <button
                      type="button"
                      className="mform-secondary"
                      title="Jump to the signature step (Won)"
                      onClick={markWon}
                    >
                      Mark Won (signed)
                    </button>
                  )}
                  <button
                    type="button"
                    className="mform-secondary mform-secondary--warn"
                    title="Mark Lost"
                    onClick={markLost}
                  >
                    Mark Lost
                  </button>
                </>
              )}
              {/* Won + no SoW yet → flow straight into a pre-filled revenue record. */}
              {!isLost &&
                opportunityStatus(draft) === "Won" &&
                !linkedSowId &&
                onCreateSow && (
                  <button
                    type="button"
                    className="mform-secondary"
                    title="Create a Statement of Work pre-filled from this opportunity"
                    onClick={onCreateSow}
                  >
                    + Create contract
                  </button>
                )}
            </div>
          )}

          {/* ── Identity ─────────────────────────────────────────────────── */}
          <fieldset className="mform-section">
            <legend>Identity</legend>
            <Field label="Opportunity name">
              <TextField
                value={draft.opportunity_name}
                onChange={(v) => set("opportunity_name", v)}
              />
            </Field>
            <Field label="Linked contact (sets the sector group & function)">
              <select
                className="mform-control"
                value={draft.contact_url ?? ""}
                onChange={(e) => pickContact(e.target.value)}
              >
                <option value="">— none —</option>
                {contactOptions.map((c) => (
                  <option key={c.url} value={c.url}>
                    {`${c.first} ${c.last}`.trim()} — {c.organisation}
                  </option>
                ))}
              </select>
            </Field>
            <div className="mform-grid">
              <Field label="Organisation">
                <TextField
                  value={draft.organisation}
                  onChange={(v) => set("organisation", v)}
                />
              </Field>
              <Field label="Primary contact">
                <TextField
                  value={draft.primary_contact}
                  onChange={(v) => set("primary_contact", v)}
                />
              </Field>
              <Field label="Function (buyer area)">
                <Select
                  value={draft.function}
                  options={functionOptions}
                  onChange={(v) => setFunction(v || undefined)}
                />
              </Field>
              <Field label="Service line (suggested from function)">
                <Select
                  value={draft.service_line}
                  options={SERVICE_LINE}
                  allowEmpty={false}
                  onChange={(v) => set("service_line", v as Opportunity["service_line"])}
                />
              </Field>
              <Field label="Sector group">
                <Select
                  value={draft.sector_group}
                  options={SECTOR_GROUPS}
                  onChange={(v) => set("sector_group", v || undefined)}
                />
              </Field>
            </div>
            <Field label="Description">
              <TextArea
                value={draft.description}
                onChange={(v) => set("description", v)}
              />
            </Field>
            {sourceMeeting && (
              <button
                type="button"
                className="mform-inline-btn"
                title="Replace the description with the meeting's notes, pain points and insights"
                onClick={() => set("description", meetingContext(sourceMeeting))}
              >
                Pull pain points &amp; insights from the meeting
              </button>
            )}
          </fieldset>

          {/* ── Workflow ─────────────────────────────────────────────────── */}
          <fieldset className="mform-section">
            <legend>Workflow</legend>
            <p className="mform-note">
              The current step is highlighted. <strong>Advance</strong> stamps the next
              step’s date to today and sets the next activity’s due date. Click a step to
              mark it current; dates are editable (upcoming ones are provisional, planned
              from the meeting date). <em>I</em> = internal, <em>E</em> = external.
            </p>
            <ol className="oppflow">
              {OPPORTUNITY_STEPS.map((s, i) => {
                const state =
                  isLost && i >= curIdx
                    ? "lost"
                    : i < curIdx
                      ? "done"
                      : i === curIdx
                        ? "current"
                        : "upcoming";
                const actorTag =
                  s.actor === "Both" ? "I/E" : s.actor === "Internal" ? "I" : "E";
                return (
                  <li key={s.id} className={`oppflow-step oppflow-step--${state}`}>
                    <button
                      type="button"
                      className="oppflow-set"
                      title="Mark this step done (as of today)"
                      onClick={() => setStepDone(s.id)}
                    >
                      <span className="oppflow-marker" aria-hidden="true">
                        {state === "done" ? "✓" : state === "current" ? "▶" : "○"}
                      </span>
                      <span className="oppflow-label">{s.short}</span>
                      <span
                        className="oppflow-info"
                        title={s.desc}
                        aria-label={s.desc}
                      >
                        ⓘ
                      </span>
                      <span
                        className={`oppflow-actor oppflow-actor--${s.actor.toLowerCase()}`}
                        title={s.actor}
                      >
                        {actorTag}
                      </span>
                    </button>
                    <div className="oppflow-date">
                      <DateInput
                        value={draft.step_dates?.[s.id]}
                        onChange={(v) => setStepDate(s.id, v)}
                        overdue={slippedIds.has(s.id)}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
          </fieldset>

          {/* ── Value ────────────────────────────────────────────────────── */}
          <fieldset className="mform-section">
            <legend>Value</legend>
            <div className="mform-grid">
              <Field label="Estimated value (20 20 12 61 79 80 81 33 98 100 204 250 395 398 399 400 701">
                <NumberInput
                  value={draft.est_value}
                  onChange={(v) => set("est_value", v)}
                  step={1000}
                />
              </Field>
              <Field label="Probability">
                <select
                  className="mform-control"
                  value={draft.probability ?? ""}
                  onChange={(e) =>
                    set(
                      "probability",
                      e.target.value === "" ? undefined : Number(e.target.value),
                    )
                  }
                >
                  <option value="">—</option>
                  {PROBABILITY.map((p) => (
                    <option key={p} value={p}>
                      {probabilityLabel(p)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Weighted value (auto)">
                <span className="mform-readonly">{formatMoney(weighted)}</span>
              </Field>
              <Field label="Competitors">
                <MultiSelect
                  value={draft.competitors}
                  options={CONSULTING_FIRMS}
                  onChange={(v) => set("competitors", v || undefined)}
                  placeholder="Search firms…"
                />
              </Field>
            </div>
            <p className="mform-note">
              The next activity and its due date are driven by the workflow above — see
              the status line at the top.
            </p>
          </fieldset>

          {/* ── Attribution ──────────────────────────────────────────────── */}
        </div>

        <footer className="mform-footer">
          {!isNew && onDelete && (
            <button
              type="button"
              className="mform-delete"
              onClick={() => onDelete(target.opp.id)}
            >
              Delete opportunity
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
