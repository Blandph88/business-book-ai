// Fixed vocabularies for the owner-maintained dropdown columns (CLAUDE.md §4/§5).
//
// These live in one shared module so every tab uses the SAME spelling and order.
// Clean categorical values are what make the dashboard reconcile later, so the
// rule is: never type these strings inline in a component — import them from here.

// ── Pipeline categorical vocabularies (CLAUDE.md §5) ─────────────────────────
// These describe the READ-ONLY pipeline columns, not owner edits. The Dashboard
// iterates these fixed lists when building breakdowns, so that:
//   - the categories appear in a stable, meaningful order (not data order), and
//   - a category with zero rows still shows a 0 bar, and every breakdown therefore
//     SUMS to its stage total by construction (CLAUDE.md §6 rule 2).

// Seniority, most senior → most junior (CLAUDE.md §5, kept in this exact order).
export const SENIORITY = [
  "Executive Leadership",
  "Head of / Director",
  "VP / SM",
  "Manager",
  "Associate / Analyst",
] as const;

// The top-level sector axis = the supported INDUSTRIES (see config/markets.ts), plus an
// "Other Industries" catch-all for anything the classifier couldn't place. These MUST match
// the classifier's output (config/markets.ts INDUSTRY_LABEL + OTHER_INDUSTRY_LABEL) byte-for-
// byte, or a row would fall outside every bucket and its breakdown would silently fail to sum
// to its total. A consultant's network spans industries, so this axis is fixed (the user's
// industry pick seeds the demo + service-line defaults instead of switching this axis).
export const SECTOR_GROUPS = [
  "Financial Services",
  "Technology",
  "Healthcare & Pharma",
  "Energy & Industrial",
  "Consumer & Retail",
  "Public Sector",
  "Professional Services",
  "Real Estate",
  "Independent / Self-employed",
  "Other / Smaller firms",
] as const;

// The catch-all function bucket. It must be visually DE-EMPHASISED and never lead
// the function chart (CLAUDE.md §6 rule 3), so the Dashboard treats it specially:
// it is always sorted LAST regardless of how large it is.
export const OTHER_FUNCTIONS = "Other Functions";

// String-literal unions for the pipeline vocabularies.
export type Seniority = (typeof SENIORITY)[number];
export type SectorGroup = (typeof SECTOR_GROUPS)[number];

// ── Meetings tab vocabularies (CLAUDE.md §4/§5) ──────────────────────────────
// Same rule as above: these are the ONLY valid values for the Meetings dropdowns,
// kept here so the tab, and later the Dashboard's meeting breakdowns, share one
// spelling. Order is the natural workflow order where one exists.

// The meeting lifecycle. A seeded meeting starts at "Agreed - not scheduled"
// (CLAUDE.md §4) and the owner advances it through the stages.
export const MEETING_STAGE = [
  "Agreed - not scheduled",
  "Scheduled",
  "Held",
  "Cancelled",
  "No-show",
  "Declined",
] as const;

// How the meeting happened (CLAUDE.md §4).
export const MEETING_TYPE = [
  "Coffee",
  "Call",
  "Video",
  "Office Meeting",
  "Lunch-Dinner",
  "Event",
] as const;

// The owner's read of how the meeting went, best → worst (CLAUDE.md §4).
export const SENTIMENT = [
  "Very Positive",
  "Positive",
  "Neutral",
  "Cautious",
  "Negative",
] as const;

// Whether a commercial opportunity was spotted. Setting this to "Yes" will,
// in a LATER increment (build-sequence step 6, §7), auto-create a linked
// Opportunities row. For now it is just a recorded flag.
export const OPPORTUNITY_SPOTTED = ["Yes", "No"] as const;

// String-literal unions for the meeting vocabularies.
export type MeetingStage = (typeof MEETING_STAGE)[number];
export type MeetingType = (typeof MEETING_TYPE)[number];
export type Sentiment = (typeof SENTIMENT)[number];
export type OpportunitySpotted = (typeof OPPORTUNITY_SPOTTED)[number];

// ── Owner-maintained dropdown vocabularies (CLAUDE.md §4) ─────────────────────

// Relationship strength, weakest → strongest.
export const RELATIONSHIP_STRENGTH = [
  "Cold",
  "Warm",
  "Strong",
  "Champion",
] as const;

// Priority for the owner's own follow-up effort.
export const PRIORITY = ["High", "Medium", "Low"] as const;

// Who the contact is in a buying decision.
export const DECISION_ROLE = [
  "Decision Maker",
  "Influencer",
  "Gatekeeper",
  "Unknown",
] as const;

// String-literal union types derived from the arrays above. Using `typeof[number]`
// means the type and the dropdown options can never drift apart — change the array
// and the type updates automatically.
export type RelationshipStrength = (typeof RELATIONSHIP_STRENGTH)[number];
export type Priority = (typeof PRIORITY)[number];
export type DecisionRole = (typeof DECISION_ROLE)[number];

// ── Opportunities tab vocabularies (CLAUDE.md §4) ─────────────────────────────
// Same rule as everywhere else: these are the ONLY valid values, kept here so the
// tab and the Dashboard's pipeline-by-stage chart share one spelling and order.

// The service line an opportunity (and later a signed SoW) belongs to. FAAS leads
// because it is the owner's default (§7 auto-create defaults a meeting-spotted
// opportunity to FAAS).
export const SERVICE_LINE = [
  "Strategy",
  "Operations",
  "Technology",
  "Risk & Compliance",
  "Finance & Deals",
  "People & Change",
  "Data & Analytics",
  "Other",
] as const;

// The opportunity workflow (§4) modelled as granular STEPS — every internal/external
// selling-and-delivery activity, in order. The steps are the source of truth for dates
// and next-actions; they roll up to the five PHASES below for the Metrics/Dashboard
// funnels. Each step carries:
//   actor       — who drives it (the client = External, us = Internal, or Both)
//   phase       — its roll-up bucket
//   offsetWeeks — cumulative weeks from the first-meeting anchor (a realistic FS-advisory
//                 cycle: signature ≈ 24 weeks, then a delivery tail). EDITABLE default.
//   prob        — the win-probability suggested when the opportunity reaches this step
//                 (one of the PROBABILITY values, so the form's dropdown can show it).
// "Lost" is NOT a step — it's a terminal flag set at any point (see storage opportunities).
export type OpportunityActor = "External" | "Internal" | "Both";

export const OPPORTUNITY_PHASES = [
  "Identify",
  "Scope & Clear",
  "Propose",
  "Contract",
  "Deliver",
] as const;
export type OpportunityPhase = (typeof OPPORTUNITY_PHASES)[number];

export type OpportunityStepDef = {
  id: string;
  label: string;
  short: string;
  // A one-line description of the activities to complete the step (shown on the form's
  // info-icon tooltip).
  desc: string;
  actor: OpportunityActor;
  phase: OpportunityPhase;
  offsetWeeks: number;
  prob: number;
};

export const OPPORTUNITY_STEPS = [
  { id: "meeting", label: "Initial meeting", short: "Initial meeting", desc: "First substantive meeting with the client where the need is identified.", actor: "External", phase: "Identify", offsetWeeks: 0, prob: 0.1 },
  { id: "qualify", label: "Qualify — go / no-go", short: "Qualify", desc: "Internal go/no-go: strategic fit, winnability and capacity to deliver.", actor: "Internal", phase: "Identify", offsetWeeks: 1, prob: 0.1 },
  { id: "pursuit", label: "Pursuit approval", short: "Pursuit", desc: "Log the opportunity in the pipeline/CRM and obtain approval to invest in the pursuit.", actor: "Internal", phase: "Identify", offsetWeeks: 2, prob: 0.25 },
  { id: "scoping", label: "Scoping", short: "Scoping", desc: "Work with the client to define scope, objectives, timeline and success criteria.", actor: "External", phase: "Scope & Clear", offsetWeeks: 4, prob: 0.25 },
  { id: "clearance", label: "Risk & independence clearance", short: "Clearance", desc: "Independence, conflict and client/engagement acceptance checks.", actor: "Internal", phase: "Scope & Clear", offsetWeeks: 6, prob: 0.5 },
  { id: "proposal_build", label: "Build the proposal", short: "Build proposal", desc: "Solution design, resourcing, economics/margin and internal pricing approval.", actor: "Internal", phase: "Propose", offsetWeeks: 8, prob: 0.5 },
  { id: "proposal_delivery", label: "Proposal", short: "Proposal", desc: "Deliver the proposal to the client and refine it through their feedback.", actor: "External", phase: "Propose", offsetWeeks: 12, prob: 0.75 },
  { id: "procurement", label: "Procurement", short: "Procurement", desc: "Client procurement / vendor-management approval and evaluation.", actor: "External", phase: "Contract", offsetWeeks: 16, prob: 0.85 },
  { id: "contracting", label: "Sign contract", short: "Sign contract", desc: "SoW / engagement contract agreed and signed; legal review on both sides.", actor: "Both", phase: "Contract", offsetWeeks: 24, prob: 0.9 },
  { id: "setup", label: "Engagement setup", short: "Setup", desc: "Engagement code, budget load, team booking, engagement partner, risk assessment/EQR.", actor: "Internal", phase: "Deliver", offsetWeeks: 25, prob: 0.9 },
  { id: "delivery", label: "Delivery", short: "Delivery", desc: "Deliver the work: time recording, WIP, billing, collections, margin, change requests.", actor: "Both", phase: "Deliver", offsetWeeks: 37, prob: 0.9 },
  { id: "revenue", label: "Revenue recognised", short: "Revenue", desc: "Revenue recognised and cash received.", actor: "Internal", phase: "Deliver", offsetWeeks: 45, prob: 1.0 },
] as const;

export type OpportunityStep = (typeof OPPORTUNITY_STEPS)[number]["id"];

// The step at which a deal is Won (contract signed). Reaching it or any later step = Won.
export const WON_STEP: OpportunityStep = "contracting";

// Fast lookup + small accessors so callers never re-scan the array.
const STEP_BY_ID = Object.fromEntries(
  OPPORTUNITY_STEPS.map((s) => [s.id, s]),
) as Record<OpportunityStep, OpportunityStepDef>;

export function stepDef(id: OpportunityStep): OpportunityStepDef {
  return STEP_BY_ID[id];
}
export function stepIndex(id: OpportunityStep): number {
  return OPPORTUNITY_STEPS.findIndex((s) => s.id === id);
}
export function stepLabel(id: OpportunityStep): string {
  return STEP_BY_ID[id]?.label ?? id;
}
export function stepShort(id: OpportunityStep): string {
  return STEP_BY_ID[id]?.short ?? id;
}
// The steps that roll up to a given phase, in workflow order (for the nested step tabs).
export function stepsByPhase(phase: OpportunityPhase): OpportunityStepDef[] {
  return OPPORTUNITY_STEPS.filter((s) => s.phase === phase);
}

// Major advisory/consulting firms — the searchable options for an opportunity's
// Competitors field. Free-text additions are allowed in the picker, so this is a starter
// list, not a closed vocabulary.
export const CONSULTING_FIRMS = [
  "Deloitte",
  "PwC",
  "EY",
  "Strategy&",
  "KPMG",
  "McKinsey",
  "BCG",
  "Bain",
  "Oliver Wyman",
  "Kearney",
  "Accenture",
  "Alvarez & Marsal",
  "Roland Berger",
  "Booz Allen",
  "Arthur D. Little",
  "Protiviti",
  "Grant Thornton",
  "BDO",
  "Mazars",
] as const;

// The owner's name — defaulted into "attendees (ours)" on the meeting form.
export const OWNER_NAME = "Phil Bland";

// Win probability, as fixed values. Stored as a NUMBER so the weighted value
// (= est_value × probability) is a plain multiplication. 0.85 and 1.0 were added so the
// workflow steps can grade up to a signed-and-collected 100%. The label helper below
// turns it into "25%" for display.
export const PROBABILITY = [0.1, 0.25, 0.5, 0.75, 0.85, 0.9, 1.0] as const;

// An opportunity's Open/Won/Lost outcome is NOT a stored vocabulary — it is derived
// from the workflow step + the `lost` flag (see ../data/opportunities.ts
// opportunityStatus), so the owner maintains the workflow, not a separate status.

// String-literal/number union types for the opportunity vocabularies.
export type ServiceLine = (typeof SERVICE_LINE)[number];
export type Probability = (typeof PROBABILITY)[number];

// Display a probability as a whole-number percentage, e.g. 0.25 → "25%".
export function probabilityLabel(p: number): string {
  return `${Math.round(p * 100)}%`;
}

// ── Revenue & SoW tab vocabularies (CLAUDE.md §4) ─────────────────────────────
// Signed work reuses SERVICE_LINE above. Its own lifecycle status:
export const REVENUE_STATUS = [
  "Active",
  "Completed",
  "Paused",
  "Closed",
] as const;

export type RevenueStatus = (typeof REVENUE_STATUS)[number];

// How a SoW is priced — drives the Commercials editor and the contracted-revenue calc.
export const PROJECT_TYPE = ["Fixed price", "Time & materials"] as const;
export type ProjectType = (typeof PROJECT_TYPE)[number];

// Grades for a Time & materials rate card (junior → senior); each billed at its own rate
// per hour × hours.
export const TM_GRADES = [
  "Associate",
  "Senior",
  "Manager",
  "Senior Manager",
  "Director",
  "Partner",
] as const;
export type TmGrade = (typeof TM_GRADES)[number];

// Deliverable categories for a Fixed-price SoW. Deliberately high-level (broad buckets, so
// most work lands cleanly in one) with an "Other" catch-all.
export const DELIVERABLE_CATEGORIES = [
  "Diagnostic & Assessment",
  "Strategy & Roadmap",
  "Operating Model & Org Design",
  "Process Design & Improvement",
  "Implementation & Delivery",
  "Programme & Project Management",
  "Change Management & Training",
  "Data & Analytics",
  "Technology & Systems",
  "Finance & Commercial",
  "Risk, Audit & Compliance",
  "Research & Insights",
  "Marketing & Customer",
  "People & HR",
  "Workshops & Facilitation",
  "Advisory & Ongoing Support",
  "Other",
] as const;
export type DeliverableCategory = (typeof DELIVERABLE_CATEGORIES)[number];
