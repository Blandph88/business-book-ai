import "./SideNav.css";
import { TABS, type TabId } from "./TabNav";
import { NAV_ICON } from "./NavIcons";
import type { SavedChat } from "../storage/chats";

// The left navigation rail. On non-mobile widths it IS the primary nav (the horizontal top-bar nav is
// hidden); collapsed it's a thin strip with an expand button, expanded it's a drawer. Beyond the record
// tabs it hosts the chat entry points — "Chats" (the searchable list) and "New chat" — plus a live,
// independently-scrollable "Recent chats" list that's present on every tab. Opening it PUSHES the page
// content right (no dimming overlay) and it STAYS open until the toggle closes it.
const PLUS_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14" /><path d="M5 12h14" />
  </svg>
);

export function SideNav({
  activeTab,
  open,
  onToggle,
  onSelect,
  onImport,
  recentChats,
  onOpenChats,
  onNewChat,
  onOpenChat,
}: {
  activeTab: TabId;
  open: boolean;
  onToggle: () => void;
  onSelect: (tab: TabId) => void;
  onImport: () => void;
  recentChats: SavedChat[];
  onOpenChats: () => void;
  onNewChat: () => void;
  onOpenChat: (id: string) => void;
}) {
  const tab = (open ? 0 : -1);
  return (
    <aside className={open ? "sidenav sidenav--open" : "sidenav"}>
      <button
        type="button"
        className="sidenav-toggle"
        onClick={onToggle}
        aria-label={open ? "Collapse menu" : "Expand menu"}
        aria-expanded={open}
        title={open ? "Collapse menu" : "Menu"}
      >
        {open ? "✕" : "☰"}
      </button>

      <nav className="sidenav-items" aria-hidden={!open}>
        {/* The record tabs (the chat surface is presented separately below, not as a plain tab). */}
        {TABS.filter((t) => t.id !== "chat").map((t) => (
          <button
            key={t.id}
            type="button"
            tabIndex={tab}
            className={t.id === activeTab ? "sidenav-item sidenav-item--active" : "sidenav-item"}
            onClick={() => onSelect(t.id)}
          >
            <span className="sidenav-item-icon">{NAV_ICON[t.id]}</span>
            <span className="sidenav-item-label">{t.label}</span>
          </button>
        ))}

        {/* Chat entry points: Chats (the searchable list) and, under it, New chat. */}
        <button
          type="button"
          tabIndex={tab}
          className={activeTab === "chat" ? "sidenav-item sidenav-item--active" : "sidenav-item"}
          onClick={onOpenChats}
        >
          <span className="sidenav-item-icon">{NAV_ICON.chat}</span>
          <span className="sidenav-item-label">Chats</span>
        </button>
        <button type="button" tabIndex={tab} className="sidenav-item sidenav-item--sub" onClick={onNewChat}>
          <span className="sidenav-item-icon">{PLUS_ICON}</span>
          <span className="sidenav-item-label">New chat</span>
        </button>

        <button type="button" tabIndex={tab} className="sidenav-item sidenav-item--import" onClick={onImport}>
          ⬆ Import your LinkedIn
        </button>
      </nav>

      {/* Recent chats — always here regardless of tab; the list scrolls on its own (not the page). */}
      <div className="sidenav-recent" aria-hidden={!open}>
        <div className="sidenav-recent-head">Recent chats</div>
        <div className="sidenav-recent-list">
          {recentChats.length === 0 ? (
            <p className="sidenav-recent-empty">No chats yet</p>
          ) : (
            recentChats.map((c) => (
              <button
                key={c.id}
                type="button"
                tabIndex={tab}
                className="sidenav-recent-item"
                onClick={() => onOpenChat(c.id)}
                title={c.title}
              >
                {c.title}
              </button>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
