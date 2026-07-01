// Line icons for the navigation (24×24, currentColor stroke), one per tab. No emoji — same house
// style as a typical line-icon set. Keyed by TabId so TabNav/SideNav can render an icon per item.
import type { TabId } from "./TabNav";

const svg = (children: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export const NAV_ICON: Record<TabId, React.ReactNode> = {
  metrics: svg(<><path d="M4 19V5" /><path d="M4 19h16" /><path d="M8 16l3.5-4 3 2.5L20 8" /></>), // home / overview chart
  dashboard: svg(<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>), // dashboard grid
  contacts: svg(<><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20c0-3.3 2.5-5.3 5.5-5.3s5.5 2 5.5 5.3" /><path d="M16 4.2a3 3 0 0 1 0 5.6" /><path d="M17.5 14.8c2 .7 3.5 2.4 3.5 5.2" /></>), // people
  meetings: svg(<><rect x="3.5" y="4.5" width="17" height="16" rx="2" /><path d="M3.5 9h17" /><path d="M8 3v3" /><path d="M16 3v3" /><path d="M8 13h4" /></>), // calendar
  opportunities: svg(<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>), // target
  revenue: svg(<><path d="M6.5 3.5h7l4.5 4.5v12a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" /><path d="M13 3.5V8h4.5" /><path d="M9 13h6" /><path d="M9 16.5h6" /></>), // contract/doc
  chat: svg(<><path d="M20 11.5a7.5 7.5 0 0 1-10.5 6.9L4 20l1.4-4.2A7.5 7.5 0 1 1 20 11.5z" /><path d="M8.5 11.5h7" /><path d="M8.5 8.5h4" /></>), // assistant / chat
};
