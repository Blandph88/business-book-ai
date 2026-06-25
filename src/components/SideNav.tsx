import "./SideNav.css";
import { TABS, type TabId } from "./TabNav";

// The responsive left navigation, used on narrow screens (CSS-gated — hidden on wide screens
// and on the device-gated mobile shell, which keeps its bottom bar). Collapsed it's a thin
// rail with just an expand button at the top; expanded it's a drawer listing the nav items
// (same order as the wide top-bar nav) plus an Import action. Opening it PUSHES the page content
// to the right (no dimming overlay) and it STAYS open — picking an item doesn't close it; only
// the toggle does.
export function SideNav({
  activeTab,
  open,
  onToggle,
  onSelect,
  onImport,
}: {
  activeTab: TabId;
  open: boolean;
  onToggle: () => void;
  onSelect: (tab: TabId) => void;
  onImport: () => void;
}) {
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
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            tabIndex={open ? 0 : -1}
            className={
              t.id === activeTab ? "sidenav-item sidenav-item--active" : "sidenav-item"
            }
            onClick={() => onSelect(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          tabIndex={open ? 0 : -1}
          className="sidenav-item sidenav-item--import"
          onClick={onImport}
        >
          ⬆ Import your LinkedIn
        </button>
      </nav>
    </aside>
  );
}
