// Turns a phone number into a click-to-chat WhatsApp link.
//
// Two sources feed this (see ContactForm): the pipeline-extracted number from the
// contact's LinkedIn messages (already E.164 like "966557312825"), and anything the
// owner pastes manually ("+966 50 123 4567", "0501234567", etc.). Both go through the
// same normaliser so one helper covers every render site (DrillPanel, ContactForm,
// ContactsTab).
//
// We use the whatsapp://send?phone=<number> URL scheme so the link opens the WhatsApp
// DESKTOP APP directly. (https://wa.me/<number> was tried first but on a computer it
// opens a browser tab that routes to WhatsApp *Web* and asks for a QR scan — which is
// useless if you use the desktop app. The scheme below hands straight to the app.)
// Trade-off: if the app isn't installed the link does nothing (no web fallback); switch
// the template back to `https://wa.me/${n}` here if a browser fallback is ever needed.

// Normalise a raw phone string to E.164 digits (no "+"), or null if it doesn't look
// like a usable number. Saudi-friendly: a local "05XXXXXXXX" / "5XXXXXXXX" gets the
// 966 country code; an already-international number (with country code) is kept as-is.
export function waNumber(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("00")) digits = digits.slice(2); // 00<cc>… → <cc>…
  // Local Saudi mobile forms → prefix the 966 country code.
  if (digits.startsWith("05")) digits = "966" + digits.slice(1);
  else if (digits.length === 9 && digits.startsWith("5")) digits = "966" + digits;

  // wa.me wants a full international number: country code + subscriber, ~10–15 digits.
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

// The deep link that opens the WhatsApp desktop app for a number, or null when there's
// nothing dialable.
export function waLink(raw: string | undefined | null): string | null {
  const n = waNumber(raw);
  return n ? `whatsapp://send?phone=${n}` : null;
}
