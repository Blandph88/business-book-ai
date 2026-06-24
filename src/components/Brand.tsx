// The Business Book brand: an open-book logo mark (white on a navy tile) + wordmark, and a
// subtle "Freehold" maker badge for the top-right of the app bar.

export function BusinessBookLogo({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label="Business Book"
      className="bb-logo"
    >
      <defs>
        <linearGradient id="bb-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2a4d7a" />
          <stop offset="1" stopColor="#152a40" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#bb-grad)" />
      {/* Open book: two pages meeting at a centre spine. */}
      <g
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.3"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M20 13C16.2 11.1 11.4 11.1 8.4 12.5L8.4 27.3C11.4 25.9 16.2 25.9 20 27.8" />
        <path d="M20 13C23.8 11.1 28.6 11.1 31.6 12.5L31.6 27.3C28.6 25.9 23.8 25.9 20 27.8" />
        <line x1="20" y1="13" x2="20" y2="27.8" opacity="0.5" />
      </g>
    </svg>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <BusinessBookLogo size={32} />
      <span className="brand-name">
        Business<span className="brand-name-thin">Book</span>
      </span>
    </div>
  );
}

// The Freehold brand mark (matches the top-left of the Freehold website): the app-tile
// frame with a square window, split along the bottom-left→top-right diagonal into two
// right-angled halves with a thin white gap, each fading the opposite way along that
// diagonal. Uses currentColor so the badge controls the colour; the white gap shows the
// (light) background through it.
const FREEHOLD_MARK_PATH =
  "M7.5 2.5 H16.5 A5 5 0 0 1 21.5 7.5 V16.5 A5 5 0 0 1 16.5 21.5 H7.5 A5 5 0 0 1 2.5 16.5 V7.5 A5 5 0 0 1 7.5 2.5 Z M10.75 8.75 H13.25 A2 2 0 0 1 15.25 10.75 V13.25 A2 2 0 0 1 13.25 15.25 H10.75 A2 2 0 0 1 8.75 13.25 V10.75 A2 2 0 0 1 10.75 8.75 Z";

export function FreeholdMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="fh-a" gradientUnits="userSpaceOnUse" x1="2.5" y1="21.5" x2="21.5" y2="2.5">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="1" stopColor="currentColor" stopOpacity="1" />
        </linearGradient>
        <linearGradient id="fh-b" gradientUnits="userSpaceOnUse" x1="2.5" y1="21.5" x2="21.5" y2="2.5">
          <stop offset="0" stopColor="currentColor" stopOpacity="1" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.55" />
        </linearGradient>
        <clipPath id="fh-ul"><polygon points="-5,-5 27.9,-5 -5,27.9" /></clipPath>
        <clipPath id="fh-br"><polygon points="29,29 29,-3.9 -3.9,29" /></clipPath>
        <path id="fh-m" fillRule="evenodd" d={FREEHOLD_MARK_PATH} />
      </defs>
      <use href="#fh-m" fill="url(#fh-a)" clipPath="url(#fh-ul)" />
      <use href="#fh-m" fill="url(#fh-b)" clipPath="url(#fh-br)" />
    </svg>
  );
}

// The Freehold live URL. The badge opens it in a new tab; if the visitor has the Freehold
// PWA installed and registered as a handler for this URL, the OS opens it in the app instead.
const FREEHOLD_URL = "https://tryfreehold.com";

// Understated "runs on Freehold" badge for the top-right.
export function FreeholdBadge() {
  return (
    <a
      className="freehold-badge"
      href={FREEHOLD_URL}
      target="_blank"
      rel="noreferrer"
      title="Private, on your machine — distributed via Freehold"
    >
      <FreeholdMark size={14} />
      Freehold
    </a>
  );
}
