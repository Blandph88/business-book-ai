import { useEffect, useMemo, useState } from "react";
import "./DashboardTab.css";
import { loadContacts, type Contact } from "../data/contacts";
import { loadAllEdits, type OwnerEdits } from "../storage/ownerEdits";
import { loadAllMeetings } from "../storage/meetings";
import {
  buildMeetingRows,
  heldContactUrls,
  lastMetByUrl,
  type MeetingRow,
} from "../data/meetings";
import { loadFunnelSummary, type FunnelSummary } from "../data/funnel";
import {
  loadAllOpportunities,
  type Opportunity,
} from "../storage/opportunities";
import { loadAllSows, type Sow } from "../storage/revenue";
import {
  openWeightedPipeline,
  pipelineByPhase,
  opportunityStatus,
  opportunityPhase,
} from "../data/opportunities";
import { totalRecognised } from "../data/revenue";
import { computeFunnelStacked } from "../data/metrics";
import { detectOrphans } from "../data/orphans";
import { buildAgenda, todayISO, type AgendaItem } from "../data/agenda";
import {
  staleContacts,
  winLossStats,
  agingOpportunities,
  hotOpportunities,
  keyContacts,
  phaseReachedFunnel,
  activityStats,
  looseEnds,
} from "../data/dashboard";
import { loadTargets, saveTargets, type Targets } from "../storage/targets";
import { stepShort } from "../data/vocab";
import { formatMoney } from "../data/format";
import type { TabId, TabIntent, Navigate } from "../components/TabNav";
import { YourDay } from "../components/YourDay";

// The Dashboard HOME — a glance-and-go page where every number/item DEEP-LINKS to the
// exact filtered list (and, for single records, the open slide-in form). Two clickable
// funnels (networking→meeting and opportunity) replace the old duplicated KPI grid +
// pipeline snapshot. "This week" is urgency (dated commitments, grouped by tab);
// "Priorities" is importance (flags & value). All numbers reuse the same compute helpers
// as the Metrics/CRM tabs, so they reconcile to the lists they open (CLAUDE.md §6).

type DashboardTabProps = {
  onNavigate: Navigate; // switch tab, optionally with a deep-link intent
};

// Map a networking-funnel stage to where its contacts live + the filter to apply.
// Invitations has no contact list (pending invitees aren't contacts) → not linked.
function funnelNav(label: string): { tab: TabId; intent?: TabIntent } | null {
  switch (label) {
    case "Your network":
      return { tab: "contacts" };
    case "Messaged":
      return { tab: "contacts", intent: { filter: { key: "messaged", value: "Yes" } } };
    case "Responded":
      return { tab: "contacts", intent: { filter: { key: "responded", value: "Yes" } } };
    case "Agreed to meet":
      return { tab: "contacts", intent: { filter: { key: "agreed", value: "Yes" } } };
    case "Met":
      return { tab: "meetings", intent: { filter: { key: "stage", value: "Held" } } };
    default:
      return null;
  }
}

export function DashboardTab({ onNavigate }: DashboardTabProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [edits, setEdits] = useState<Record<string, OwnerEdits>>({});
  const [meetingRows, setMeetingRows] = useState<MeetingRow[]>([]);
  const [heldUrls, setHeldUrls] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<FunnelSummary | null>(null);
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [sows, setSows] = useState<Sow[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [orphansDismissed, setOrphansDismissed] = useState(false);

  const today = todayISO();

  // Load everything the home page summarises once, on mount.
  useEffect(() => {
    const savedEdits = loadAllEdits();
    const savedMeetings = loadAllMeetings();
    setEdits(savedEdits);
    setHeldUrls(heldContactUrls(savedMeetings));
    setOpps(Object.values(loadAllOpportunities()));
    setSows(Object.values(loadAllSows()));
    loadFunnelSummary().then(setSummary).catch(() => setSummary(null));
    loadContacts()
      .then((rows) => {
        setContacts(rows);
        setMeetingRows(buildMeetingRows(rows, savedMeetings));
        setStatus("ready");
      })
      .catch((err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
  }, []);

  // ── Derived numbers (reuse the shared helpers) ──────────────────────────
  const funnel = useMemo(
    () => computeFunnelStacked(contacts, { summary, metUrls: heldUrls }),
    [contacts, summary, heldUrls],
  );
  const pipeline = useMemo(() => pipelineByPhase(opps), [opps]);
  const openOpps = useMemo(
    () => opps.filter((o) => opportunityStatus(o) === "Open"),
    [opps],
  );
  const weightedPipeline = useMemo(() => openWeightedPipeline(opps), [opps]);
  const winLoss = useMemo(() => winLossStats(opps), [opps]);

  // Recognised revenue across all signed contracts.
  const recognised = useMemo(() => totalRecognised(sows), [sows]);

  // The most recent held date per contact ("last met"), shared by the agenda's Reconnect.
  const lastMet = useMemo(() => lastMetByUrl(meetingRows), [meetingRows]);

  // This-week agenda (overdue + next 7 days), one chronological list (most overdue first).
  const agenda = useMemo(
    () => buildAgenda(meetingRows, opps, today, sows),
    [meetingRows, opps, today, sows],
  );

  const orphans = useMemo(
    () => detectOrphans(contacts, edits, meetingRows, opps),
    [contacts, edits, meetingRows, opps],
  );

  // Priorities (importance), computed — not manual tags. "Close these" = big deals near
  // signature; "Key relationships" = senior decision-makers (boosted by a live deal).
  const hotOpps = useMemo(() => hotOpportunities(opps), [opps]);
  const keyPeople = useMemo(
    () => keyContacts(contacts, edits, opps),
    [contacts, edits, opps],
  );

  // New cards: opportunity stage funnel, this-month activity, editable targets.
  const phaseReached = useMemo(() => phaseReachedFunnel(opps), [opps]);
  const activity = useMemo(
    () => activityStats(meetingRows, opps, today),
    [meetingRows, opps, today],
  );
  const [targets, setTargets] = useState<Targets>(() => loadTargets());
  const setTarget = (patch: Targets) =>
    setTargets((t) => saveTargets({ ...t, ...patch }));

  // Loose ends — cross-record gaps to tidy (the app's data-hygiene job, not yours).
  const loose = useMemo(
    () => looseEnds(opps, contacts, edits, sows),
    [opps, contacts, edits, sows],
  );
  const looseTotal = loose.reduce((n, g) => n + g.items.length, 0);

  // Extras: stale relationships + stage-aging opportunities.
  const stale = useMemo(
    () => staleContacts(contacts, edits, lastMet, today),
    [contacts, edits, lastMet, today],
  );
  const aging = useMemo(
    () => agingOpportunities(opps, today),
    [opps, today],
  );

  // Step-to-step conversion across the networking funnel.
  const conv = useMemo(() => {
    const count = (label: string) =>
      funnel.find((s) => s.label === label)?.count ?? 0;
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
    const target = count("Your network");
    const messaged = count("Messaged");
    const responded = count("Responded");
    const agreed = count("Agreed to meet");
    const met = count("Met");
    return {
      messaged: pct(messaged, target),
      responded: pct(responded, messaged),
      agreed: pct(agreed, responded),
      met: pct(met, agreed),
    };
  }, [funnel]);

  if (status === "loading") {
    return <p className="home-status">Loading dashboard…</p>;
  }
  if (status === "error") {
    return (
      <div className="home-status home-status--error">
        <p>Couldn’t load the dashboard data.</p>
        <p className="home-error-detail">{errorMsg}</p>
      </div>
    );
  }

  const winRateLabel =
    winLoss.winRate === null ? "—" : `${Math.round(winLoss.winRate * 100)}%`;

  return (
    <section className="home">
      <h2 className="home-title">Dashboard</h2>

      {/* AI morning brief (separate from the deterministic dashboard below). */}
      <YourDay />

      {/* ── Orphaned-data notice (after a pipeline refresh) ─────────────── */}
      {orphans.length > 0 && !orphansDismissed && (
        <div className="orphan-note">
          <div className="orphan-note-head">
            <strong>
              {orphans.length} saved item{orphans.length === 1 ? "" : "s"} no longer
              match a contact in the latest data
            </strong>
            <button
              type="button"
              className="orphan-note-x"
              title="Dismiss for now"
              onClick={() => setOrphansDismissed(true)}
            >
              ✕
            </button>
          </div>
          <p className="orphan-note-body">
            A pipeline refresh dropped or changed these contacts’ URLs, so notes /
            meetings / opportunities you entered are stranded (not lost). Re-add the
            contact or re-link the record to recover them.
          </p>
          <ul className="orphan-note-list">
            {orphans.slice(0, 8).map((o, i) => (
              <li key={`${o.kind}-${o.url}-${i}`}>
                <span className="orphan-kind">{o.kind}</span> {o.label}{" "}
                <a href={o.url} target="_blank" rel="noreferrer">
                  open profile ↗
                </a>
              </li>
            ))}
            {orphans.length > 8 && <li>…and {orphans.length - 8} more</li>}
          </ul>
        </div>
      )}

      {/* ── Headline stats ────────────────────────────────────────────── */}
      <div className="kpi-grid">
        <KpiCard label="Needs attention" value={agenda.length} hint="overdue + this week" />
        <KpiCard label="Weighted pipeline" value={formatMoney(weightedPipeline)} onClick={() => onNavigate("opportunities", { filter: { key: "status", value: "Open" } })} />
        <KpiCard label="Recognised" value={formatMoney(recognised)} hint="across signed contracts" onClick={() => onNavigate("revenue")} />
        <KpiCard label="Win rate" value={winRateLabel} hint={`${winLoss.won}W · ${winLoss.lost}L`} onClick={() => onNavigate("opportunities", { filter: { key: "status", value: "Won" } })} />
      </div>

      {/* ── This week (urgency) — one full-width chronological table ──── */}
      <div className="home-card" data-tour="dash-week">
        <div className="home-card-head">
          <h3>This week</h3>
          <span className="home-card-sub">
            Overdue + next 7 days · {agenda.length}
          </span>
        </div>
        {agenda.length === 0 ? (
          <p className="home-empty">
            Nothing due. Follow-up dates on Meetings and next steps on Opportunities
            surface here.
          </p>
        ) : (
          <AgendaTable items={agenda} onNavigate={onNavigate} />
        )}
      </div>

      {/* ── Priorities (importance), computed from stage / value / seniority ── */}
      <div className="home-card" data-tour="dash-priorities">
        <div className="home-card-head">
          <h3>Priorities</h3>
          <span className="home-card-sub">
            Where to focus — computed, not manually tagged
          </span>
        </div>
        <div className="home-cols">
          <div>
            <h4 className="home-sub">Close these</h4>
            <p className="home-microcopy">Biggest deals nearest signature.</p>
            {hotOpps.length === 0 ? (
              <p className="home-empty">No open opportunities yet.</p>
            ) : (
              <ul className="home-list">
                {hotOpps.map(({ opp, signBy }) => (
                  <ClickRow
                    key={opp.id}
                    main={opp.opportunity_name || opp.organisation || "(unnamed)"}
                    meta={`${stepShort(opp.current_step)} · ${formatMoney(opp.est_value)}${signBy ? ` · sign by ${signBy}` : ""}`}
                    onClick={() =>
                      onNavigate("opportunities", {
                        search: opp.opportunity_name || opp.organisation || "",
                        openId: opp.id,
                      })
                    }
                  />
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="home-sub">Key relationships</h4>
            <p className="home-microcopy">Senior decision-makers, boosted by live deals.</p>
            {keyPeople.length === 0 ? (
              <p className="home-empty">No contacts to surface yet.</p>
            ) : (
              <ul className="home-list">
                {keyPeople.map(({ contact: c, reason }) => (
                  <ClickRow
                    key={c.url}
                    main={`${c.first} ${c.last}`.trim()}
                    meta={`${c.organisation} · ${reason}`}
                    onClick={() =>
                      onNavigate("contacts", {
                        search: `${c.first} ${c.last}`.trim(),
                        openId: c.url,
                      })
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* ── Loose ends (data hygiene) ────────────────────────────────── */}
      <div className="home-card" data-tour="dash-hygiene">
        <div className="home-card-head">
          <h3>Loose ends</h3>
          <span className="home-card-sub">
            {looseTotal === 0 ? "All tidy" : `${looseTotal} to tidy`}
          </span>
        </div>
        {loose.length === 0 ? (
          <p className="home-empty">
            Nothing inconsistent — your pipeline data hangs together. ✓
          </p>
        ) : (
          <div className="home-cols">
            {loose.map((g) => (
              <div key={g.key}>
                <h4 className="home-sub">
                  {g.title} ({g.items.length})
                </h4>
                <ul className="home-list">
                  {g.items.slice(0, 5).map((it, i) => (
                    <ClickRow
                      key={`${g.key}-${it.openId}-${i}`}
                      main={it.label}
                      meta={it.meta}
                      onClick={() =>
                        onNavigate(it.tab, {
                          openId: it.openId,
                          search: it.label,
                        })
                      }
                    />
                  ))}
                  {g.items.length > 5 && (
                    <li className="home-more">+{g.items.length - 5} more</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Targets + this-month activity ────────────────────────────── */}
      <div className="home-cols">
        <div className="home-card">
          <div className="home-card-head">
            <h3>Targets</h3>
          </div>
          <TargetBar
            label="Weighted pipeline"
            current={weightedPipeline}
            target={targets.pipeline}
            money
            onTarget={(v) => setTarget({ pipeline: v })}
          />
          <TargetBar
            label="People met this month"
            current={activity.peopleMet.thisMonth}
            target={targets.meetingsPerMonth}
            onTarget={(v) => setTarget({ meetingsPerMonth: v })}
          />
        </div>
        <div className="home-card">
          <div className="home-card-head">
            <h3>This month</h3>
          </div>
          <div className="act-stats">
            <ActivityStat
              label="People met"
              now={activity.peopleMet.thisMonth}
              prev={activity.peopleMet.lastMonth}
            />
            <ActivityStat
              label="Opportunities created"
              now={activity.oppsCreated.thisMonth}
              prev={activity.oppsCreated.lastMonth}
            />
          </div>
        </div>
      </div>

      {/* ── The two funnels (clickable) ─────────────────────────────────── */}
      <div className="home-cols">
        <div className="home-card" data-tour="dash-net-funnel">
          <div className="home-card-head">
            <h3>Networking → meeting funnel</h3>
            <button type="button" className="home-link" onClick={() => onNavigate("metrics")}>
              Full breakdown →
            </button>
          </div>
          <div className="funnel">
            {funnel.map((stage) => {
              const nav = funnelNav(stage.label);
              return (
                <FunnelRow
                  key={stage.label}
                  label={stage.label}
                  count={stage.count}
                  pct={stage.pctOfTarget}
                  onClick={nav ? () => onNavigate(nav.tab, nav.intent) : undefined}
                />
              );
            })}
          </div>
          <p className="funnel-conv">
            Conversion: {conv.messaged}% messaged · {conv.responded}% responded ·{" "}
            {conv.agreed}% agreed · {conv.met}% met
          </p>
        </div>

        <div className="home-card" data-tour="dash-opp-funnel">
          <div className="home-card-head">
            <h3>Opportunity funnel</h3>
          </div>
          {pipeline.total === 0 ? (
            <p className="home-empty">No opportunities in the pipeline yet.</p>
          ) : (
            <>
              <div className="funnel">
                {pipeline.items.map((it) => (
                  <FunnelRow
                    key={it.label}
                    label={it.label}
                    count={it.count}
                    onClick={() => onNavigate("opportunities", { filter: { key: "phase", value: it.label } })}
                  />
                ))}
              </div>
              <div className="funnel-status">
                <StatusChip label="Open" n={openOpps.length} onClick={() => onNavigate("opportunities", { filter: { key: "status", value: "Open" } })} />
                <StatusChip label="Won" n={winLoss.won} onClick={() => onNavigate("opportunities", { filter: { key: "status", value: "Won" } })} />
                <StatusChip label="Lost" n={winLoss.lost} onClick={() => onNavigate("opportunities", { filter: { key: "status", value: "Lost" } })} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Opportunity stage conversion (snapshot) ──────────────────────── */}
      {phaseReached.total > 0 && (
        <div className="home-card">
          <div className="home-card-head">
            <h3>Stage conversion</h3>
            <span className="home-card-sub">
              Snapshot: how far deals reach · win rate {winRateLabel} ({winLoss.won}W ·{" "}
              {winLoss.lost}L)
            </span>
          </div>
          <div className="stageconv">
            {phaseReached.items.map((it, i) => {
              const prevReached =
                i === 0 ? phaseReached.total : phaseReached.items[i - 1].reached;
              const kept = prevReached
                ? Math.round((it.reached / prevReached) * 100)
                : 0;
              return (
                <div key={it.phase} className="stageconv-row">
                  <span className="stageconv-label">{it.phase}</span>
                  <span className="stageconv-bar">
                    <span
                      className="stageconv-fill"
                      style={{ width: `${Math.round(it.pct * 100)}%` }}
                    />
                  </span>
                  <span className="stageconv-n">{it.reached}</span>
                  <span className="stageconv-kept">
                    {i === 0 ? "" : `${kept}% kept`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Going cold: stale relationships + aging opportunities ───────── */}
      <div className="home-cols">
        <div className="home-card">
          <div className="home-card-head">
            <h3>Reconnect</h3>
            <span className="home-card-sub">Warm+ contacts gone quiet (45 days+)</span>
          </div>
          {stale.length === 0 ? (
            <p className="home-empty">No warm relationships overdue a touch.</p>
          ) : (
            <ul className="home-list">
              {stale.slice(0, 6).map(({ contact: c, relationship, daysSince }) => (
                <ClickRow
                  key={c.url}
                  main={`${c.first} ${c.last}`}
                  meta={`${c.organisation} · ${relationship} · ${daysSince === null ? "never logged" : `${daysSince}d ago`}`}
                  onClick={() => onNavigate("contacts", { search: `${c.first} ${c.last}`.trim(), openId: c.url })}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="home-card">
          <div className="home-card-head">
            <h3>Going cold</h3>
            <span className="home-card-sub">Open opportunities with no movement (30 days+)</span>
          </div>
          {aging.length === 0 ? (
            <p className="home-empty">No open opportunities are stalling.</p>
          ) : (
            <ul className="home-list">
              {aging.slice(0, 6).map(({ opp: o, daysSince }) => (
                <ClickRow
                  key={o.id}
                  main={o.opportunity_name || o.organisation || "(unnamed)"}
                  meta={`${opportunityPhase(o)} · ${daysSince}d since last activity`}
                  onClick={() => onNavigate("opportunities", { openId: o.id })}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

// ── KPI card (clickable when given an onClick, otherwise a plain stat) ────────
function KpiCard({
  label,
  value,
  hint,
  onClick,
}: {
  label: string;
  value: string | number;
  hint?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span className="kpi-value">{value}</span>
      <span className="kpi-label">{label}</span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className="kpi-card kpi-card--click" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="kpi-card">{inner}</div>
  );
}

// ── One funnel stage row (clickable when given an onClick) ───────────────────
function FunnelRow({
  label,
  count,
  pct,
  onClick,
}: {
  label: string;
  count: number;
  pct?: number | null;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span className="fr-count">{count}</span>
      <span className="fr-label">{label}</span>
      <span className="fr-pct">{pct != null ? `${pct}%` : ""}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="fr fr--click" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="fr">{inner}</div>
  );
}

function StatusChip({
  label,
  n,
  onClick,
}: {
  label: string;
  n: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className="status-chip" onClick={onClick}>
      {label} <strong>{n}</strong>
    </button>
  );
}

// ── A clickable list row (name + meta) ───────────────────────────────────────
function ClickRow({
  main,
  meta,
  onClick,
}: {
  main: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <li
      className="home-row home-row--click"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(ev) => clickKey(ev, onClick)}
    >
      <span className="home-row-main">{main}</span>
      <span className="home-row-meta">{meta}</span>
    </li>
  );
}

// ── "This week" — one full-width chronological table ─────────────────────────
function AgendaTable({
  items,
  onNavigate,
}: {
  items: AgendaItem[];
  onNavigate: Navigate;
}) {
  // Each item's record type, for the Type column (contacts no longer produce items).
  const typeLabel = (kind: AgendaItem["kind"]) =>
    kind === "Opportunity next step"
      ? "Opportunity"
      : kind === "Contract next step"
        ? "Contract"
        : "Meeting";
  return (
    <div className="agenda-table-wrap">
      <table className="agenda-table">
        <thead>
          <tr>
            <th>Due</th>
            <th>Type</th>
            <th>Status</th>
            <th>Action</th>
            <th>Who</th>
            <th>Organisation</th>
            <th className="num">Value</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const go = () =>
              onNavigate(item.tab, { search: item.who, openId: item.openId });
            return (
              <tr
                key={`${item.openId}-${i}`}
                className={item.overdue ? "agenda-tr agenda-tr--overdue" : "agenda-tr"}
                role="button"
                tabIndex={0}
                onClick={go}
                onKeyDown={(ev) => clickKey(ev, go)}
              >
                <td className="agenda-due">
                  <span className="agenda-when">{whenLabel(item)}</span>
                  <span className="agenda-date">{item.date}</span>
                </td>
                <td>
                  <span className="agenda-type">{typeLabel(item.kind)}</span>
                </td>
                <td>
                  <span
                    className={
                      item.overdue
                        ? "agenda-status agenda-status--overdue"
                        : "agenda-status"
                    }
                  >
                    {item.statusLabel}
                  </span>
                </td>
                <td>{item.what}</td>
                <td>{item.who}</td>
                <td className="agenda-org">{item.org || "—"}</td>
                <td className="num">
                  {item.value != null ? formatMoney(item.value) : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── A target with a progress bar + an inline editable target value ───────────
function TargetBar({
  label,
  current,
  target,
  money = false,
  onTarget,
}: {
  label: string;
  current: number;
  target?: number;
  money?: boolean;
  onTarget: (v: number | undefined) => void;
}) {
  const pct = target ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const fmt = (n: number) => (money ? formatMoney(n) : String(n));
  return (
    <div className="target">
      <div className="target-head">
        <span className="target-label">{label}</span>
        <span className="target-nums">
          {fmt(current)} /{" "}
          <input
            type="number"
            className="target-input"
            value={target ?? ""}
            placeholder="target"
            onChange={(e) =>
              onTarget(e.target.value === "" ? undefined : Number(e.target.value))
            }
          />
          {target ? ` (${pct}%)` : ""}
        </span>
      </div>
      <div className="target-bar">
        <span className="target-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── A this-month count with the prior-month delta ────────────────────────────
function ActivityStat({
  label,
  now,
  prev,
}: {
  label: string;
  now: number;
  prev: number;
}) {
  const delta = now - prev;
  return (
    <div className="act-stat">
      <span className="act-value">{now}</span>
      <span className="act-label">{label}</span>
      <span
        className={
          delta > 0
            ? "act-delta act-delta--up"
            : delta < 0
              ? "act-delta act-delta--down"
              : "act-delta"
        }
      >
        {delta === 0 ? "—" : delta > 0 ? `▲ ${delta}` : `▼ ${-delta}`} vs last month
      </span>
    </div>
  );
}

// A short human label for an agenda item's timing.
function whenLabel(item: AgendaItem): string {
  if (item.daysUntil < 0) {
    const n = -item.daysUntil;
    return n === 1 ? "1 day overdue" : `${n} days overdue`;
  }
  if (item.daysUntil === 0) return "Today";
  if (item.daysUntil === 1) return "Tomorrow";
  return `In ${item.daysUntil} days`;
}

// Shared keyboard handler so Enter/Space activate a clickable row (a11y).
function clickKey(ev: React.KeyboardEvent, run: () => void) {
  if (ev.key === "Enter" || ev.key === " ") {
    ev.preventDefault();
    run();
  }
}
