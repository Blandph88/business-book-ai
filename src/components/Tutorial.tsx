import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "./Tutorial.css";
import type { TabId } from "./TabNav";

// A guided spotlight tour. Each step optionally switches to a tab and highlights a real
// element there (so the walkthrough shows the live app + its mock data, never a stale
// screenshot). Steps with no target render a centred card (welcome / import how-to / finish).
export type TourStep = {
  id: string;
  tab?: TabId;
  target?: string; // CSS selector to spotlight on that tab
  title: string;
  body: ReactNode;
  illustration?: ReactNode;
};

// The LinkedIn-export mini-illustration (can't be shown live — the demo has no real import).
function ExportIllustration() {
  return (
    <ol className="tut-illus">
      <li>
        <span className="tut-illus-n">1</span>
        On LinkedIn: <strong>Settings &amp; Privacy → Data Privacy → Get a copy of your data</strong>
      </li>
      <li>
        <span className="tut-illus-n">2</span>
        Tick <strong>Connections</strong> and <strong>Messages</strong>, then request the archive
      </li>
      <li>
        <span className="tut-illus-n">3</span>
        Download the ZIP when it’s ready, unzip it, and keep <strong>Connections.csv</strong> + <strong>messages.csv</strong>
      </li>
    </ol>
  );
}

export const TOUR_STEPS: TourStep[] = [
  // ── Intro + import ──────────────────────────────────────────────────────
  {
    id: "welcome",
    title: "Welcome to Business Book 👋",
    body: (
      <>
        Your LinkedIn network turned into a working BD pipeline — classified by industry,
        function and seniority, and read <strong>entirely on your computer</strong>. This tour
        walks every tab; leave any time with the ✕.
      </>
    ),
  },
  {
    id: "import-export",
    title: "First — export from LinkedIn",
    body: <>Grab your data from LinkedIn. It only takes a couple of minutes:</>,
    illustration: <ExportIllustration />,
  },
  {
    id: "import-button",
    target: ".topbar-import",
    title: "Then import it here",
    body: (
      <>
        Click <strong>Import your LinkedIn</strong> and pick your <strong>Connections.csv</strong>{" "}
        (and optionally <strong>messages.csv</strong>). It’s parsed and classified on your machine —
        nothing is uploaded anywhere. The demo below is pre-filled with sample data.
      </>
    ),
  },

  // ── Dashboard ───────────────────────────────────────────────────────────
  {
    id: "dash-kpis",
    tab: "dashboard",
    target: ".kpi-grid",
    title: "Dashboard — the headline numbers",
    body: (
      <>
        Your four KPIs: what <strong>needs attention</strong>, your <strong>weighted pipeline</strong>,{" "}
        <strong>My book</strong> (recognised revenue credited to you), and <strong>win rate</strong>.
        Click any card to jump to the work behind it.
      </>
    ),
  },
  {
    id: "dash-week",
    tab: "dashboard",
    target: '[data-tour="dash-week"]',
    title: "This week",
    body: (
      <>
        Everything overdue or due in the next 7 days in one chronological list — follow-ups from
        Meetings and next steps from Opportunities, so nothing slips.
      </>
    ),
  },
  {
    id: "dash-priorities",
    tab: "dashboard",
    target: '[data-tour="dash-priorities"]',
    title: "Priorities — where to focus",
    body: (
      <>
        Computed, not hand-tagged: <strong>Close these</strong> (your biggest deals nearest
        signature) and <strong>Key relationships</strong> (senior decision-makers, boosted by live
        deals).
      </>
    ),
  },
  {
    id: "dash-net-funnel",
    tab: "dashboard",
    target: '[data-tour="dash-net-funnel"]',
    title: "Networking → meeting funnel",
    body: (
      <>
        How your whole network converts down to meetings: Your network → Messaged → Responded →
        Agreed to meet → Met, with the conversion rate at each stage.
      </>
    ),
  },
  {
    id: "dash-opp-funnel",
    tab: "dashboard",
    target: '[data-tour="dash-opp-funnel"]',
    title: "Opportunity funnel",
    body: (
      <>
        Your live deals by phase, from prospecting through to close, plus the Open / Won / Lost
        split — a quick read on the shape of your pipeline.
      </>
    ),
  },
  {
    id: "dash-hygiene",
    tab: "dashboard",
    target: '[data-tour="dash-hygiene"]',
    title: "Loose ends & staying warm",
    body: (
      <>
        Data-hygiene nudges: won work with no SoW, deals missing a value, decision-makers to log —
        plus (further down) <strong>Reconnect</strong> for warm contacts going quiet and{" "}
        <strong>Going cold</strong> for stalling deals.
      </>
    ),
  },

  // ── Metrics ─────────────────────────────────────────────────────────────
  {
    id: "met-funnel",
    tab: "metrics",
    target: '[data-tour="met-funnel"]',
    title: "Metrics — funnel by segment",
    body: (
      <>
        The same funnel, but each stage is stacked by <strong>sector group</strong> so you can see
        which industries you convert best. Click a segment to drill into those contacts.
      </>
    ),
  },
  {
    id: "met-segments",
    tab: "metrics",
    target: '[data-tour="met-segments"]',
    title: "Seniority & function",
    body: (
      <>
        Who your network actually is — broken down by <strong>seniority</strong> (left) and{" "}
        <strong>function</strong> (right). Use the “Breakdowns show” toggle above to switch the
        population (whole network vs Responded / Agreed / Met).
      </>
    ),
  },
  {
    id: "met-penetration",
    tab: "metrics",
    target: '[data-tour="met-penetration"]',
    title: "Market penetration",
    body: (
      <>
        How deep you are in each industry. Click any number to open a company-by-company{" "}
        <strong>matrix</strong> — entities × seniority — to see exactly who you know where.
      </>
    ),
  },
  {
    id: "met-followups",
    tab: "metrics",
    target: '[data-tour="met-followups"]',
    title: "Follow-up actions",
    body: (
      <>
        Your worklists for moving the funnel along — who you haven’t messaged yet, and who you’re
        still awaiting a reply from.
      </>
    ),
  },
  {
    id: "met-opp-phase",
    tab: "metrics",
    target: '[data-tour="met-opp-phase"]',
    title: "Opportunities by phase",
    body: <>The full pipeline as a bar per phase, including Lost, with counts that reconcile to your total.</>,
  },
  {
    id: "met-opp-breakdowns",
    tab: "metrics",
    target: '[data-tour="met-opp-breakdowns"]',
    title: "Opportunity breakdowns",
    body: (
      <>
        Pipeline value sliced by service line, sector and function — each shown by count and by
        weighted value. Use the phase/step buttons to narrow it down.
      </>
    ),
  },

  // ── Contacts ────────────────────────────────────────────────────────────
  {
    id: "contacts-stats",
    tab: "contacts",
    target: ".statsbar",
    title: "Contacts — the funnel at a glance",
    body: (
      <>
        Your whole network and how far each contact has moved: Messaged → Responded → Agreed → Met.
        Click any number to <strong>filter the list</strong> to that stage.
      </>
    ),
  },
  {
    id: "contacts-search",
    tab: "contacts",
    target: ".table-controls",
    title: "Search & filter",
    body: (
      <>
        Type to search names, orgs or positions; use the <strong>dropdowns</strong> (Seniority,
        Sector, Relationship, Priority) to filter. And click any{" "}
        <strong>column header to sort</strong> ascending/descending.
      </>
    ),
  },
  {
    id: "contacts-list",
    tab: "contacts",
    target: ".contacts-table-wrap",
    title: "The contact list",
    body: (
      <>
        Every connection, classified automatically. Click a <strong>row</strong> to open it and add
        your own CRM fields — priority, relationship strength, next action — saved on your machine.
      </>
    ),
  },

  // ── Meetings ────────────────────────────────────────────────────────────
  {
    id: "meetings-stats",
    tab: "meetings",
    target: ".statsbar",
    title: "Meetings — at a glance",
    body: <>Scheduled vs held and the people you’ve actually met. Click a number to filter the list.</>,
  },
  {
    id: "meetings-search",
    tab: "meetings",
    target: ".table-controls",
    title: "Search & filter",
    body: (
      <>
        Search, then filter by Sector, <strong>Stage</strong>, Type, Sentiment or whether an
        opportunity was spotted — and click a header to sort.
      </>
    ),
  },
  {
    id: "meetings-list",
    tab: "meetings",
    target: ".meetings-table-wrap",
    title: "The meeting log",
    body: <>Click a row to log how a meeting went, capture sentiment, and flag a spotted opportunity.</>,
  },

  // ── Opportunities ───────────────────────────────────────────────────────
  {
    id: "opps-stats",
    tab: "opportunities",
    target: ".statsbar",
    title: "Opportunities — at a glance",
    body: (
      <>
        Count, open deals, weighted pipeline and won. Click <strong>Open</strong> or{" "}
        <strong>Won</strong> to filter the list.
      </>
    ),
  },
  {
    id: "opps-search",
    tab: "opportunities",
    target: ".table-controls",
    title: "Search & filter",
    body: (
      <>
        Filter by Sector, Service line, <strong>Phase</strong>, Step or Status, and sort any column —
        so you can work, say, all proposals over a certain value.
      </>
    ),
  },
  {
    id: "opps-list",
    tab: "opportunities",
    target: ".opps-table-wrap",
    title: "The pipeline",
    body: <>Click a deal to move it through the phases, set its value and probability, and record win/loss.</>,
  },

  // ── Revenue & SoW ───────────────────────────────────────────────────────
  {
    id: "rev-stats",
    tab: "revenue",
    target: ".statsbar",
    title: "Revenue & SoW — the money",
    body: (
      <>
        Your headline totals — <strong>My book</strong>, recognised and contracted — with status
        chips below (Active / Completed / …) that filter the list.
      </>
    ),
  },
  {
    id: "rev-search",
    tab: "revenue",
    target: ".table-controls",
    title: "Search & filter",
    body: <>Search engagements, filter by Service line, and sort any column (contracted value, % recognised…).</>,
  },
  {
    id: "rev-list",
    tab: "revenue",
    target: ".rev-table-wrap",
    title: "Signed work",
    body: (
      <>
        Click a row to price it your way — <strong>fixed-price</strong> deliverables or a{" "}
        <strong>time &amp; materials</strong> rate card — and track recognised revenue.
      </>
    ),
  },

  // ── Finish ──────────────────────────────────────────────────────────────
  {
    id: "finish",
    title: "That’s the tour 🎉",
    body: (
      <>
        Have a play around — it’s all sample data until you import your own. Re-open this
        walkthrough any time from the <strong>?</strong> button in the top-right.
      </>
    ),
  },
];

export function Tutorial({
  steps = TOUR_STEPS,
  onTab,
  onClose,
}: {
  steps?: TourStep[];
  onTab: (tab: TabId) => void;
  onClose: () => void;
}) {
  const [i, setI] = useState(0);
  const step = steps[i];
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Measured card height, so we can keep the whole card (incl. the Next button) on-screen.
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(220);
  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [i, rect]);

  const isLast = i === steps.length - 1;
  const next = () => (isLast ? onClose() : setI((n) => Math.min(n + 1, steps.length - 1)));
  const prev = () => setI((n) => Math.max(n - 1, 0));

  // Switch to the step's tab (if any) when the step changes.
  useEffect(() => {
    if (step.tab) onTab(step.tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  // Find + measure the spotlight target after the tab/step renders (retry a few times while
  // the new tab mounts). No target → centred card.
  useEffect(() => {
    if (!step.target) {
      setRect(null);
      return;
    }
    let timer = 0;
    let tries = 0;
    const measure = () => {
      const el = document.querySelector(step.target!) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "auto" });
        setRect(el.getBoundingClientRect());
      } else if (tries++ < 24) {
        timer = window.setTimeout(measure, 60);
      } else {
        setRect(null);
      }
    };
    timer = window.setTimeout(measure, 60);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  // Keep the spotlight pinned to the target through scroll/resize.
  useEffect(() => {
    if (!step.target) return;
    const reposition = () => {
      const el = document.querySelector(step.target!) as HTMLElement | null;
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  // Keyboard: Esc closes, ←/→ navigate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Position the spotlight ring + the caption card.
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const CARD_W = Math.min(440, vw - 24);

  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  let cardStyle: React.CSSProperties;
  if (rect) {
    const left = clamp(rect.left + rect.width / 2 - CARD_W / 2, 12, vw - CARD_W - 12);
    // Prefer below the target; if that would overflow the bottom, place above; then clamp
    // so the entire card (Next button included) is always within the viewport.
    let top = rect.bottom + 16;
    if (top + cardH > vh - 12) top = rect.top - 16 - cardH;
    top = clamp(top, 12, vh - cardH - 12);
    cardStyle = { top, left, width: CARD_W };
  } else {
    cardStyle = { top: clamp((vh - cardH) / 2, 12, vh - cardH - 12), left: (vw - CARD_W) / 2, width: CARD_W };
  }

  return (
    <div className="tut" role="dialog" aria-modal="true" aria-label="Tutorial">
      {rect ? (
        <div
          className="tut-spot"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
          }}
        />
      ) : (
        <div className="tut-dim" />
      )}

      <div className="tut-card" ref={cardRef} style={cardStyle}>
        <button className="tut-x" onClick={onClose} aria-label="Close tutorial" title="Close">
          ✕
        </button>
        {step.illustration}
        <h3 className="tut-title">{step.title}</h3>
        <div className="tut-body">{step.body}</div>
        <div className="tut-foot">
          <div className="tut-progress">
            <span className="tut-progress-text">
              {i + 1} / {steps.length}
            </span>
            <span className="tut-progress-track" aria-hidden="true">
              <span
                className="tut-progress-fill"
                style={{ width: `${((i + 1) / steps.length) * 100}%` }}
              />
            </span>
          </div>
          <div className="tut-actions">
            {!isLast && (
              <button className="tut-skip" onClick={onClose}>
                Skip
              </button>
            )}
            {i > 0 && (
              <button className="tut-back" onClick={prev}>
                Back
              </button>
            )}
            <button className="tut-next" onClick={next}>
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
