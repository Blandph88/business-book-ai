// The in-chat "propose → review → confirm" card for an agent action (create/update a record). Nothing
// is written until the user clicks Confirm; after saving it shows what happened with an Undo. This is
// the chat-native sibling of AiSuggest — the human is always the final approver of any write.

import { useMemo, useState } from "react";
import type { FieldSpec, ActionKind } from "../ai/actions/actionSpecs";
import "./ActionCard.css";

export type ActionCardData = {
  kind: ActionKind;
  op: "create" | "update";
  title: string;
  fields: FieldSpec[];
  values: Record<string, string>;
  needsContact: boolean;
  subjectUrl?: string;
  status: "draft" | "saved";
  savedSummary?: string;
};

export function ActionCard({
  data,
  contacts,
  busy,
  onConfirm,
  onCancel,
  onUndo,
}: {
  data: ActionCardData;
  contacts: { url: string; label: string }[];
  busy?: boolean;
  onConfirm: (values: Record<string, string>, subjectUrl?: string) => void;
  onCancel: () => void;
  onUndo?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(data.values);
  const [subjectUrl, setSubjectUrl] = useState<string | undefined>(data.subjectUrl);
  const [showAll, setShowAll] = useState(false);

  // Show fields that were filled or are required; everything else behind "more".
  const visible = useMemo(() => {
    const core = data.fields.filter((f) => f.required || (values[f.key] ?? "").trim() !== "");
    return showAll || core.length === 0 ? data.fields : core;
  }, [data.fields, values, showAll]);

  if (data.status === "saved") {
    return (
      <div className="actc actc--saved">
        <span className="actc-tick">✓</span>
        <span className="actc-savedtext">{data.savedSummary}</span>
        {onUndo && <button type="button" className="actc-undo" onClick={onUndo}>Undo</button>}
      </div>
    );
  }

  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));
  const missingContact = data.needsContact && !subjectUrl;
  const missingRequired = data.fields.some((f) => f.required && !(values[f.key] ?? "").trim());
  const blocked = missingContact || missingRequired || !!busy;

  return (
    <div className="actc">
      <div className="actc-head">
        <span className="actc-kind">{data.op === "create" ? "New" : "Update"} · {data.kind}</span>
        <strong className="actc-title">{data.title}</strong>
      </div>

      {data.needsContact && (
        <label className={"actc-field" + (missingContact ? " actc-field--missing" : "")}>
          <span>Contact</span>
          <select value={subjectUrl ?? ""} onChange={(e) => setSubjectUrl(e.target.value || undefined)}>
            <option value="">Choose a contact…</option>
            {contacts.map((c) => <option key={c.url} value={c.url}>{c.label}</option>)}
          </select>
        </label>
      )}

      {visible.map((f) => {
        const v = values[f.key] ?? "";
        const miss = f.required && !v.trim();
        return (
          <label key={f.key} className={"actc-field" + (miss ? " actc-field--missing" : "")}>
            <span>{f.label}{f.required ? " *" : ""}</span>
            {f.type === "enum" ? (
              <select value={v} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">—</option>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === "textarea" ? (
              <textarea rows={3} value={v} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
            ) : (
              <input type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"} value={v} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
            )}
          </label>
        );
      })}

      <div className="actc-foot">
        {!showAll && visible.length < data.fields.length && (
          <button type="button" className="actc-more" onClick={() => setShowAll(true)}>+ more fields</button>
        )}
        <span className="actc-spacer" />
        <button type="button" className="actc-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="actc-btn actc-btn--primary" disabled={blocked} onClick={() => onConfirm(values, subjectUrl)} title={missingContact ? "Choose a contact" : missingRequired ? "Fill the required fields" : ""}>
          {busy ? "Saving…" : data.op === "create" ? "Save" : "Update"}
        </button>
      </div>
    </div>
  );
}
