import { useEffect, useMemo, useState, type ReactNode } from "react";
import "./MetricsTab.css";
import { loadContacts, loadConnections, type Contact } from "../data/contacts";
import { BarRow } from "../components/BarRow";
import { StackedBarRow } from "../components/StackedBarRow";
import { PipelineMatrix } from "../components/PipelineMatrix";
import {
  DrillPanel,
  Modal,
  ContactList,
  OpportunityList,
} from "../components/DrillPanel";
import type { Navigate } from "../components/TabNav";
import {
  OTHER_FUNCTIONS,
  SECTOR_GROUPS,
  OPPORTUNITY_PHASES,
  stepsByPhase,
  type OpportunityPhase,
  type OpportunityStep,
} from "../data/vocab";
import { SECTOR_GROUP_COLORS, rampColor } from "../data/palette";
import {
  computeFunnelStacked,
  computeSeniorityBars,
  computeFunctionBars,
  computeGroupSummary,
  computeMatrix,
  inPopulation,
  OUT_OF_SCOPE_GROUP,
  PENDING_GROUP,
  type Population,
  type MatrixColumns,
  type CategoryBreakdown,
  type FunnelStage,
} from "../data/metrics";
import {
  loadAllOpportunities,
  type Opportunity,
} from "../storage/opportunities";
import { loadAllMeetings, type MeetingsById } from "../storage/meetings";
import { heldContactUrls, meetingId } from "../data/meetings";
import { loadFunnelSummary, type FunnelSummary } from "../data/funnel";
import {
  pipelineByPhase,
  opportunitiesForPhase,
  opportunityPhase,
  opportunitiesBySectorGroup,
  opportunitiesByFunction,
  opportunitiesByServiceLine,
  weightedValue,
  UNASSIGNED_GROUP,
  type OppGroupBreakdown,
} from "../data/opportunities";
import { formatMoney } from "../data/format";

// The Dashboard (CLAUDE.md §4): the live, INTERACTIVE replacement for the old PDF.
//
// It reads the same enriched CSV as the Contacts tab (one source of truth) and
// derives every number through ../data/metrics.ts. Crucially, every metric returns
// the actual Contact[] behind it, so the count shown and the list you get when you
// click are the same array — they can never disagree (§6 rule 5).
//
// Interaction model (mirrors the EY report's structure):
//   • Funnel — stacked by sector group. Clicking a Responded/Agreed segment opens
//     that group's detailed matrix; clicking a Target/Messaged segment lists those
//     contacts directly (the report has no matrix for those stages).
//   • Seniority / Function — plain EY-ramp bars; click a bar to list its contacts.
//   • Market Penetration Summary — two by-group bar charts; click a bar to open the
//     matching detailed matrix (Two-Way or Confirmed Meetings).
//   • Inside a matrix — click any number to list those exact contacts (Back returns).
//   • Commercial pipeline-by-stage — click a stage to list those opportunities.

// One shared population selector drives the funnel-aligned breakdowns. Labels match
// the funnel vocabulary exactly (CLAUDE.md §5 consistency).
const POPULATIONS: { id: Population; label: string }[] = [
  { id: "full", label: "Target pipeline" },
  { id: "twoWay", label: "Responded" },
  { id: "agreed", label: "Agreed to meet" },
  { id: "met", label: "Met" },
];

// The three "Follow-up actions" lists — the gaps between consecutive funnel stages,
// each a list of people worth a specific next action.
type ActionTab = "unmessaged" | "noreply";

const ACTION_TABS: { id: ActionTab; label: string }[] = [
  { id: "unmessaged", label: "Not yet messaged" },
  { id: "noreply", label: "Awaiting reply" },
];

// The drill-down state machine. One of these (or null) describes what the slide-in
// panel is currently showing. `back` lets a matrix → contacts step return to the
// matrix it came from.
type Drill =
  | {
      kind: "matrix";
      rows: Contact[]; // ALREADY filtered to exactly this matrix's population
      entity: "organisation" | "sector_detail";
      columns: MatrixColumns;
      label: string; // prefix for cell drill titles
      title: string; // panel/modal header
      display: "panel" | "modal";
      dropEmptyColumns?: boolean;
    }
  | {
      kind: "contacts";
      title: string;
      contacts: Contact[];
      back?: Drill;
      display?: "panel" | "modal"; // inherit the parent matrix's container
    }
  | { kind: "opps"; title: string; opps: Opportunity[] }
  | null;

// Colours for the stacked funnel segments: the five sector groups + the two special
// top-stage segments (greys, so they read as "not a real sector group").
const SEGMENT_COLORS: Record<string, string> = {
  ...SECTOR_GROUP_COLORS,
  [OUT_OF_SCOPE_GROUP]: "#9aa0ad",
  [PENDING_GROUP]: "#d6dae3",
};

// The opportunity funnel bars: the five roll-up phases + a terminal "Lost" bucket, so
// the bars sum to the total opportunities (§6).
const OPP_PHASE_BARS = [...OPPORTUNITY_PHASES, "Lost"];

export function MetricsTab({
  onNavigate,
  onOpenAccount,
}: {
  onNavigate?: Navigate;
  onOpenAccount?: (org: string) => void;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  // All accepted connections (incl. out-of-scope) — for the Connections/Invitations
  // funnel stages and their matrices.
  const [connections, setConnections] = useState<Contact[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [errorMsg, setErrorMsg] = useState("");

  // Which population the seniority/function breakdowns show.
  const [population, setPopulation] = useState<Population>("full");

  // Funnel totals (top two stages) + the set of contacts actually met (Held meetings).
  const [summary, setSummary] = useState<FunnelSummary | null>(null);
  const [heldUrls, setHeldUrls] = useState<Set<string>>(new Set());
  // Which follow-up action list is showing.
  const [actionTab, setActionTab] = useState<ActionTab>("unmessaged");
  // Which opportunity phase the opportunity breakdowns are filtered to ("all" = every
  // phase). Mirrors the contact `population` toggle, but for the commercial pipeline.
  const [oppPhase, setOppPhase] = useState<"all" | OpportunityPhase | "Lost">("all");
  // Within a selected phase, an optional step to narrow to (the nested second tab row).
  const [oppStep, setOppStep] = useState<"all" | OpportunityStep>("all");

  // Commercial data lives in localStorage (Opportunities + Revenue tabs).
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [meetings, setMeetings] = useState<MeetingsById>({});

  // The current drill-down (null = panel closed).
  const [drill, setDrill] = useState<Drill>(null);

  useEffect(() => {
    setOpps(Object.values(loadAllOpportunities()));
    const savedMeetings = loadAllMeetings();
    setMeetings(savedMeetings);
    setHeldUrls(heldContactUrls(savedMeetings));
    loadFunnelSummary().then(setSummary).catch(() => setSummary(null));
    loadConnections().then(setConnections).catch(() => setConnections([]));
    loadContacts()
      .then((rows) => {
        setContacts(rows);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
  }, []);

  // Fold Held meetings into each contact's `met` flag, so the "Met" population and the
  // funnel's Met stage share ONE effective flag everywhere (csv heuristic ∪ Held).
  const effectiveContacts = useMemo(
    () =>
      contacts.map((c) =>
        !c.met && heldUrls.has(c.url) ? { ...c, met: true } : c,
      ),
    [contacts, heldUrls],
  );

  // Contact-derived metrics (recompute on data / population change). All read the
  // effective-met contacts so every breakdown reconciles with the funnel.
  const funnel = useMemo(
    () =>
      computeFunnelStacked(effectiveContacts, {
        summary,
        connections,
        metUrls: heldUrls,
      }),
    [effectiveContacts, summary, connections, heldUrls],
  );
  const seniority = useMemo(
    () => computeSeniorityBars(effectiveContacts, population),
    [effectiveContacts, population],
  );
  const fn = useMemo(
    () => computeFunctionBars(effectiveContacts, population),
    [effectiveContacts, population],
  );
  const groupSummary = useMemo(
    () => computeGroupSummary(effectiveContacts, population),
    [effectiveContacts, population],
  );

  // Sector groups that actually have contacts (in any funnel stage) — the legend lists
  // only these, so empty industries (and the dead "Out of Scope"/"Pending" segments,
  // which never have contacts) don't clutter it.
  const presentGroups = useMemo(() => {
    const present = new Set<string>();
    for (const stage of funnel)
      for (const seg of stage.segments) if (seg.count > 0) present.add(seg.label);
    return SECTOR_GROUPS.filter((g) => present.has(g));
  }, [funnel]);

  // Follow-up action lists = the gaps between funnel stages. (contacts IS the target
  // pipeline, so "target − messaged" is just the un-messaged contacts, and so on.)
  const notMessaged = useMemo(
    () => contacts.filter((c) => !c.messaged),
    [contacts],
  );
  const awaitingReply = useMemo(
    () => contacts.filter((c) => c.messaged && !c.two_way),
    [contacts],
  );
  // Sector-group breakdowns of those two lists (the third, pending invites, has no
  // sector data so it stays a plain list).
  const notMessagedByGroup = useMemo(
    () => computeGroupSummary(notMessaged, "full"),
    [notMessaged],
  );
  const awaitingReplyByGroup = useMemo(
    () => computeGroupSummary(awaitingReply, "full"),
    [awaitingReply],
  );

  // Commercial metrics.
  const pipeline = useMemo(() => pipelineByPhase(opps), [opps]);
  // The opportunities the breakdowns below show: all of them, or just the selected
  // phase. Every opportunity breakdown reads THIS, so the phase toggle narrows them all
  // together (the analogue of the contact `population` toggle).
  const phaseOpps = useMemo(
    () =>
      oppStep !== "all"
        ? opps.filter((o) => o.current_step === oppStep)
        : oppPhase === "all"
          ? opps
          : opps.filter((o) => opportunityPhase(o) === oppPhase),
    [opps, oppPhase, oppStep],
  );
  // Headline figures for the selected phase: how many, total estimated value, and
  // weighted value (est × probability). Weighted is always derived, never stored (§6).
  const stageStats = useMemo(
    () => ({
      count: phaseOpps.length,
      est: phaseOpps.reduce((s, o) => s + (o.est_value ?? 0), 0),
      weighted: phaseOpps.reduce((s, o) => s + weightedValue(o), 0),
    }),
    [phaseOpps],
  );
  // The three opportunity breakdowns, all over the stage-filtered set, each with count
  // and weighted value. By sector group / function join through the linked contact;
  // by service line is opportunity-native.
  const oppsBySector = useMemo(
    () => opportunitiesBySectorGroup(phaseOpps, contacts, meetings),
    [phaseOpps, contacts, meetings],
  );
  const oppsByFunction = useMemo(
    () => opportunitiesByFunction(phaseOpps, contacts, meetings),
    [phaseOpps, contacts, meetings],
  );
  const oppsByServiceLine = useMemo(
    () => opportunitiesByServiceLine(phaseOpps),
    [phaseOpps],
  );

  // Render one opportunity breakdown as the two-column "By count" / "By weighted value"
  // grid (the same shape used across the dashboard). `color`/`muted` vary per breakdown;
  // every bar drills to exactly the opportunities it counts (§6).
  const oppBreakdownGrid = (
    breakdown: OppGroupBreakdown,
    color: (label: string, i: number) => string,
    muted: (label: string) => boolean,
  ) => {
    const maxCount = Math.max(1, ...breakdown.items.map((x) => x.count));
    const maxWeighted = Math.max(1, ...breakdown.items.map((x) => x.weighted));
    const drillTo = (it: OppGroupBreakdown["items"][number]) =>
      it.count > 0
        ? () =>
            setDrill({
              kind: "opps",
              title: `${it.label} · opportunities`,
              opps: it.opps,
            })
        : undefined;
    return (
      <div className="dash-grid">
        <div>
          <h4 className="mp-sub">By count</h4>
          <div className="bars">
            {breakdown.items.map((it, i) => (
              <BarRow
                key={it.label}
                label={it.label}
                count={it.count}
                max={maxCount}
                color={color(it.label, i)}
                muted={muted(it.label)}
                onClick={drillTo(it)}
              />
            ))}
          </div>
          <ReconcileNote ok={breakdown.sumsToTotal} total={breakdown.total} />
        </div>
        <div>
          <h4 className="mp-sub">By weighted value</h4>
          <div className="bars">
            {breakdown.items.map((it, i) => (
              <BarRow
                key={it.label}
                label={it.label}
                count={it.weighted}
                max={maxWeighted}
                valueLabel={formatMoney(it.weighted)}
                color={color(it.label, i)}
                muted={muted(it.label)}
                onClick={drillTo(it)}
              />
            ))}
          </div>
        </div>
      </div>
    );
  };

  if (status === "loading") {
    return <p className="dash-status">Loading dashboard…</p>;
  }
  if (status === "error") {
    return (
      <div className="dash-status dash-status--error">
        <p>Couldn’t load the dashboard data.</p>
        <p className="dash-error-detail">{errorMsg}</p>
      </div>
    );
  }

  // ── Drill-down handlers ─────────────────────────────────────────────────
  // A sector-group matrix (rows = entities within the group, columns = seniority), in
  // the slide-in panel. Pre-filters the source to the group + population. General
  // Open a contact from a drill list. The networking funnel is about people, so most
  // lists go to the Contacts tab (the specific contact, list filtered to them). But a
  // contact who has AGREED TO MEET has a meeting record, so for them the more useful
  // destination is that meeting on the Meetings tab (their first meeting / seed).
  const openContactOrMeeting = (c: Contact) => {
    if (!onNavigate) return;
    const name = `${c.first} ${c.last}`.trim();
    if (c.agreed_to_meet) {
      onNavigate("meetings", { search: name, openId: meetingId(c.url, 1) });
    } else {
      onNavigate("contacts", { search: name, openId: c.url });
    }
  };

  // Corporates / Out of Scope use the company name as the entity; other groups use the
  // Target_FS bucket (sector_detail), matching the report.
  const openSectorMatrix = (
    source: Contact[],
    population: Population,
    group: string,
    title: string,
  ) => {
    const rows = source.filter(
      (c) => c.sector_group === group && inPopulation(c, population),
    );
    const entity =
      group === "General Corporates" || group === OUT_OF_SCOPE_GROUP
        ? "organisation"
        : "sector_detail";
    setDrill({
      kind: "matrix",
      rows,
      entity,
      columns: "seniority",
      label: title,
      title,
      display: "panel",
    });
  };

  // A seniority bar fixes the seniority, so the informative matrix is org × FUNCTION —
  // shown in a wide modal (functions make many columns). Empty function columns dropped.
  const openSeniorityMatrix = (seniority: string) => {
    const rows = effectiveContacts.filter(
      (c) => inPopulation(c, population) && c.seniority === seniority,
    );
    const label = `${activePopulationLabel} · ${seniority}`;
    setDrill({
      kind: "matrix",
      rows,
      entity: "organisation",
      columns: "function",
      label,
      title: `Seniority · ${seniority} (${activePopulationLabel})`,
      display: "modal",
      dropEmptyColumns: true,
    });
  };

  // A function bar fixes the function, so org × SENIORITY (the usual shape) in the panel.
  const openFunctionMatrix = (fn: string) => {
    const rows = effectiveContacts.filter(
      (c) => inPopulation(c, population) && (c.function || "Other Functions") === fn,
    );
    const label = `${activePopulationLabel} · ${fn}`;
    setDrill({
      kind: "matrix",
      rows,
      entity: "organisation",
      columns: "seniority",
      label,
      title: `Function · ${fn} (${activePopulationLabel})`,
      display: "panel",
    });
  };

  // Each funnel segment opens that group's detailed matrix, built from the right source:
  // Invitations/Connections from the full connections set; Target→Met from the target
  // contacts at the matching population. The "Pending" invitations segment has no
  // profiles, so it opens the name list instead.
  const onFunnelSegment = (stage: FunnelStage, group: string) => {
    const title = `${stage.label} · ${group}`;
    switch (stage.label) {
      case "Your network":
        openSectorMatrix(effectiveContacts, "full", group, title);
        break;
      case "Messaged":
        openSectorMatrix(effectiveContacts, "messaged", group, title);
        break;
      case "Responded":
        openSectorMatrix(effectiveContacts, "twoWay", group, title);
        break;
      case "Agreed to meet":
        openSectorMatrix(effectiveContacts, "agreed", group, title);
        break;
      case "Met":
        openSectorMatrix(effectiveContacts, "met", group, title);
        break;
    }
  };

  const funnelMax = funnel[0]?.count ?? 0; // largest stage scales the bars
  const activePopulationLabel =
    POPULATIONS.find((p) => p.id === population)?.label ?? "";

  return (
    <section className="dash">
      <div className="dash-toolbar">
        <h2>Dashboard</h2>
        <span className="dash-count">{contacts.length} contacts</span>
      </div>

      {/* ── Networking funnel, stacked by sector group (§4, EY report) ───── */}
      <div className="dash-card" data-tour="met-funnel">
        <h3>Networking funnel by segment</h3>
        <p className="dash-card-note">
          Each stage is a nested subset of the one above it: Met ⊆ Agreed ⊆ Responded ⊆
          Messaged ⊆ Your network. Bars are stacked by sector group and the % is of your
          whole network. Click a Responded or Agreed segment for its detailed matrix; click
          another segment to list those contacts.
        </p>

        <Legend groups={presentGroups} />

        <div className="stack">
          {funnel.map((stage) => (
            <StackedBarRow
              key={stage.label}
              label={stage.label}
              total={stage.count}
              max={funnelMax}
              // % of target only from Target pipeline down; Invitations/Connections
              // show the count alone (no caption text).
              pct={stage.pctOfTarget ?? undefined}
              segments={stage.segments.map((s) => ({
                label: s.label,
                count: s.count,
                color: SEGMENT_COLORS[s.label] ?? "#c2c6d2",
              }))}
              onSegmentClick={(group) => onFunnelSegment(stage, group)}
            />
          ))}
        </div>
      </div>

      {/* ── Population toggle (drives seniority, function AND market penetration) ── */}
      <div className="dash-pop">
        <span className="dash-pop-label">Breakdowns show:</span>
        {POPULATIONS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={
              population === p.id
                ? "dash-pop-btn dash-pop-btn--active"
                : "dash-pop-btn"
            }
            onClick={() => setPopulation(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="dash-grid" data-tour="met-segments">
        <BarChartCard
          title={`Seniority · ${activePopulationLabel}`}
          breakdown={seniority}
          onPick={(label) => openSeniorityMatrix(label)}
        />
        <BarChartCard
          title={`Function · ${activePopulationLabel}`}
          breakdown={fn}
          highlightOther
          onPick={(label) => openFunctionMatrix(label)}
        />
      </div>

      {/* ── Market Penetration Summary → opens the detailed matrices ─────── */}
      <div className="dash-card" data-tour="met-penetration">
        <h3>Market penetration summary</h3>
        <p className="dash-card-note">
          Contacts by sector group for the population selected above. Click any bar to
          open that group’s detailed pipeline matrix (entity × seniority), then click a
          number to see the people.
        </p>
        <BarChartCard
          title={`By sector group · ${activePopulationLabel}`}
          breakdown={groupSummary}
          colorByGroup
          onPick={(group) =>
            openSectorMatrix(
              effectiveContacts,
              population,
              group,
              `${activePopulationLabel} · ${group}`,
            )
          }
        />
      </div>

      {/* ── Follow-up actions: the gaps between funnel stages ─────────────── */}
      <div className="dash-card" data-tour="met-followups">
        <h3>Follow-up actions</h3>
        <p className="dash-card-note">
          Who to act on next, taken from the gaps between consecutive funnel stages.
          Each list’s count reconciles to a funnel difference.
        </p>
        <div className="dash-pop">
          {ACTION_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={
                actionTab === t.id
                  ? "dash-pop-btn dash-pop-btn--active"
                  : "dash-pop-btn"
              }
              onClick={() => setActionTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {actionTab === "unmessaged" && (
          <ActionListWrap
            count={notMessaged.length}
            caption="Connected but not yet messaged — your move. (= Target pipeline − Messaged)"
            chart={
              <BarChartCard
                title="By sector group"
                breakdown={notMessagedByGroup}
                colorByGroup
                onPick={(group) =>
                  openSectorMatrix(
                    notMessaged,
                    "full",
                    group,
                    `Not yet messaged · ${group}`,
                  )
                }
              />
            }
          >
            <ContactList
              contacts={notMessaged}
              onOpenAccount={onOpenAccount}
              onOpen={openContactOrMeeting}
            />
          </ActionListWrap>
        )}
        {actionTab === "noreply" && (
          <ActionListWrap
            count={awaitingReply.length}
            caption="Messaged, no reply yet — worth a follow-up. (= Messaged − Responded)"
            chart={
              <BarChartCard
                title="By sector group"
                breakdown={awaitingReplyByGroup}
                colorByGroup
                onPick={(group) =>
                  openSectorMatrix(
                    awaitingReply,
                    "full",
                    group,
                    `Awaiting reply · ${group}`,
                  )
                }
              />
            }
          >
            <ContactList
              contacts={awaitingReply}
              onOpenAccount={onOpenAccount}
              onOpen={openContactOrMeeting}
            />
          </ActionListWrap>
        )}
      </div>


      <div className="dash-grid">
        <div className="dash-card" data-tour="met-opp-phase">
          <h3>Opportunity funnel (by phase)</h3>
          <p className="dash-card-note">
            A snapshot: how many opportunities sit in each phase now. Click a phase to
            list them. Bars sum to the total opportunities.
          </p>
          <div className="bars">
            {OPP_PHASE_BARS.map((phase, i) => {
              const inPhase = opportunitiesForPhase(opps, phase);
              return (
                <BarRow
                  key={phase}
                  label={phase}
                  count={inPhase.length}
                  max={Math.max(
                    1,
                    ...OPP_PHASE_BARS.map(
                      (p) => opportunitiesForPhase(opps, p).length,
                    ),
                  )}
                  color={rampColor(i, OPP_PHASE_BARS.length)}
                  onClick={
                    inPhase.length > 0
                      ? () =>
                          setDrill({
                            kind: "opps",
                            title: `Pipeline · ${phase}`,
                            opps: inPhase,
                          })
                      : undefined
                  }
                />
              );
            })}
          </div>
          <ReconcileNote
            ok={pipeline.sumsToTotal}
            total={pipeline.total}
          />
        </div>
      </div>

      {/* ── Opportunity breakdowns (phase-filtered, like the contact population tabs) ── */}
      <div className="dash-card" data-tour="met-opp-breakdowns">
        <h3>Opportunity breakdowns</h3>
        <p className="dash-card-note">
          Slice the open opportunities by service line, sector group, and the buyer’s
          function. Sector group and function come from each opportunity’s linked contact
          (“Unassigned” = no linked contact yet); service line is set on the opportunity.
          Use the tabs to focus on one pipeline phase. Click any bar to list those
          opportunities.
        </p>

        {/* Phase filter — the commercial analogue of the contact "Breakdowns show:" tabs.
            Changing the phase resets the nested step filter. */}
        <div className="dash-pop">
          <span className="dash-pop-label">Phase:</span>
          {(["all", ...OPPORTUNITY_PHASES, "Lost"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={
                oppPhase === s
                  ? "dash-pop-btn dash-pop-btn--active"
                  : "dash-pop-btn"
              }
              onClick={() => {
                setOppPhase(s);
                setOppStep("all");
              }}
            >
              {s === "all" ? "All" : s}
            </button>
          ))}
        </div>

        {/* Nested step filter — the steps within the selected phase (a real phase only). */}
        {oppPhase !== "all" && oppPhase !== "Lost" && (
          <div className="dash-pop dash-pop--nested">
            <span className="dash-pop-label">Step:</span>
            {(["all", ...stepsByPhase(oppPhase).map((s) => s.id)] as const).map(
              (id) => {
                const label =
                  id === "all"
                    ? "All"
                    : stepsByPhase(oppPhase).find((s) => s.id === id)?.short ?? id;
                return (
                  <button
                    key={id}
                    type="button"
                    className={
                      oppStep === id
                        ? "dash-pop-btn dash-pop-btn--active"
                        : "dash-pop-btn"
                    }
                    onClick={() => setOppStep(id as "all" | OpportunityStep)}
                  >
                    {label}
                  </button>
                );
              },
            )}
          </div>
        )}

        {/* Headline figures for the selected stage. */}
        <div className="dash-stats">
          <div className="dash-stat">
            <span className="dash-stat-value">{stageStats.count}</span>
            <span className="dash-stat-label">Opportunities</span>
          </div>
          <div className="dash-stat">
            <span className="dash-stat-value">{formatMoney(stageStats.est)}</span>
            <span className="dash-stat-label">Estimated value</span>
          </div>
          <div className="dash-stat">
            <span className="dash-stat-value">{formatMoney(stageStats.weighted)}</span>
            <span className="dash-stat-label">Weighted value</span>
          </div>
        </div>

        {stageStats.count === 0 ? (
          <p className="dash-card-note">
            No opportunities {oppPhase === "all" ? "yet" : `in the “${oppPhase}” phase`}.
          </p>
        ) : (
          <>
            <h4 className="mp-sub">By service line</h4>
            {oppBreakdownGrid(
              oppsByServiceLine,
              (_label, i) => rampColor(i, oppsByServiceLine.items.length),
              () => false,
            )}

            <h4 className="mp-sub">By sector group</h4>
            {oppBreakdownGrid(
              oppsBySector,
              (label) => SECTOR_GROUP_COLORS[label],
              (label) => label === UNASSIGNED_GROUP,
            )}

            <h4 className="mp-sub">By function</h4>
            {oppBreakdownGrid(
              oppsByFunction,
              (_label, i) => rampColor(i, oppsByFunction.items.length),
              (label) => label === OTHER_FUNCTIONS || label === UNASSIGNED_GROUP,
            )}
          </>
        )}
      </div>

      {/* ── The drill-down panel ─────────────────────────────────────────── */}
      {drill && (
        <DrillPanelContent
          drill={drill}
          onClose={() => setDrill(null)}
          onDrill={setDrill}
          onNavigate={onNavigate}
          onOpenAccount={onOpenAccount}
          onOpenContact={openContactOrMeeting}
        />
      )}
    </section>
  );
}

// ── Sector-group colour legend ──────────────────────────────────────────────
// Lists ONLY the sector groups present in the data (passed in), so empty industries
// don't clutter it. (The old "Out of Scope"/"Pending" BD-CRM segments are gone.)
function Legend({ groups }: { groups: readonly string[] }) {
  return (
    <div className="dash-legend">
      {groups.map((group) => (
        <span className="dash-legend-item" key={group}>
          <span
            className="dash-legend-swatch"
            style={{ background: SEGMENT_COLORS[group] }}
          />
          {group}
        </span>
      ))}
    </div>
  );
}

// ── A plain bar-chart card (seniority / function / summary) ─────────────────
// `colorByGroup` colours each bar by its sector group (summary charts); otherwise
// bars use the EY ramp. `highlightOther` mutes the "Other Functions" catch-all
// (§6 rule 3). Every bar is clickable via onPick(label, contacts).
function BarChartCard({
  title,
  breakdown,
  highlightOther = false,
  colorByGroup = false,
  onPick,
}: {
  title: string;
  breakdown: CategoryBreakdown;
  highlightOther?: boolean;
  colorByGroup?: boolean;
  onPick: (label: string, contacts: Contact[]) => void;
}) {
  const max = breakdown.items.reduce(
    (m, it) => Math.max(m, it.contacts.length),
    0,
  );
  const n = breakdown.items.length;

  return (
    <div className="dash-card">
      <h3>{title}</h3>
      <div className="bars">
        {breakdown.items.map((item, i) => (
          <BarRow
            key={item.label}
            label={item.label}
            count={item.contacts.length}
            max={max}
            color={
              colorByGroup
                ? SECTOR_GROUP_COLORS[item.label]
                : rampColor(i, n)
            }
            muted={highlightOther && item.label === OTHER_FUNCTIONS}
            onClick={
              item.contacts.length > 0
                ? () => onPick(item.label, item.contacts)
                : undefined
            }
          />
        ))}
      </div>
      <ReconcileNote ok={breakdown.sumsToTotal} total={breakdown.total} />
    </div>
  );
}

// Wraps a follow-up action list with its reconcile caption (count = a funnel delta)
// and a scrollable container, plus an empty-state message.
function ActionListWrap({
  count,
  caption,
  chart,
  children,
}: {
  count: number;
  caption: string;
  chart?: ReactNode; // optional by-sector bar chart shown above the (scrolling) list
  children: ReactNode;
}) {
  // The full people list is collapsed by default behind a "Show list" toggle, so the
  // chart leads and the (long) list only appears on demand.
  const [showList, setShowList] = useState(false);
  return (
    <>
      <p className="dash-reconcile dash-reconcile--ok">
        {count} · {caption}
      </p>
      {count === 0 ? (
        <p className="dash-card-note">Nothing here right now — all caught up.</p>
      ) : (
        <>
          {chart}
          <button
            type="button"
            className="action-toggle"
            aria-expanded={showList}
            onClick={() => setShowList((v) => !v)}
          >
            {showList ? "Hide list ▴" : `Show list (${count}) ▾`}
          </button>
          {showList && <div className="action-scroll">{children}</div>}
        </>
      )}
    </>
  );
}

// The "Not yet connected" list: people we invited who haven't accepted. We only have
// The §6 rule 2/5 self-check, shown so a broken total is visible not papered over.
function ReconcileNote({ ok, total }: { ok: boolean; total: number }) {
  return (
    <p
      className={
        ok
          ? "dash-reconcile dash-reconcile--ok"
          : "dash-reconcile dash-reconcile--bad"
      }
    >
      {ok ? `✓ sums to ${total}` : `⚠ does not sum to ${total} — data issue`}
    </p>
  );
}

// Renders the right content inside the slide-in panel for the current drill state.
function DrillPanelContent({
  drill,
  onClose,
  onDrill,
  onNavigate,
  onOpenAccount,
  onOpenContact,
}: {
  drill: NonNullable<Drill>;
  onClose: () => void;
  onDrill: (d: Drill) => void;
  onNavigate?: Navigate;
  onOpenAccount?: (org: string) => void;
  onOpenContact?: (c: Contact) => void;
}) {
  if (drill.kind === "matrix") {
    const matrix = computeMatrix(drill.rows, {
      entity: drill.entity,
      columns: drill.columns,
      label: drill.label,
      dropEmptyColumns: drill.dropEmptyColumns,
    });
    const Shell = drill.display === "modal" ? Modal : DrillPanel;
    return (
      <Shell
        title={drill.title}
        subtitle={`${matrix.grandTotal.length} contacts · ${matrix.entityCount} ${
          matrix.entityCount === 1 ? "entity" : "entities"
        } · click any number for the contacts`}
        onClose={onClose}
      >
        <PipelineMatrix
          matrix={matrix}
          // A number opens its contacts in the SAME container (modal stays a modal).
          onPick={(title, cs) =>
            onDrill({
              kind: "contacts",
              title,
              contacts: cs,
              back: drill,
              display: drill.display,
            })
          }
        />
      </Shell>
    );
  }


  if (drill.kind === "opps") {
    return (
      <DrillPanel
        title={drill.title}
        subtitle={`${drill.opps.length} opportunit${
          drill.opps.length === 1 ? "y" : "ies"
        }`}
        onClose={onClose}
      >
        <OpportunityList
          opps={drill.opps}
          onOpenAccount={onOpenAccount}
          onOpenOpportunity={
            onNavigate
              ? (id) => {
                  // Jump to the Opportunities tab (filters the list + opens the form);
                  // close the drill on the way since we're leaving the Metrics tab.
                  onNavigate("opportunities", { openId: id });
                  onClose();
                }
              : undefined
          }
        />
      </DrillPanel>
    );
  }

  // contacts — rendered in the same container the parent matrix used (modal or panel).
  const Shell = drill.display === "modal" ? Modal : DrillPanel;
  return (
    <Shell
      title={drill.title}
      subtitle={`${drill.contacts.length} contact${
        drill.contacts.length === 1 ? "" : "s"
      }`}
      onClose={onClose}
      onBack={drill.back ? () => onDrill(drill.back!) : undefined}
    >
      <ContactList
        contacts={drill.contacts}
        onOpenAccount={onOpenAccount}
        onOpen={onOpenContact}
      />
    </Shell>
  );
}
