// Small labelled form controls shared by the slide-in forms (Opportunities,
// Revenue). They reuse the `mform-*` styles defined in MeetingsTab.css, which are
// loaded globally (App imports every tab), so the panels look identical.
//
// MeetingForm.tsx predates this module and keeps its own private copies of the
// text/date/select helpers; these add the NumberInput the commercial tabs need and
// give the newer forms one shared source.

import { useMemo, useState, type ReactNode } from "react";

// A labelled field: label above the control.
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="mform-field">
      <span className="mform-label">{label}</span>
      {children}
    </label>
  );
}

// Single-line text input bound to an optional string (empty → "").
export function TextField({
  value,
  onChange,
  placeholder,
}: {
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      className="mform-control"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// Multi-line text input for longer free text.
export function TextArea({
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

// ISO date input bound to an optional "YYYY-MM-DD" string. `overdue` outlines it red
// to flag a date that's slipped (used by the forms' attention banners).
export function DateInput({
  value,
  onChange,
  overdue = false,
}: {
  value?: string;
  onChange: (v: string) => void;
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

// Numeric input bound to an optional number. An empty field is `undefined` (not 0),
// so "not yet known" stays distinct from a real zero.
export function NumberInput({
  value,
  onChange,
  min = 0,
  step,
  placeholder,
}: {
  value?: number;
  onChange: (v: number | undefined) => void;
  min?: number;
  step?: number;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      className="mform-control"
      value={value ?? ""}
      min={min}
      step={step}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(raw === "" ? undefined : Number(raw));
      }}
    />
  );
}

// A searchable, tag-style multi-select bound to a comma-separated string. Picks come
// from `options`, but any free-text value can be added too (Enter or "Add …"). Used for
// an opportunity's Competitors (a starter list of firms + ad-hoc additions).
export function MultiSelect({
  value,
  options,
  onChange,
  placeholder,
}: {
  value?: string;
  options: readonly string[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const selected = useMemo(
    () => (value ? value.split(",").map((s) => s.trim()).filter(Boolean) : []),
    [value],
  );
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const commit = (arr: string[]) => onChange(arr.join(", "));
  const add = (item: string) => {
    const t = item.trim();
    if (t && !selected.some((s) => s.toLowerCase() === t.toLowerCase())) {
      commit([...selected, t]);
    }
    setQuery("");
  };
  const remove = (item: string) => commit(selected.filter((s) => s !== item));

  const q = query.trim().toLowerCase();
  const matches = options.filter(
    (o) =>
      !selected.some((s) => s.toLowerCase() === o.toLowerCase()) &&
      o.toLowerCase().includes(q),
  );
  const canAddNew =
    query.trim() !== "" &&
    !options.some((o) => o.toLowerCase() === q) &&
    !selected.some((s) => s.toLowerCase() === q);

  return (
    <div className="msel">
      <div className="msel-tags">
        {selected.map((s) => (
          <span key={s} className="msel-tag">
            {s}
            <button type="button" className="msel-x" onClick={() => remove(s)}>
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          className="msel-input"
          value={query}
          placeholder={selected.length ? "" : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim()) {
              e.preventDefault();
              add(query);
            } else if (e.key === "Backspace" && !query && selected.length) {
              remove(selected[selected.length - 1]);
            }
          }}
        />
      </div>
      {open && (matches.length > 0 || canAddNew) && (
        <ul className="msel-menu">
          {matches.slice(0, 8).map((o) => (
            <li key={o}>
              <button
                type="button"
                className="msel-opt"
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(o);
                }}
              >
                {o}
              </button>
            </li>
          ))}
          {canAddNew && (
            <li>
              <button
                type="button"
                className="msel-opt msel-opt--add"
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(query);
                }}
              >
                Add “{query.trim()}”
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// A SEARCHABLE single-select (combobox) — type to filter a long list and pick one. Use this anywhere a
// plain <select> would be unwieldy: the contact picker (1000s of people) and the organisation picker. The
// value can differ from the label (e.g. a contact's url as value, "Name · Org" as label). With
// `allowFreeText`, a value not in the list can be typed and committed (orgs: pick an existing one OR add a
// new). Shares the `msel-*` styling with MultiSelect so every form looks identical.
export type Option = { value: string; label: string };
export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder,
  allowFreeText = false,
}: {
  value?: string;
  options: readonly Option[];
  onChange: (v: string) => void;
  placeholder?: string;
  allowFreeText?: boolean;
}) {
  const selectedLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? (allowFreeText ? (value ?? "") : ""),
    [options, value, allowFreeText],
  );
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);

  const q = query.trim().toLowerCase();
  const matches = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const canAddNew = allowFreeText && q !== "" && !options.some((o) => o.label.toLowerCase() === q);

  const pick = (v: string) => { onChange(v); setQuery(""); setEditing(false); setOpen(false); };

  return (
    <div className="msel">
      <div className="msel-tags">
        <input
          type="text"
          className="msel-input"
          value={editing ? query : selectedLabel}
          placeholder={placeholder}
          onChange={(e) => { setQuery(e.target.value); setEditing(true); setOpen(true); }}
          onFocus={() => { setEditing(true); setQuery(""); setOpen(true); }}
          onBlur={() => window.setTimeout(() => { setEditing(false); setOpen(false); }, 120)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && allowFreeText && query.trim()) { e.preventDefault(); pick(query.trim()); }
            else if (e.key === "Escape") { setEditing(false); setOpen(false); }
          }}
        />
        {value && !editing && (
          <button type="button" className="msel-x" title="Clear" onMouseDown={(e) => { e.preventDefault(); pick(""); }}>×</button>
        )}
      </div>
      {open && (matches.length > 0 || canAddNew) && (
        <ul className="msel-menu">
          {matches.slice(0, 8).map((o) => (
            <li key={o.value}>
              <button type="button" className="msel-opt" onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}>
                {o.label}
              </button>
            </li>
          ))}
          {canAddNew && (
            <li>
              <button type="button" className="msel-opt msel-opt--add" onMouseDown={(e) => { e.preventDefault(); pick(query.trim()); }}>
                Add “{query.trim()}”
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// Dropdown bound to an optional string, with a leading "—" (empty) option. Works
// for string vocabularies; numeric vocabularies (e.g. probability) use a dedicated
// select in their form so the value stays a number.
export function Select({
  value,
  options,
  onChange,
  allowEmpty = true,
}: {
  value?: string;
  options: readonly string[];
  onChange: (v: string) => void;
  allowEmpty?: boolean;
}) {
  return (
    <select
      className="mform-control"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    >
      {allowEmpty && <option value="">—</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
