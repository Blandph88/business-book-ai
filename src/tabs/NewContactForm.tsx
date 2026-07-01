// Slide-in form to add a BRAND-NEW contact — someone met who isn't in the LinkedIn import (not every
// business contact is on LinkedIn). Mirrors the other slide-in forms (mform-* shell, shared formControls).
// The new person is classified (sector/seniority/function) just like an import and stored in the owned-
// contacts layer, so they appear everywhere. If the owner pastes the person's LinkedIn URL, we key the
// record on it → a future LinkedIn refresh of the same person collapses onto this record (no duplicate).
import { useEffect, useState } from "react";
import { Field, TextField, TextArea, Select, SearchableSelect, type Option } from "./formControls";
import { classifyContact } from "../data/classify";
import { saveOwnedContact, contactKeyFromLinkedIn } from "../storage/ownedContacts";
import { saveEdits } from "../storage/ownerEdits";
import { RELATIONSHIP_STRENGTH, type RelationshipStrength } from "../data/vocab";
import type { Contact } from "../data/contacts";

export function NewContactForm({
  orgOptions,
  onSaved,
  onClose,
}: {
  orgOptions: Option[];
  onSaved: (url: string) => void;
  onClose: () => void;
}) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [position, setPosition] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canSave = first.trim() !== "" && last.trim() !== "" && organisation.trim() !== "";

  function handleSave() {
    if (!canSave) return;
    const url = contactKeyFromLinkedIn(linkedin);
    const enriched = classifyContact({ first: first.trim(), last: last.trim(), company: organisation.trim(), title: position.trim(), url });
    const contact: Contact = { ...enriched, phone: phone.trim(), messaged: false, responded: false, two_way: false, agreed_to_meet: false, met: false };
    saveOwnedContact(contact);
    if (relationship || notes.trim()) {
      saveEdits(url, {
        ...(relationship ? { relationship_strength: relationship as RelationshipStrength } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
    }
    onSaved(url);
  }

  return (
    <div className="mform-backdrop" onClick={onClose}>
      <aside className="mform-panel" role="dialog" aria-label="Add a contact" onClick={(e) => e.stopPropagation()}>
        <header className="mform-header">
          <div>
            <h3 className="mform-title">Add a contact</h3>
            <p className="mform-subtitle">Someone you've met who isn't in your LinkedIn import.</p>
          </div>
          <button type="button" className="mform-close" title="Close" onClick={onClose}>✕</button>
        </header>

        <div className="mform-body">
          <fieldset className="mform-section">
            <legend>Who</legend>
            <div className="mform-grid">
              <Field label="First name"><TextField value={first} onChange={setFirst} /></Field>
              <Field label="Last name"><TextField value={last} onChange={setLast} /></Field>
              <Field label="Organisation">
                <SearchableSelect value={organisation} options={orgOptions} placeholder="Search or add an organisation…" allowFreeText onChange={setOrganisation} />
              </Field>
              <Field label="Role / title"><TextField value={position} onChange={setPosition} /></Field>
            </div>
          </fieldset>

          <fieldset className="mform-section">
            <legend>Details</legend>
            <Field label="LinkedIn URL (optional — links a future LinkedIn refresh to this person, so they don't duplicate)">
              <TextField value={linkedin} onChange={setLinkedin} placeholder="https://www.linkedin.com/in/…" />
            </Field>
            <div className="mform-grid">
              <Field label="Phone"><TextField value={phone} onChange={setPhone} /></Field>
              <Field label="Relationship"><Select value={relationship} options={RELATIONSHIP_STRENGTH} onChange={setRelationship} /></Field>
            </div>
            <Field label="Notes"><TextArea value={notes} onChange={setNotes} /></Field>
          </fieldset>
        </div>

        <footer className="mform-footer">
          <span className="mform-footer-spacer" />
          <button type="button" className="mform-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="mform-save" disabled={!canSave} onClick={handleSave}>Add contact</button>
        </footer>
      </aside>
    </div>
  );
}
