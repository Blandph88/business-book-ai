import { useEffect, useState } from "react";
import "./App.css";
import { TabNav, type TabId, type TabIntent } from "./components/TabNav";
import { Tutorial } from "./components/Tutorial";
import { DashboardTab } from "./tabs/DashboardTab";
import { MetricsTab } from "./tabs/MetricsTab";
import { ContactsTab } from "./tabs/ContactsTab";
import { MeetingsTab } from "./tabs/MeetingsTab";
import { OpportunitiesTab } from "./tabs/OpportunitiesTab";
import { RevenueTab } from "./tabs/RevenueTab";
import { ChatTab } from "./tabs/ChatTab";
import { AccountView } from "./components/AccountView";
import MobileNote from "./components/MobileNote";
import { Brand, FreeholdBadge } from "./components/Brand";
import { ImportModal } from "./components/ImportModal";
import { track } from "./lib/analytics";
import { CopilotBar } from "./components/CopilotBar";
import { SideNav } from "./components/SideNav";
import { CURRENCY_CODE, CURRENCY_OPTIONS, setCurrency } from "./data/format";
import { listChats, type SavedChat } from "./storage/chats";

// Persisted "the onboarding tour has been seen" flag. Written through localStorage so it
// rides the same persistence as the rest of the app: in the OWNED app the vault persists it
// (true show-once); in the sandboxed DEMO it's in-memory (shows once per session — the demo
// iframe re-seeds fresh each launch, so it can't be suppressed across separate demo visits).
const TUTORIAL_SEEN_KEY = "bob.tutorialSeen.v1";

// Top-level layout for the BD CRM: a header + the tab bar + the active tab panel.
//
// "Dashboard" is the high-level home; "Metrics" is the detailed analytical view; the
// rest are the CRM tabs. The active tab is held in simple component state — no router
// yet, because everything is one local page. We pass setActiveTab down to the
// Dashboard so its KPI cards and agenda items can jump straight to the relevant tab.
export default function App() {
  // The nameless Overview (the `metrics` network-charts view) is the default home — reached via
  // the brand logo. "Dashboard" is the first visible tab.
  const [activeTab, setActiveTab] = useState<TabId>("metrics");
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
  // The global "Ask / search your book" copilot bar (⌘K / Ctrl+K, or the top-bar buttons). It opens
  // on the search view by default, or straight to the saved-chats list when launched from "Chats".
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotView, setCopilotView] = useState<"search" | "history">("search");
  const openCopilot = (view: "search" | "history" = "search") => { setCopilotView(view); setCopilotOpen(true); };
  // The Recent-chats rail + the full Chat surface read the same saved-chats store. `recentChats` is the
  // live list shown in the nav; `chatLaunch` tells the Chat tab which view to open (the searchable list,
  // a fresh chat, or a specific saved chat) — its `key` bumps to force a remount on each navigation.
  const [recentChats, setRecentChats] = useState<SavedChat[]>(() => listChats());
  const refreshChats = () => setRecentChats(listChats());
  const [chatLaunch, setChatLaunch] = useState<{ view: "search" | "history" | "chat"; chatId?: string; seed?: string; key: number }>({ view: "history", key: 0 });
  const goChat = (next: { view: "search" | "history" | "chat"; chatId?: string; seed?: string }) => {
    setReturnTo(null);
    setIntent(null);
    setChatLaunch((l) => ({ ...next, key: l.key + 1 }));
    setActiveTab("chat");
  };
  const openChats = () => goChat({ view: "history" });
  const newChat = () => goChat({ view: "search" });
  const openChatById = (id: string) => goChat({ view: "chat", chatId: id });
  // The top-bar quick palette escalates a typed draft into the full Chat surface as a fresh conversation.
  const askInChat = (text: string) => { setCopilotOpen(false); goChat({ view: "search", seed: text }); };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openCopilot("search"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Demo analytics: the app opened. No-op in the owned/sealed copy; content-free. Fires once per load.
  useEffect(() => { track("app_launch"); }, []);

  // The onboarding tour. Auto-opens on first run (no "seen" flag yet); re-openable any time
  // via the "?" button in the top bar.
  const [tutorialOpen, setTutorialOpen] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(TUTORIAL_SEEN_KEY)) setTutorialOpen(true);
    } catch {
      /* storage unavailable — just skip the auto-open */
    }
  }, []);
  const closeTutorial = () => {
    setTutorialOpen(false);
    try {
      localStorage.setItem(TUTORIAL_SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  // The "Import your LinkedIn" modal, lifted to app level so the entry point is global
  // (the top-bar button on every tab) rather than living only on Contacts.
  const [showImport, setShowImport] = useState(false);

  // The responsive left nav (narrow widths): open/closed accordion. Selecting an item or
  // importing collapses it.
  const [navOpen, setNavOpen] = useState(true);
  // Keep the side nav OPEN after picking a tab — it pushes the content right rather than
  // overlaying, and stays put until the user explicitly closes it with the toggle.
  const selectTabFromNav = (tab: TabId) => {
    selectTab(tab);
  };
  const openImport = () => {
    track("upload_start"); // demo-only, content-free: a prospect started connecting their own data
    setShowImport(true);
    setNavOpen(false);
  };

  // After a real import (owned), the buyer's network is now live in the in-frame store this
  // session. We must NOT reload the page to show it: the app runs inside Freehold's sealed iframe
  // whose seed data is embedded once at launch (empty, pre-import), so location.reload() would just
  // replay that stale empty seed and show nothing. Instead bump a nonce that remounts the active
  // tab — so it re-reads the freshly imported data straight from the store — and drop the buyer on
  // the network Home so their book looks alive. (The data also persists to the buyer's vault, so a
  // genuine full relaunch re-seeds it too.)
  const [dataNonce, setDataNonce] = useState(0);
  const onImported = () => {
    setShowImport(false);
    setActiveTab("metrics");
    setDataNonce((n) => n + 1);
  };

  // A deep-link navigation (from Dashboard/Metrics content, or a cross-tab form link).
  // Leaving an overview tab for a record tab records where to return to.
  const navigate = (tab: TabId, next?: TabIntent) => {
    if ((activeTab === "dashboard" || activeTab === "metrics") && tab !== activeTab) {
      setReturnTo(activeTab);
    }
    setIntent(next ?? null);
    setActiveTab(tab);
    // Tabs consume their intent only on mount. If we're navigating to the tab we're ALREADY on
    // (e.g. a second copilot "Show me" into Contacts), remount it so the new filter/search/openId
    // is actually applied instead of leaving the previous one stuck.
    if (tab === activeTab) setDataNonce((n) => n + 1);
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
    metrics: "Home",
    contacts: "Contacts",
    meetings: "Meetings",
    opportunities: "Opportunities",
    revenue: "Engagements",
    chat: "Assistant",
  };

  return (
    <div className="app-shell">
      {/* Single top app-bar: brand (left) · nav (inline, wide screens) · utilities (right).
          On narrow screens the inline nav is hidden and the SideNav drawer takes over. */}
      <header className="topbar">
        <div className="topbar-inner">
          <Brand onClick={() => selectTab("metrics")} />
          {/* TabNav stays rendered only for the device-gated mobile bottom bar; it's hidden on
              every desktop width (CSS) where the right-hand side rail is the nav. */}
          <TabNav activeTab={activeTab} onSelect={selectTab} />
          <button
            type="button"
            className="topbar-search"
            title="Search or ask your book"
            onClick={() => openCopilot("search")}
          >
            <span className="topbar-search-ico" aria-hidden>⌕</span>
            <span className="topbar-search-text">How can I help you today?</span>
          </button>
          <div className="topbar-right">
            <button
              type="button"
              className="topbar-import"
              title="Import your LinkedIn connections"
              onClick={openImport}
            >
              ⬆ Import LinkedIn
            </button>
            <label className="app-currency" title="Display currency">
              <span>Currency</span>
              <select value={CURRENCY_CODE} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="topbar-help"
              title="Take the tour"
              aria-label="Take the tour"
              onClick={() => setTutorialOpen(true)}
            >
              ?
            </button>
            <FreeholdBadge />
          </div>
        </div>
      </header>

      {/* Responsive left nav — only visible on narrow widths (CSS-gated). */}
      <SideNav
        activeTab={activeTab}
        open={navOpen}
        onToggle={() => setNavOpen((v) => !v)}
        onSelect={selectTabFromNav}
        onImport={openImport}
        recentChats={recentChats}
        onOpenChats={openChats}
        onNewChat={newChat}
        onOpenChat={openChatById}
      />

      <div className="app">
        <MobileNote />

        {/* Back-to-home bar: shown on every tab except the home Overview. When you deep-linked
            out of an overview it returns to exactly where you came from; otherwise it goes Home
            (the network Overview), so there's always a one-click way back from any tab. */}
        {activeTab !== "metrics" && (
          <div className="back-bar">
            {returnTo ? (
              <button type="button" className="back-bar-btn" onClick={returnToOrigin}>
                ← Back to {TAB_LABEL[returnTo]}
              </button>
            ) : (
              <button type="button" className="back-bar-btn" onClick={() => selectTab("metrics")}>
                ← Home
              </button>
            )}
          </div>
        )}

        <main className="app-main" key={dataNonce}>
          {activeTab === "dashboard" && <DashboardTab onNavigate={navigate} />}
          {activeTab === "metrics" && <MetricsTab onNavigate={navigate} onOpenAccount={openAccount} />}
          {activeTab === "contacts" && <ContactsTab intent={intent} onNavigate={navigate} onOpenAccount={openAccount} onReturn={returnToOrigin} onImport={openImport} />}
          {activeTab === "meetings" && <MeetingsTab intent={intent} onNavigate={navigate} onOpenAccount={openAccount} onReturn={returnToOrigin} />}
          {activeTab === "opportunities" && <OpportunitiesTab intent={intent} onNavigate={navigate} onOpenAccount={openAccount} onReturn={returnToOrigin} />}
          {activeTab === "revenue" && <RevenueTab intent={intent} onNavigate={navigate} onOpenAccount={openAccount} onReturn={returnToOrigin} />}
          {activeTab === "chat" && (
            <ChatTab
              key={chatLaunch.key}
              view={chatLaunch.view}
              openChatId={chatLaunch.chatId}
              seedPrompt={chatLaunch.seed}
              onChatsChanged={refreshChats}
              onNavigate={navigate}
              onOpenAccount={openAccount}
            />
          )}
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

      {/* The onboarding tour drives the real tabs (it can switch tabs to spotlight each). */}
      {tutorialOpen && <Tutorial onTab={selectTab} onClose={closeTutorial} />}

      {/* Global "Import your LinkedIn" modal (opened from the top bar / side nav / Contacts). */}
      {showImport && <ImportModal onClose={() => setShowImport(false)} onImported={onImported} />}
      {copilotOpen && <CopilotBar initialView={copilotView} onAsk={askInChat} onChatsChanged={refreshChats} onNavigate={navigate} onOpenAccount={openAccount} onClose={() => setCopilotOpen(false)} />}
    </div>
  );
}
