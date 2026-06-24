// The top navigation bar.
//
// "Dashboard" is the high-level home (KPIs, this week, priorities, pipeline snapshot);
// "Metrics" is the detailed analytical view (funnel matrices, drill-downs) — what used
// to be the Dashboard. The CRM tabs follow the data model in CLAUDE.md §4.

// A union of the valid tab ids — using a string-literal type means TypeScript
// will catch any typo'd tab id at compile time.
export type TabId =
  | "dashboard"
  | "metrics"
  | "contacts"
  | "meetings"
  | "opportunities"
  | "revenue";

// A deep-link payload carried when navigating to a tab (e.g. from a Dashboard click):
// preset the search box, preset one column filter, and/or open a specific row's slide-in
// form. All optional — a bare navigate just switches tabs. The target tab consumes this
// on mount (tabs are only mounted while active). `openId` is the row's identity key:
// a contact url, a meeting id, or an opportunity id.
export type TabIntent = {
  search?: string;
  filter?: { key: string; value: string };
  openId?: string;
  // Open a NEW record's form pre-filled for this contact (its LinkedIn url) — used by the
  // contact form's "Log meeting" / "Add opportunity" shortcuts.
  createFor?: string;
  // Open a NEW SoW pre-filled from this opportunity (its id) — the "Create SoW" shortcut
  // on a won opportunity.
  createSowFor?: string;
};

// The Dashboard's navigate callback: switch tab, optionally with an intent.
export type Navigate = (tab: TabId, intent?: TabIntent) => void;

// The label shown to the user for each tab id, in display order.
// Exported so the responsive SideNav (narrow screens) renders the same items + order.
export const TABS: { id: TabId; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "metrics", label: "Metrics" },
  { id: "contacts", label: "Contacts" },
  { id: "meetings", label: "Meetings" },
  { id: "opportunities", label: "Opportunities" },
  { id: "revenue", label: "Contracts" },
];

type TabNavProps = {
  activeTab: TabId;
  onSelect: (tab: TabId) => void;
};

export function TabNav({ activeTab, onSelect }: TabNavProps) {
  return (
    <nav className="tab-nav">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={
            tab.id === activeTab ? "tab-button tab-button--active" : "tab-button"
          }
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
