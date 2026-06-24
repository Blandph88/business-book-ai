// Dashboard metrics — the single place where all the dashboard numbers are
// computed from the contacts (CLAUDE.md §4 dashboard, §6 reconciliation rules).
//
// WHY a separate module: keeping every count in one pure function (Contacts in,
// numbers out) means the reconciliation rules live in ONE readable place, the tab
// component stays about rendering, and the maths can be checked by eye.
//
// THE KEY DESIGN RULE for the interactive dashboard: every function here returns
// not just a count but the ACTUAL Contact[] behind it. The dashboard shows
// `array.length` and, when the owner clicks, opens that very same array. Count and
// drill-down list therefore come from one source and can never disagree — which is
// exactly §6 rule 5 ("if a number can't be reconciled to the data, that's a bug").
//
// The funnel and breakdowns are NESTED populations of the same contacts:
//
//   Target (everyone)
//     ⊇ Messaged (messaged = true)
//       ⊇ Responded (two_way = true)        ← see note below on "Responded"
//         ⊇ Agreed to meet (agreed_to_meet = true)
//
// NOTE on "Responded": the brief's funnel labels stage 3 "Responded", and the
// data has both a `responded` flag and a tighter `two_way` flag. By the owner's
// decision the dashboard treats a genuine TWO-WAY exchange as "Responded", so the
// Responded stage and all of its breakdowns use `two_way`.

import type { Contact } from "./contacts";
import type { FunnelSummary } from "./funnel";
import { SENIORITY, SECTOR_GROUPS, OTHER_FUNCTIONS } from "./vocab";

// ── The populations the dashboard breaks contacts down by ────────────────────
// These mirror the funnel stages worth analysing: the whole target pipeline, those
// who responded, those who agreed to meet, and those actually met. (Invitations and
// Messaged are deliberately not here — they're "pending with me", not worth a
// seniority/function/sector split.) One selector drives every breakdown.
export type Population = "full" | "messaged" | "twoWay" | "agreed" | "met";

// Does a contact belong to a given population? (full = everyone in the passed set —
// the whole target pipeline, or any subset the caller pre-filtered, e.g. a follow-up
// action list.) "met" reads the contact's EFFECTIVE met flag — the caller folds Held
// meetings into `contact.met` (see MetricsTab) so this stays a pure predicate.
export function inPopulation(contact: Contact, population: Population): boolean {
  switch (population) {
    case "full":
      return true;
    case "messaged":
      return contact.messaged;
    case "twoWay":
      return contact.two_way;
    case "agreed":
      return contact.agreed_to_meet;
    case "met":
      return contact.met;
  }
}

// ── Generic count-only breakdown (still used for the OPPORTUNITY pipeline) ────
// The opportunity pipeline-by-stage chart counts opportunities, not contacts, so it
// keeps this simpler shape (see ./opportunities.ts pipelineByStage).
export type BreakdownItem = { label: string; count: number };
export type Breakdown = {
  items: BreakdownItem[];
  total: number;
  sumsToTotal: boolean;
};

// ── Building block: a labelled set of contacts ───────────────────────────────
// One bar / one segment / one matrix cell — a label plus the exact people in it.
export type ContactSet = { label: string; contacts: Contact[] };

// ── Stacked funnel ───────────────────────────────────────────────────────────
// Each stage is a nested subset of contacts, split into sector-group segments
// (matching the EY report's "Networking Funnel by Segment"). Every segment carries
// its contacts so a click drills straight in.
// One stacked segment: a label, an explicit count, and the contacts behind it ([] when
// we only have a count, e.g. the "Pending" invitations whose profiles we don't have).
export type FunnelSegment = { label: string; count: number; contacts: Contact[] };

export type FunnelStage = {
  label: string;
  contacts: Contact[]; // everyone in this stage ([] for the count-only Pending part)
  segments: FunnelSegment[]; // stacked sub-bars (sector groups, + Out of Scope / Pending)
  count: number;
  // % of the Target pipeline, for the Target→Met stages; null for Invitations/
  // Connections (which sit ABOVE target, so a "% of target" would be meaningless and
  // the owner asked for no caption there — count only).
  pctOfTarget: number | null;
};

// Special segment labels for the two top stages (no real sector group).
export const OUT_OF_SCOPE_GROUP = "Out of Scope"; // accepted, but a consultancy peer
export const PENDING_GROUP = "Pending"; // invited, not yet accepted (no profile data)

// Split a set of contacts into segments over a fixed label list (matched on
// sector_group). Empty groups are kept (count 0) so segments always sum to the whole
// (§6 rule 2).
function segmentsByGroup(rows: Contact[], labels: readonly string[]): FunnelSegment[] {
  return labels.map((label) => {
    const cs = rows.filter((c) => c.sector_group === label);
    return { label, count: cs.length, contacts: cs };
  });
}

// Build the nested funnel stages (§4/§6): Invitations → Connections → Target pipeline →
// Messaged → Responded → Agreed to meet → Met.
//
//   • Connections is stacked by the five sector groups + "Out of Scope" (consultancies);
//     Invitations adds a "Pending" segment for invites not yet accepted (count only — we
//     have no sector for them). Both come from the `connections` array + `pendingCount`.
//     Without that data we fall back to single count-only bars from the summary.
//   • Target → Met are segmented by the five sector groups; % is of the Target pipeline.
//   • Met = agreed contacts with a Held meeting (metUrls). Manual only — intersected with
//     `agreed` so Met ⊆ Agreed always holds (§6).
export function computeFunnelStacked(
  contacts: Contact[],
  opts?: {
    summary?: FunnelSummary | null;
    metUrls?: Set<string>;
    connections?: Contact[];
    pendingCount?: number;
  },
): FunnelStage[] {
  const metUrls = opts?.metUrls ?? new Set<string>();

  const target = contacts;
  const messaged = contacts.filter((c) => c.messaged);
  const responded = contacts.filter((c) => c.two_way); // "Responded" = two-way
  const agreed = contacts.filter((c) => c.agreed_to_meet);
  // Met = agreed contacts who have either the pipeline `met` heuristic OR a Held meeting
  // (metUrls). Unioning both keeps this in lock-step with the breakdowns, which count
  // `c.met` (MetricsTab folds Held meetings into it via effectiveContacts). Intersected
  // with `agreed` so Met ⊆ Agreed always holds (§6).
  const met = agreed.filter((c) => c.met || metUrls.has(c.url));

  const targetTotal = target.length;
  const pct = (n: number) =>
    targetTotal === 0 ? 0 : Math.round((n / targetTotal) * 100);

  const segStage = (label: string, rows: Contact[]): FunnelStage => ({
    label,
    contacts: rows,
    segments: segmentsByGroup(rows, SECTOR_GROUPS),
    count: rows.length,
    pctOfTarget: pct(rows.length),
  });

  // Contacts-first funnel: your WHOLE network is the base (no Invitations stage — we don't ask
  // for the invitations export). Progress is assessed from message activity (messaged/responded)
  // and meetings (agreed/met).
  return [
    segStage("Your network", target),
    segStage("Messaged", messaged),
    segStage("Responded", responded),
    segStage("Agreed to meet", agreed),
    segStage("Met", met),
  ];
}

// ── Plain category breakdowns (carry contacts) ───────────────────────────────
// One bar = a category and the exact contacts of the chosen population in it.
export type CategoryBreakdown = {
  items: ContactSet[];
  total: number;
  sumsToTotal: boolean;
};

// Count a population by a category accessor over a FIXED label list, so empty
// categories show a 0 bar and the bars sum to the population total (§6 rule 2).
function breakdownByCategory(
  contacts: Contact[],
  population: Population,
  categories: readonly string[],
  getCategory: (c: Contact) => string,
): CategoryBreakdown {
  const rows = contacts.filter((c) => inPopulation(c, population));
  const items = categories.map((label) => ({
    label,
    contacts: rows.filter((c) => getCategory(c) === label),
  }));
  const summed = items.reduce((acc, it) => acc + it.contacts.length, 0);
  return { items, total: rows.length, sumsToTotal: summed === rows.length };
}

// Seniority breakdown for one population, in the fixed §5 order.
export function computeSeniorityBars(
  contacts: Contact[],
  population: Population,
): CategoryBreakdown {
  return breakdownByCategory(contacts, population, SENIORITY, (c) => c.seniority);
}

// Function breakdown. Functions are NOT a fixed list, and "Other Functions" must be
// de-emphasised — placed LAST regardless of size (§6 rule 3). So we discover the
// categories from the data, sort real functions by count desc (a real function
// always leads), and pin "Other Functions" to the very end.
export function computeFunctionBars(
  contacts: Contact[],
  population: Population,
): CategoryBreakdown {
  const rows = contacts.filter((c) => inPopulation(c, population));

  const byFn = new Map<string, Contact[]>();
  for (const c of rows) {
    const fn = c.function || OTHER_FUNCTIONS; // empty → the catch-all
    (byFn.get(fn) ?? byFn.set(fn, []).get(fn)!).push(c);
  }

  const items = [...byFn.entries()].map(([label, cs]) => ({
    label,
    contacts: cs,
  }));

  items.sort((a, b) => {
    if (a.label === OTHER_FUNCTIONS) return 1;
    if (b.label === OTHER_FUNCTIONS) return -1;
    if (b.contacts.length !== a.contacts.length)
      return b.contacts.length - a.contacts.length;
    return a.label.localeCompare(b.label);
  });

  const summed = items.reduce((acc, it) => acc + it.contacts.length, 0);
  return { items, total: rows.length, sumsToTotal: summed === rows.length };
}

// ── Market Penetration Summary (§5 of the report) ────────────────────────────
// Contacts per sector group for the chosen population. These bars are the ENTRY
// POINTS to the detailed matrices (clicking one opens the matrix for that group +
// population).
export function computeGroupSummary(
  contacts: Contact[],
  population: Population,
): CategoryBreakdown {
  const rows = contacts.filter((c) => inPopulation(c, population));
  const all = SECTOR_GROUPS.map((group) => ({
    label: group,
    contacts: rows.filter((c) => c.sector_group === group),
  }));
  const summed = all.reduce((acc, it) => acc + it.contacts.length, 0);
  // Only surface groups that actually have contacts — empty industries are dropped so
  // they don't show as zero-length bars / entry points to empty matrices.
  const items = all.filter((it) => it.contacts.length > 0);
  return { items, total: rows.length, sumsToTotal: summed === rows.length };
}

// ── Detailed pipeline matrix (the report's back-section tables) ───────────────
// Rows = entities, columns = the five seniorities, cells = contacts. Plus a Total
// column (per row) and a Total row (per column) and a grand total — all as the
// actual contact arrays, so every number in the rendered table is clickable and
// reconciles by construction.
export type MatrixRow = {
  label: string;
  cells: Contact[][]; // indexed by column (colLabels order)
  total: Contact[];
  subGroup: string; // the band this row belongs to (sub_group; = sector_group if none)
};
// A band of rows sharing one sub_group (e.g. all the Digital Banks), with its own
// reconciling subtotals. Each row is in exactly one section, so section subtotals sum
// to the grand total (§6 rule 2).
export type MatrixSection = {
  label: string;
  rows: MatrixRow[];
  colTotals: Contact[][]; // subtotal per column, over this section's rows
  total: Contact[]; // section grand subtotal
};
export type PipelineMatrix = {
  label: string; // prefix for cell drill titles (e.g. "Target Pipeline · Banks")
  colLabels: readonly string[]; // the column dimension (seniorities or functions)
  rows: MatrixRow[];
  sections: MatrixSection[]; // rows grouped into sub-group bands (1 band = no sectioning)
  colTotals: Contact[][]; // indexed by column
  grandTotal: Contact[];
  entityCount: number; // distinct entities (every one is shown)
};

// Which dimension forms the matrix COLUMNS. Rows are always an entity (org or the
// Target_FS sector_detail bucket).
export type MatrixColumns = "seniority" | "function";

// sector_detail buckets that are CATCH-ALLS grouping genuinely distinct organisations
// (Other Banks holds ~40 different foreign banks, etc.). In a detailed matrix these are
// exploded to one row PER ORGANISATION so each row is a single company. Brand buckets
// like "SNB" / "HSBC" / "Al Rajhi" are NOT here: they only merge spelling variants of
// one company, so they stay a single consolidated row. Reconciliation (§6) is unaffected
// either way — every contact still maps to exactly one row, so column/grand totals match
// the chart bar the matrix was opened from. Edit this set to taste.
const CATCHALL_SECTOR_DETAILS = new Set([
  "Other Banks",
  "Other Fintech & Payments Orgs",
  "Other Capital & Finance",
  "Other Dev Funds",
  "Other Gov Entities",
  "Insurance Sector",
  "KSA Capital & Finance",
  "Vision Invest / State Street", // bundles unrelated firms (Vision Invest, State Street, TASARU)
]);

// Build a detailed matrix from an ALREADY-FILTERED set of contacts (the caller filters
// by group / population / seniority / function). §6 self-consistent: every total is a
// union of the cells it sums, so each printed number reconciles and is clickable.
//
//   entity   — row dimension: company name ("organisation"), or the Target_FS bucket
//              ("sector_detail", used within a sector group like the report).
//   columns  — "seniority" (the fixed five) or "function" (derived from the data, busiest
//              first, "Other Functions" last). Used when the clicked bar already fixes
//              one dimension (e.g. a seniority bar → columns become functions).
export function computeMatrix(
  rows: Contact[],
  opts: {
    entity: "organisation" | "sector_detail";
    columns: MatrixColumns;
    label: string;
    dropEmptyColumns?: boolean;
  },
): PipelineMatrix {
  const rowOf = (c: Contact) => {
    if (opts.entity === "organisation") return c.organisation || "Unknown";
    // sector_detail rows: keep brand buckets (SNB, HSBC…) consolidated, but explode the
    // catch-all buckets to the underlying organisation so each row is one real company.
    const detail = c.sector_detail || "Unknown";
    return CATCHALL_SECTOR_DETAILS.has(detail)
      ? c.organisation || detail
      : detail;
  };
  const colOf = (c: Contact) =>
    opts.columns === "seniority" ? c.seniority : c.function || OTHER_FUNCTIONS;

  // Column labels. Seniority is the fixed §5 order; functions are discovered from the
  // data (busiest first, the "Other Functions" catch-all pinned last — §6 rule 3).
  let colLabels: string[];
  if (opts.columns === "seniority") {
    colLabels = [...SENIORITY];
  } else {
    const counts = new Map<string, number>();
    for (const c of rows) {
      const k = colOf(c);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    colLabels = [...counts.keys()].sort((a, b) => {
      if (a === OTHER_FUNCTIONS) return 1;
      if (b === OTHER_FUNCTIONS) return -1;
      return (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b);
    });
  }
  if (opts.dropEmptyColumns) {
    colLabels = colLabels.filter((label) => rows.some((c) => colOf(c) === label));
  }

  // entity → contacts
  const byEntity = new Map<string, Contact[]>();
  for (const c of rows) {
    const key = rowOf(c);
    (byEntity.get(key) ?? byEntity.set(key, []).get(key)!).push(c);
  }

  // Build a row per entity, sorted by total desc (every entity is shown — no cap —
  // so the table's totals reconcile to the chart bar it was opened from). Each row's
  // band is its contacts' sub_group, which is uniform within a row (sub_group is a
  // function of org/sector_detail, and catch-all buckets are exploded to org rows).
  const allRows: MatrixRow[] = [...byEntity.entries()]
    .map(([label, cs]) => ({
      label,
      cells: colLabels.map((col) => cs.filter((c) => colOf(c) === col)),
      total: cs,
      subGroup: cs[0]?.sub_group || cs[0]?.sector_group || "",
    }))
    .sort((a, b) => b.total.length - a.total.length || a.label.localeCompare(b.label));

  // Column totals and grand total are unions over all rows (so the printed table
  // reconciles: Total row = sum of the rows above it = the originating chart total).
  const colTotals = colLabels.map((_c, col) =>
    allRows.flatMap((r) => r.cells[col]),
  );
  const grandTotal = allRows.flatMap((r) => r.total);

  // Group the rows into sub-group bands (preserving the desc order within each), then
  // order the bands by size desc. One band → the renderer shows no section headers.
  const bandOrder = [...new Set(allRows.map((r) => r.subGroup))];
  const sections: MatrixSection[] = bandOrder
    .map((band) => {
      const bandRows = allRows.filter((r) => r.subGroup === band);
      return {
        label: band,
        rows: bandRows,
        colTotals: colLabels.map((_c, col) =>
          bandRows.flatMap((r) => r.cells[col]),
        ),
        total: bandRows.flatMap((r) => r.total),
      };
    })
    .sort((a, b) => b.total.length - a.total.length);

  return {
    label: opts.label,
    colLabels,
    rows: allRows,
    sections,
    colTotals,
    grandTotal,
    entityCount: allRows.length,
  };
}
