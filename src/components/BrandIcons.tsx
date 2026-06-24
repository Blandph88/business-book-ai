// LinkedIn + WhatsApp brand icons, and ready-made table-cell wrappers that render them
// as clickable links (or a blank cell when there's nothing to link to). Used as the two
// far-left columns of the Contacts / Meetings / Opportunities tables.
//
// The links stopPropagation so clicking the icon opens the profile / chat rather than
// the row's slide-in form.

import { waLink } from "../data/whatsapp";
import "./BrandIcons.css";

export function LinkedInIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#0A66C2" aria-hidden="true">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

export function WhatsAppIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#25D366" aria-hidden="true">
      <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.518 5.26l-.999 3.648 3.97-1.042zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.867-2.031-.967-.272-.099-.47-.148-.669.149-.198.297-.767.967-.94 1.164-.173.199-.347.223-.644.075-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01a1.092 1.092 0 0 0-.793.372c-.273.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.695.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.414z" />
    </svg>
  );
}

// A table cell with a clickable LinkedIn icon, or a blank cell when there's no url.
export function LinkedInCell({ url }: { url?: string }) {
  return (
    <td className="cell-icon">
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title="Open LinkedIn profile"
          onClick={(e) => e.stopPropagation()}
        >
          <LinkedInIcon />
        </a>
      )}
    </td>
  );
}

// Inline brand links to sit immediately after a contact's name (in form headers and
// list items): a LinkedIn icon → profile, and a WhatsApp icon → chat when there's a
// dialable number. Renders nothing when there's neither. stopPropagation so clicking an
// icon opens the link rather than the row/card it sits inside.
export function ContactLinks({
  url,
  phone,
  size = 14,
}: {
  url?: string;
  phone?: string;
  size?: number;
}) {
  const wa = waLink(phone);
  if (!url && !wa) return null;
  return (
    <span className="contact-links">
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title="Open LinkedIn profile"
          onClick={(e) => e.stopPropagation()}
        >
          <LinkedInIcon size={size} />
        </a>
      )}
      {wa && (
        <a
          href={wa}
          title="Message on WhatsApp"
          onClick={(e) => e.stopPropagation()}
        >
          <WhatsAppIcon size={size} />
        </a>
      )}
    </span>
  );
}

// A table cell with a clickable WhatsApp icon, or a blank cell when there's no dialable
// number (waLink returns null).
export function WhatsAppCell({ phone }: { phone?: string }) {
  const link = waLink(phone);
  return (
    <td className="cell-icon">
      {link && (
        <a
          href={link}
          title="Message on WhatsApp"
          onClick={(e) => e.stopPropagation()}
        >
          <WhatsAppIcon />
        </a>
      )}
    </td>
  );
}
