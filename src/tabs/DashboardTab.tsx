import { useEffect, useMemo, useState } from "react";
import "./DashboardTab.css";
import { loadContacts, type Contact } from "../data/contacts";
import { loadAllEdits, type OwnerEdits } from "../storage/ownerEdits";
import { loadAllMeetings } from "../storage/meetings";
import { buildMeetingRows, lastMetByUrl, type MeetingRow } from "../data/meetings";
import {
  loadAllOpportunities,
  type Opportunity,
} from "../storage/opportunities";
import { loadAllSows, type Sow } from "../storage/revenue";
import { openWeightedPipeline, opportunityPhase, opportunityStatus } from "../data/opportunities";
import { totalRecognised } from "../data/revenue";
import { detectOrphans } from "../data/orphans";
import { buildAgenda, todayISO, type AgendaItem } from "../data/agenda";
import {
  staleContacts,
  winLossStats,
  agingOpportunities,
  hotOpportunities,
  keyContacts,
  activityStats,
  looseEnds,
} from "../data/dashboard";
import { loadTargets, saveTargets, type Targets } from "../storage/targets";
import { stepShort } from "../data/vocab";
import { formatMoney } from "../data/format";
import type { Navigate } from "../components/TabNav";
import { YourDay } from "../components/YourDay";

// The Dashboard HOME — a glance-and-go page focused on ONE question: "what do I do now?".
// Everything deep-links to the exact filtered list (and, for single records, the open slide-in form),
// and every number reuses the same deterministic helpers as the CRM tabs so it reconciles to the lists
// it opens (CLAUDE.md §6). Deep pipeline ANALYTICS (the networking + opportunity funnels, stage
// conversion) live on the Metrics tab — the dashboard no longer duplicates them; it's the action home.
// Layout: AI brief · headline numbers · This week (urgency) · Focus (importance) · Progress · Housekeeping.

type DashboardTabProps = {
  onNavigate: Navigate; // switch tab, optionally with a deep-link intent
};

export function DashboardTab({ onNavigate }: DashboardTabProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [edits, setEdits] = useState<Record<string, OwnerEdits>>({});
  const [meetingRows, setMeetingRows] = useState<MeetingRow[]>([]);
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
    const savedMeetings = loadAllMeetings();
    setEdits(loadAllEdits());
    setOpps(Object.values(loadAllOpportunities()));
    setSows(Object.values(loadAllSows()));
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

  // ── Derived numbers (reuse the shared deterministic helpers) ────────────
  const openOppsCount = useMemo(
    () => opps.filter((o) => opportunityStatus(o) === "Open").length,
    [opps],
  );
  const weightedPipeline = useMemo(() => openWeightedPipeline(opps), [opps]);
  const winLoss = useMemo(() => winLossStats(opps), [opps]);
  const recognised = useMemo(() => totalRecognised(sows), [sows]);

  // The most recent held date per contact ("last met"), for the reconnect list.
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

  // Focus (importance), computed — not manual tags.
  const hotOpps = useMemo(() => hotOpportunities(opps), [opps]);
  const keyPeople = useMemo(
    () => keyContacts(contacts, edits, opps),
    [contacts, edits, opps],
  );
  const stale = useMemo(
    () => staleContacts(contacts, edits, lastMet, today),
    [contacts, edits, lastMet, today],
  );
  const aging = useMemo(
    () => agingOpportunities(opps, today),
    [opps, today],
  );

  // Progress: this-month activity + editable targets.
  const activity = useMemo(
    () => activityStats(meetingRows, opps, today),
    [meetingRows, opps, today],
  );
  const [targets, setTargets] = useState<Targets>(() => loadTargets());
  const setTarget = (patch: Targets) =>
    setTargets((t) => saveTargets({ ...t, ...patch }));

  // Housekeeping — cross-record gaps to tidy (the app's data-hygiene job, not yours).
  const loose = useMemo(
    () => looseEnds(opps, contacts, edits, sows),
    [opps, contacts, edits, sows],
  );
  const looseTotal = loose.reduce((n, g) => n + g.items.length, 0);

  // AI-derived headline signals — gated so they only appear once there's a signal.
  const repliesOwed = useMemo(
    () => contacts.filter((c) => c.thread && !c.thread.lastFromOwner).length,
    [contacts],
  );
  const oppSignals = useMemo(
    () => contacts.filter((c) => c.latentOpp?.text).length,
    [contacts],
  );

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

      {/* AI morning brief — fed the SAME computed signals the cards below show, so it can never narrate
          a different reality than the deterministic dashboard. Renders nothing when AI isn't set up. */}
      <YourDay
        today={today}
        contacts={contacts}
        edits={edits}
        meetingRows={meetingRows}
        agenda={agenda}
        hotOpps={hotOpps}
        stale={stale}
        aging={aging}
      />

      {/* ── Headline numbers ──────────────────────────────────────────── */}
      <div className="kpi-grid">
        <KpiCard label="Weighted pipeline" value={formatMoney(weightedPipeline)} hint={`${openOppsCount} open`} onClick={() => onNavigate("opportunities", { filter: { key: "status", value: "Open" } })} />
        <KpiCard label="Recognised" value={formatMoney(recognised)} hint="across signed engagements" onClick={() => onNavigate("revenue")} />
        <KpiCard label="Win rate" value={winRateLabel} hint={`${winLoss.won}W · ${winLoss.lost}L`} onClick={() => onNavigate("opportunities", { filter: { key: "status", value: "Won" } })} />
        {/* AI-derived — gated: only appear once there's a signal (owed replies from the deterministic thread
            read; opportunities from the opt-in message scan). */}
        {repliesOwed > 0 && (
          <KpiCard label="Replies owed" value={repliesOwed} hint="they messaged last" onClick={() => onNavigate("contacts", { filter: { key: "owed", value: "Yes" } })} />
        )}
        {oppSignals > 0 && (
          <KpiCard label="Opportunity signals in messages" value={oppSignals} hint="leads spotted by the scan — review & pursue" onClick={() => onNavigate("contacts", { filter: { key: "opportunity", value: "Yes" } })} />
        )}
      </div>

      {/* ── This week (urgency) — the hero: one full-width chronological table ── */}
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

      {/* ── Focus (importance) — who & what to chase, computed not tagged ── */}
      <div className="home-card" data-tour="dash-priorities">
        <div className="home-card-head">
          <h3>Focus</h3>
          <span className="home-card-sub">
            Who &amp; what to chase — computed, not manually tagged
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
        <div className="home-cols">
          <div>
            <h4 className="home-sub">Reconnect</h4>
            <p className="home-microcopy">Warm+ contacts gone quiet (45 days+).</p>
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
          <div>
            <h4 className="home-sub">Going cold</h4>
            <p className="home-microcopy">Open opportunities with no movement (30 days+).</p>
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
      </div>

      {/* ── Progress — targets + this-month activity (deep funnels/conversion live on Metrics) ── */}
      <div className="home-card">
        <div className="home-card-head">
          <h3>Progress</h3>
          <button type="button" className="home-link" onClick={() => onNavigate("metrics")}>
            Full breakdown →
          </button>
        </div>
        <div className="home-cols">
          {/* Targets you set (goal + % progress). People-met is a target here — its month-over-month
              trend is NOT repeated on the right, so no number appears twice. */}
          <div>
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
          {/* This-month trend — only the metric that isn't already a target above. */}
          <div className="act-stats">
            <ActivityStat
              label="Opportunities created"
              now={activity.oppsCreated.thisMonth}
              prev={activity.oppsCreated.lastMonth}
            />
          </div>
        </div>
      </div>

      {/* ── Housekeeping — data hygiene: loose ends + any orphaned records ── */}
      <div className="home-card" data-tour="dash-hygiene">
        <div className="home-card-head">
          <h3>Housekeeping</h3>
          <span className="home-card-sub">
            {looseTotal === 0 && orphans.length === 0 ? "All tidy" : `${looseTotal + (orphansDismissed ? 0 : orphans.length)} to tidy`}
          </span>
        </div>

        {/* Orphaned-data notice (after a pipeline refresh stranded saved records). */}
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
        ? "Engagement"
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
