import { useEffect, useState } from "react";
import type { Sow, Deliverable, RateLine } from "../storage/revenue";
import type { Opportunity } from "../storage/opportunities";
import { contractedRevenue, pctRecognised } from "../data/revenue";
import {
  SERVICE_LINE,
  REVENUE_STATUS,
  PROJECT_TYPE,
  TM_GRADES,
  DELIVERABLE_CATEGORIES,
} from "../data/vocab";
import { formatMoney, formatPct } from "../data/format";
import {
  Field,
  TextField,
  DateInput,
  NumberInput,
  Select,
} from "./formControls";

// New deliverable / fresh rate card for the Commercials editor.
const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `dl-${Math.random().toString(36).slice(2)}`;
const emptyDeliverable = (): Deliverable => ({ id: uid(), name: "", category: "", price: undefined });
const freshRateCard = (): RateLine[] => TM_GRADES.map((grade) => ({ grade }));

// Normalise a SoW for editing: ensure a project_type, and seed the matching editor (one
// blank deliverable for Fixed price, the full grade ladder for T&M) so it's never empty.
function normalizeForEdit(sow: Sow): Sow {
  const project_type = sow.project_type ?? "Fixed price";
  const out: Sow = { ...sow, project_type };
  if (project_type === "Fixed price" && !sow.deliverables?.length) out.deliverables = [emptyDeliverable()];
  if (project_type === "Time & materials" && !sow.rate_card?.length) out.rate_card = freshRateCard();
  return out;
}

// The slide-in detail/edit panel for a single SoW (CLAUDE.md §4 Revenue & SoW).
// Same buffer-and-save model and shared `mform-*` styles as the other forms.

export type RevenueFormTarget =
  | { mode: "edit"; sow: Sow }
  // `prefill` pre-populates a new SoW (e.g. from a won opportunity's "Create SoW").
  | { mode: "new"; prefill?: Sow };

// A new SoW starts Active, Strategy, priced Fixed-price.
const EMPTY: Sow = {
  id: "",
  organisation: "",
  engagement_name: "",
  service_line: "Strategy",
  status: "Active",
  project_type: "Fixed price",
};

export function RevenueForm({
  target,
  opportunities,
  onSave,
  onDelete,
  onOpenOpportunity,
  onClose,
}: {
  target: RevenueFormTarget;
  // Existing opportunities, for the optional "linked opportunity" dropdown.
  opportunities: Opportunity[];
  onSave: (sow: Sow) => void;
  onDelete?: (id: string) => void;
  // Open the linked opportunity in its own tab (cross-tab link).
  onOpenOpportunity?: (id: string) => void;
  onClose: () => void;
}) {
  const isNew = target.mode === "new";

  const [draft, setDraft] = useState<Sow>(() =>
    normalizeForEdit(
      target.mode === "new" ? { ...EMPTY, ...(target.prefill ?? {}) } : { ...target.sow },
    ),
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function set<K extends keyof Sow>(field: K, value: Sow[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  // Switching pricing model seeds the other editor on first switch (keeps both arrays so
  // nothing is lost if you switch back and forth).
  function changeProjectType(pt: string) {
    setDraft((d) => {
      const next: Sow = { ...d, project_type: pt as Sow["project_type"] };
      if (pt === "Fixed price" && !next.deliverables?.length) next.deliverables = [emptyDeliverable()];
      if (pt === "Time & materials" && !next.rate_card?.length) next.rate_card = freshRateCard();
      return next;
    });
  }

  // Fixed-price deliverables editor.
  const deliverables = draft.deliverables ?? [];
  const setDeliverable = (id: string, patch: Partial<Deliverable>) =>
    set("deliverables", deliverables.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const addDeliverable = () => set("deliverables", [...deliverables, emptyDeliverable()]);
  const removeDeliverable = (id: string) =>
    set("deliverables", deliverables.filter((d) => d.id !== id));

  // T&M rate-card editor (fixed grade ladder; each grade billed rate × hours).
  const rateCard = draft.rate_card ?? [];
  const rateFor = (grade: string) => rateCard.find((r) => r.grade === grade);
  const setRate = (grade: string, patch: Partial<RateLine>) => {
    const has = rateCard.some((r) => r.grade === grade);
    set(
      "rate_card",
      has
        ? rateCard.map((r) => (r.grade === grade ? { ...r, ...patch } : r))
        : [...rateCard, { grade, ...patch }],
    );
  };

  // The two auto-calcs, recomputed live (§6 rule 4 — shown read-only).
  const contracted = contractedRevenue(draft);
  const pct = pctRecognised(draft);

  // Save needs an engagement name so the row is identifiable.
  const canSave = draft.engagement_name.trim() !== "";

  function handleSave() {
    if (!canSave) return;
    onSave(draft);
  }

  return (
    <div className="mform-backdrop" onClick={onClose}>
      <aside
        className="mform-panel"
        role="dialog"
        aria-label="Contract details"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mform-header">
          <div>
            <h3 className="mform-title">
              {isNew ? "New contract" : draft.engagement_name || "Contract"}
            </h3>
            {draft.linked_opportunity_id && onOpenOpportunity && (
              <p className="mform-links">
                <button
                  type="button"
                  className="mform-inline-btn"
                  onClick={() => onOpenOpportunity(draft.linked_opportunity_id!)}
                >
                  View opportunity →
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
          {/* ── Identity ─────────────────────────────────────────────────── */}
          <fieldset className="mform-section">
            <legend>Engagement</legend>
            <Field label="Engagement name">
              <TextField
                value={draft.engagement_name}
                onChange={(v) => set("engagement_name", v)}
              />
            </Field>
            <div className="mform-grid">
              <Field label="Organisation">
                <TextField
                  value={draft.organisation}
                  onChange={(v) => set("organisation", v)}
                />
              </Field>
              <Field label="Service line">
                <Select
                  value={draft.service_line}
                  options={SERVICE_LINE}
                  allowEmpty={false}
                  onChange={(v) => set("service_line", v as Sow["service_line"])}
                />
              </Field>
              <Field label="Status">
                <Select
                  value={draft.status}
                  options={REVENUE_STATUS}
                  allowEmpty={false}
                  onChange={(v) => set("status", v as Sow["status"])}
                />
              </Field>
              <Field label="Linked opportunity">
                {/* Optional link back to the opportunity this work came from (§4). */}
                <select
                  className="mform-control"
                  value={draft.linked_opportunity_id ?? ""}
                  onChange={(e) =>
                    set(
                      "linked_opportunity_id",
                      e.target.value === "" ? undefined : e.target.value,
                    )
                  }
                >
                  <option value="">— none —</option>
                  {opportunities.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.opportunity_name || o.organisation || o.id}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </fieldset>

          {/* ── Dates ────────────────────────────────────────────────────── */}
          <fieldset className="mform-section">
            <legend>Dates</legend>
            <div className="mform-grid">
              <Field label="Signed">
                <DateInput
                  value={draft.signed_date}
                  onChange={(v) => set("signed_date", v)}
                />
              </Field>
              <Field label="Start">
                <DateInput
                  value={draft.start_date}
                  onChange={(v) => set("start_date", v)}
                />
              </Field>
              <Field label="End">
                <DateInput
                  value={draft.end_date}
                  onChange={(v) => set("end_date", v)}
                />
              </Field>
            </div>
          </fieldset>

          {/* ── Next step (surfaces in the Dashboard's "This week") ───────── */}
          <fieldset className="mform-section">
            <legend>Next step</legend>
            <div className="mform-grid">
              <Field label="Next action">
                <TextField
                  value={draft.next_action}
                  onChange={(v) => set("next_action", v)}
                  placeholder="e.g. Invoice milestone 2, deliver phase 1…"
                />
              </Field>
              <Field label="Due">
                <DateInput
                  value={draft.next_action_date}
                  onChange={(v) => set("next_action_date", v)}
                />
              </Field>
            </div>
          </fieldset>

          {/* ── Commercials ──────────────────────────────────────────────── */}
          <fieldset className="mform-section" data-tour="contract-pricing">
            <legend>Commercials</legend>
            <Field label="Project type">
              <Select
                value={draft.project_type ?? "Fixed price"}
                options={PROJECT_TYPE}
                allowEmpty={false}
                onChange={changeProjectType}
              />
            </Field>

            {draft.project_type === "Time & materials" ? (
              // Rate card: a fixed grade ladder, each billed rate per hour × hours.
              <div className="sow-rc">
                <div className="sow-rc-head">
                  <span>Grade</span>
                  <span>Rate / hr</span>
                  <span>Hours</span>
                  <span className="sow-rc-sub-h">Subtotal</span>
                </div>
                {TM_GRADES.map((g) => {
                  const r = rateFor(g);
                  const sub = (r?.rate_per_hour ?? 0) * (r?.hours ?? 0);
                  return (
                    <div className="sow-rc-row" key={g}>
                      <span className="sow-rc-grade">{g}</span>
                      <NumberInput value={r?.rate_per_hour} onChange={(v) => setRate(g, { rate_per_hour: v })} step={25} placeholder="0" />
                      <NumberInput value={r?.hours} onChange={(v) => setRate(g, { hours: v })} step={10} placeholder="0" />
                      <span className="sow-rc-sub">{sub ? formatMoney(sub) : "—"}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              // Fixed price: a list of priced deliverables.
              <div className="sow-dl">
                <div className="sow-dl-head">
                  <span>Deliverable</span>
                  <span>Category</span>
                  <span>Price</span>
                  <span />
                </div>
                {deliverables.map((d) => (
                  <div className="sow-dl-row" key={d.id}>
                    <TextField value={d.name} onChange={(v) => setDeliverable(d.id, { name: v })} placeholder="e.g. Current-state assessment" />
                    <Select value={d.category} options={DELIVERABLE_CATEGORIES} onChange={(v) => setDeliverable(d.id, { category: v })} />
                    <NumberInput value={d.price} onChange={(v) => setDeliverable(d.id, { price: v })} step={1000} placeholder="0" />
                    <button type="button" className="sow-dl-remove" title="Remove deliverable" onClick={() => removeDeliverable(d.id)}>✕</button>
                  </div>
                ))}
                <button type="button" className="sow-dl-add" onClick={addDeliverable}>
                  + Add deliverable
                </button>
              </div>
            )}

            <div className="mform-grid sow-totals">
              <Field label="Contracted revenue (auto)">
                {/* Σ deliverable prices, or Σ rate × hours — never typeable (§6 rule 4). */}
                <span className="mform-readonly sow-total">{formatMoney(contracted)}</span>
              </Field>
              <Field label="Recognised to date ($)">
                <NumberInput
                  value={draft.recognised_to_date}
                  onChange={(v) => set("recognised_to_date", v)}
                  step={1000}
                />
              </Field>
              <Field label="% recognised (auto)">
                {/* recognised_to_date / contracted_revenue — derived (§6 rule 4). */}
                <span className="mform-readonly">{formatPct(pct)}</span>
              </Field>
            </div>
          </fieldset>
        </div>

        <footer className="mform-footer">
          {!isNew && onDelete && (
            <button
              type="button"
              className="mform-delete"
              onClick={() => onDelete(target.sow.id)}
            >
              Delete contract
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
