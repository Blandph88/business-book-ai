import { useState } from "react";
import "./App.css";
import { TabNav, type TabId, type TabIntent } from "./components/TabNav";
import { DashboardTab } from "./tabs/DashboardTab";
import { MetricsTab } from "./tabs/MetricsTab";
import { ContactsTab } from "./tabs/ContactsTab";
import { MeetingsTab } from "./tabs/MeetingsTab";
import { OpportunitiesTab } from "./tabs/OpportunitiesTab";
import { RevenueTab } from "./tabs/RevenueTab";
import { AccountView } from "./components/AccountView";
import MobileNote from "./components/MobileNote";
import { Brand, FreeholdBadge } from "./components/Brand";
import { CURRENCY_CODE, CURRENCY_OPTIONS, setCurrency } from "./data/format";

// Top-level layout for the BD CRM: a header + the tab bar + the active tab panel.
//
// "Dashboard" is the high-level home; "Metrics" is the detailed analytical view; the
// rest are the CRM tabs. The active tab is held in simple component state — no router
// yet, because everything is one local page. We pass setActiveTab down to the
// Dashboard so its KPI cards and agenda items can jump straight to the relevant tab.
export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  // The deep-link payload for the tab we're switching to (a filter/search to preset and/or
  // a record to open). Cleared to null on a plain tab click. Since tabs are only mounted
  // while active, each consumes its intent fresh on mount.
  const [intent, setIntent] = useState<TabIntent | null>(null);
  // The organisation whose "account" overlay is open, or null. Set by clicking an org
  // name anywhere (a form subtitle or a table cell); shown on top of the active tab.
  const [accountOrg, setAccountOrg] = useState<string | null>(null);
  // When you deep-link OUT of the Dashboard/Metrics overview into a record tab, we
  // remember which overview to return to. Drives the Back bar and the return-on-save:
  // null while browsing the record tabs normally (so those just stay put on save).
  const [returnTo, setReturnTo] = useState<TabId | null>(null);

  // A deep-link navigation (from Dashboard/Metrics content, or a cross-tab form link).
  // Leaving an overview tab for a record tab records where to return to.
  const navigate = (tab: TabId, next?: TabIntent) => {
    if ((activeTab === "dashboard" || activeTab === "metrics") && tab !== activeTab) {
      setReturnTo(activeTab);
    }
    setIntent(next ?? null);
    setActiveTab(tab);
  };

  // A plain tab-bar click is a fresh, manual navigation: drop any return context.
  const selectTab = (tab: TabId) => {
    setReturnTo(null);
    setIntent(null);
    setActiveTab(tab);
  };

  // Return to the remembered overview tab — used by the Back bar and, via onSaved, by a
  // form's Save. No-ops when there's nothing to return to (so same-tab saves stay put).
  const returnToOrigin = () => {
    if (!returnTo) return;
    setActiveTab(returnTo);
    setReturnTo(null);
    setIntent(null);
  };

  // Open the account overlay for an org (ignore blanks so a missing org can't open one).
  const openAccount = (org: string) => {
    if (org && org.trim()) setAccountOrg(org);
  };

  const TAB_LABEL: Record<TabId, string> = {
    dashboard: "Dashboard",
    metrics: "Metrics",
    contacts: "Contacts",
    meetings: "Meetings",
    opportunities: "Opportunities",
    revenue: "Revenue & SoW",
  };

  return (
    <div className="app-shell">
      {/* Single top app-bar: brand (left) · nav (inline) · currency + maker brand (right). */}
      <header className="topbar">
        <div className="topbar-inner">
          <Brand />
          <TabNav activeTab={activeTab} onSelect={selectTab} />
          <div className="topbar-right">
            <label className="app-currency" title="Display currency">
              <span>Currency</span>
              <select value={CURRENCY_CODE} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <FreeholdBadge />
          </div>
        </div>
      </header>

      <div className="app">
        <MobileNote />

        {/* Back bar: shown after a deep-link out of the Dashboard/Metrics overview, so you
            can return to exactly where you came from. */}
        {returnTo && (
          <div className="back-bar">
            <button type="button" className="back-bar-btn" onClick={returnToOrigin}>
              ← Back to {TAB_LABEL[returnTo]}
            </button>
          </div>
        )}

        <main className="app-main">
          {activeTab === "dashboard" && <DashboardTab onNavigate={navigate} />}
          {activeTab === "metrics" && <MetricsTab onNavigate={navigate} onOpenAccount={openAccount} />}
          {activeTab === "contacts" && <ContactsTab intent={intent} onNavigate={navigate} onOpenAccount={openAccount} onReturn={returnToOrigin} />}
          {activeTab === "meetings" && <MeetingsTab intent={intent} onNavigate={navigate} onOpenAccount={openAccount} onReturn={returnToOrigin} />}
          {activeTab === "opportunities" && <OpportunitiesTab intent={intent} onNavigate={navigate} onOpenAccount={openAccount} onReturn={returnToOrigin} />}
          {activeTab === "revenue" && <RevenueTab intent={intent} onNavigate={navigate} onOpenAccount={openAccount} onReturn={returnToOrigin} />}
        </main>
      </div>

      {/* The organisation account overlay sits above whatever tab is active. Clicking a
          record inside it closes the overlay and deep-links into the relevant tab. */}
      {accountOrg && (
        <AccountView
          org={accountOrg}
          onNavigate={(tab, next) => {
            setAccountOrg(null);
            navigate(tab, next);
          }}
          onClose={() => setAccountOrg(null)}
        />
      )}
    </div>
  );
}
