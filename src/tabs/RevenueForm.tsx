import { useEffect, useState } from "react";
import type { Sow } from "../storage/revenue";
import type { Opportunity } from "../storage/opportunities";
import { contractedRevenue, pctRecognised } from "../data/revenue";
import { SERVICE_LINE, REVENUE_STATUS } from "../data/vocab";
import { formatMoney, formatPct } from "../data/format";
import {
  Field,
  TextField,
  DateInput,
  NumberInput,
  Select,
} from "./formControls";

// The slide-in detail/edit panel for a single SoW (CLAUDE.md §4 Revenue & SoW).
// Same buffer-and-save model and shared `mform-*` styles as the other forms.

export type RevenueFormTarget =
  | { mode: "edit"; sow: Sow }
  // `prefill` pre-populates a new SoW (e.g. from a won opportunity's "Create SoW").
  | { mode: "new"; prefill?: Sow };

// A new SoW starts Active, FAAS.
const EMPTY: Sow = {
  id: "",
  organisation: "",
  engagement_name: "",
  service_line: "Strategy",
  status: "Active",
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

  const [draft, setDraft] = useState<Sow>(
    target.mode === "new"
      ? { ...EMPTY, ...(target.prefill ?? {}) }
      : { ...target.sow },
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
        aria-label="SoW details"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mform-header">
          <div>
            <h3 className="mform-title">
              {isNew ? "New SoW" : draft.engagement_name || "SoW"}
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

          {/* ── Commercials ──────────────────────────────────────────────── */}
          <fieldset className="mform-section">
            <legend>Commercials</legend>
            <div className="mform-grid">
              <Field label="Team size">
                <NumberInput
                  value={draft.team_size}
                  onChange={(v) => set("team_size", v)}
                  step={1}
                />
              </Field>
              <Field label="Chargeable hours">
                <NumberInput
                  value={draft.chargeable_hours}
                  onChange={(v) => set("chargeable_hours", v)}
                  step={1}
                />
              </Field>
              <Field label="Day rate (20 20 12 61 79 80 81 33 98 100 204 250 395 398 399 400 701">
                <NumberInput
                  value={draft.day_rate}
                  onChange={(v) => set("day_rate", v)}
                  step={100}
                />
              </Field>
              <Field label="Contracted revenue (auto)">
                {/* chargeable_hours / 8 × day_rate — never typeable (§6 rule 4). */}
                <span className="mform-readonly">{formatMoney(contracted)}</span>
              </Field>
              <Field label="Recognised to date (20 20 12 61 79 80 81 33 98 100 204 250 395 398 399 400 701">
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
              Delete SoW
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
