// Demo + mock-LinkedIn generator for Book of Business — lights up EVERY tab with mock data.
//
// Deterministic (seeded PRNG). Produces:
//   public/mock-linkedin/Connections.csv, messages.csv   — raw LinkedIn-format export (import fixture)
//   public/contacts_enriched.csv, connections_enriched.csv, funnel_summary.csv  — enriched app data
//   public/seed_meetings.json   — meetings + spotted opportunities (loaded by bootstrapSeedMinutes)
//   public/seed_extras.json     — { sows, ownerEdits } (loaded by bootstrapSeedExtras)
//
// Contacts are sampled WIDELY across the ~3,000-company dictionary, with deliberate CLUSTERS
// (some companies get 2/3/4 contacts) so the detailed matrices show multi-contact cells.
//
//   run:  npx tsx scripts/gen-demo.mts   (or npm run gen-demo)

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { COMPANY_DICTIONARY } from "../src/config/markets";
import { classifyContact } from "../src/data/classify";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(__dirname, "../public");
const RAW = resolve(PUBLIC, "mock-linkedin");
mkdirSync(RAW, { recursive: true });

// ── seeded PRNG ───────────────────────────────────────────────────────────────────────────
function rng(seed: number) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = rng(20260620);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const chance = (p: number) => rnd() < p;
const shuffle = <T>(arr: T[]): T[] => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
// Dates are anchored to TODAY so the demo always looks current (meetings in the recent past,
// next-actions/follow-ups spread around now → a believable "this week / overdue" list).
const NOW = new Date();
const isoDay = (daysFromNow: number) => new Date(NOW.getTime() + daysFromNow * 86400000).toISOString().slice(0, 10);

// ── vocab (mirrors src/data/vocab.ts — hardcoded so this script stays dependency-light) ──────
const MEETING_TYPE = ["Coffee", "Call", "Video", "Office Meeting", "Lunch-Dinner", "Event"];
const SENTIMENT = ["Very Positive", "Positive", "Positive", "Neutral", "Cautious"];
const SERVICE_LINE = ["Strategy", "Operations", "Technology", "Risk & Compliance", "Finance & Deals", "People & Change", "Data & Analytics"];
const REL = ["Cold", "Warm", "Strong", "Champion"];
const DECISION = ["Decision Maker", "Influencer", "Gatekeeper", "Unknown"];
const STEP_PROB: Record<string, number> = { qualify: 0.1, pursuit: 0.25, scoping: 0.25, clearance: 0.5, proposal_build: 0.5, proposal_delivery: 0.75, procurement: 0.85, contracting: 0.9, setup: 0.9, delivery: 0.9, revenue: 1.0 };
const WON = new Set(["contracting", "setup", "delivery", "revenue"]);
const PAINS = ["legacy systems slowing the close", "cost pressure on the operating model", "a regulatory deadline approaching", "a stalled transformation programme", "data quality issues in reporting", "a post-merger integration to land", "margin erosion in a key division", "a board mandate to cut run-cost"];

const FIRST = ["James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda", "David", "Elizabeth", "William", "Susan", "Richard", "Sarah", "Thomas", "Karen", "Daniel", "Emma", "Matthew", "Olivia", "Sophie", "Lucas", "Hannah", "Liam", "Chloe", "Noah", "Amelia", "Henrik", "Ingrid", "Mateo", "Camille", "Lars", "Giulia", "Anders", "Priya", "Omar", "Wei", "Aisha", "Diego", "Freya", "Marcus", "Nadia", "Tom", "Grace", "Adam", "Laura", "Paul", "Rachel", "Maria", "Ethan"];
const LAST = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Wilson", "Taylor", "Anderson", "Thomas", "Moore", "Martin", "Clarke", "Wright", "Walker", "Hughes", "Green", "Evans", "Müller", "Schmidt", "Dubois", "Rossi", "Nielsen", "Andersson", "Kowalski", "Novak", "Singh", "Patel", "OConnor", "Lindqvist", "Bianchi", "Laurent", "Hofmann", "Jansen", "Kelly", "Murphy", "Reed", "Stewart", "Bennett", "Foster", "Sanders", "Price", "Bell", "Cole", "Ward", "Gray", "Hunt", "Fisher"];
const TITLES_BY_TIER = {
  exec: ["Chief Executive Officer", "Chief Financial Officer", "Chief Operating Officer", "Chief Technology Officer", "Partner", "Managing Director", "President", "Director of Strategy", "Director of Operations", "Director of Finance"],
  head: ["Head of Risk", "Head of Finance", "Head of Technology", "Head of Marketing", "General Manager", "Senior Vice President", "Head of Product", "Head of Data & Analytics", "Head of People", "Head of Strategy"],
  vpsm: ["Vice President, Operations", "Senior Manager, Strategy", "VP of Engineering", "Senior Manager, Finance", "Associate Director, Risk", "Senior Manager, Marketing", "Vice President, Finance", "Principal Consultant"],
  mgr: ["Manager, Finance", "Operations Manager", "Engineering Manager", "Product Manager", "Marketing Manager", "Team Lead, Data", "Project Manager", "Manager, Risk & Compliance"],
  ic: ["Senior Analyst", "Financial Analyst", "Software Engineer", "Data Scientist", "Compliance Specialist", "Account Executive", "Consultant", "Operations Specialist", "Business Analyst", "Associate"],
} as const;
const TIERS = ["exec", "head", "vpsm", "mgr", "ic"] as const;

// ── unique company pool + CLUSTER plan (some companies get 2/3/4 contacts) ───────────────────
// Dedup the dictionary PRESERVING ORDER (no shuffle): COMPANY_DICTIONARY lists the marquee
// firms first and prominence-ordered within each industry (FS: JPMorgan→BofA→Goldman…;
// Pro-services: KPMG→Deloitte→PwC→EY→McKinsey…), with the bulk SLICE_COMPANIES appended after.
// Demo is a US/Europe book: only seed companies tagged for those regions. Region-untagged
// entries (Gulf entities, region-[] long-tail) exist in the dictionary so they CLASSIFY on a real
// import, but must never seed the demo — otherwise non-target / non-Latin org names leak in.
const seen = new Set<string>();
const DICT = COMPANY_DICTIONARY.filter((c) => {
  if (!Array.isArray(c.regions) || !(c.regions.includes("north-america") || c.regions.includes("europe"))) return false;
  const k = c.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true;
});
// ── PERSONA-weighted, POWER-LAW benches + an UNKNOWN long tail ─────────────────────────────────
// A real BD book is LOPSIDED — deep in the consultant's own sectors, with a messy long tail of small/unknown
// firms — never a uniform sample. This demo is a strategy/risk consultant: network anchors in Financial
// Services, Professional Services and Energy; thins through Tech/Consumer; trails off across Public/Health/
// Real Estate + hundreds of tiny boutiques the org dictionary has never heard of.
const SECTOR_WEIGHT: Record<string, number> = {
  "financial-services": 3.2, "professional-services": 2.5, "energy-industrial": 2.2,
  "technology": 1.4, "consumer-retail": 1.0, "healthcare": 0.7, "public-sector": 0.7, "real-estate": 0.5,
};
// Draw dictionary firms in SECTOR-WEIGHTED prominence order: dominant-sector marquee names first + more
// often. The dictionary is already prominence-ordered within an industry, so we just advance a cursor.
const byIndustry = new Map<string, typeof DICT>();
for (const c of DICT) { const a = byIndustry.get(c.industry) ?? []; a.push(c); byIndustry.set(c.industry, a); }
const cursor = new Map<string, number>([...byIndustry.keys()].map((k) => [k, 0]));
const ORDERED: typeof DICT = [];
{
  const inds = [...byIndustry.keys()];
  for (;;) {
    const avail = inds.filter((k) => cursor.get(k)! < byIndustry.get(k)!.length);
    if (!avail.length) break;
    const total = avail.reduce((s, k) => s + (SECTOR_WEIGHT[k] ?? 1), 0);
    let r = rnd() * total, chosen = avail[0];
    for (const k of avail) { r -= SECTOR_WEIGHT[k] ?? 1; if (r <= 0) { chosen = k; break; } }
    const idx = cursor.get(chosen)!; ORDERED.push(byIndustry.get(chosen)![idx]); cursor.set(chosen, idx + 1);
  }
}

type Tier = (typeof TIERS)[number];
type Contact = { first: string; last: string; company: string; title: string; url: string; email: string; connectedOn: string; tier: string };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Small/unknown firms for the long tail — boutiques, startups, personal consultancies the dictionary can't
// place (so they land in "Other / smaller firms", exactly like a real export — and exercise the classify tool).
const FIRM_STEM = ["Harlow", "Meridian", "Brookfield", "Oakwood", "Ashcroft", "Calder", "Thornton", "Kingsley", "Halston", "Redwood", "Blackwell", "Marlow", "Pinnacle", "Vantage", "Kestrel", "Whitfield", "Sinclair", "Ashworth", "Crestline", "Fairbanks", "Langley", "Whitmore", "Beacon", "Northgate", "Wexford", "Camden", "Ellison", "Fenwick", "Granby", "Holloway", "Marsden", "Pembroke", "Rowan", "Selby", "Tavistock", "Bramwell", "Cobalt", "Larkfield", "Everly", "Standen"];
const FIRM_TYPE = ["Advisory", "Consulting", "Partners", "Associates", "Capital", "Ventures", "Group", "Solutions", "Analytics", "Advisers", "Strategy", "Studio", "Consulting Group", "Advisory Partners"];
const SMALL_FIRM_OWNER = ["Founder", "Managing Partner", "Managing Director", "Principal", "Owner", "Director"];
function genUnknownFirm(): string {
  const r = rnd();
  if (r < 0.30) return `${pick(LAST)} & Partners`;
  if (r < 0.45) return `${pick(LAST)} ${pick(["Advisory", "Consulting", "Associates", "& Co"])}`;
  return `${pick(FIRM_STEM)} ${pick(FIRM_TYPE)}`;
}

// One contact with an EXPLICIT tier + title, so a whole bench can be shaped as a realistic org pyramid.
function makeOne(company: string, tier: string, title: string): Contact {
  const first = pick(FIRST), last = pick(LAST);
  const url = `https://www.linkedin.com/in/demo-${slug(first)}-${slug(last)}-${Math.floor(rnd() * 90000 + 10000)}`;
  const email = chance(0.25) ? `${slug(first)}.${slug(last)}@${slug(company).slice(0, 14)}.com` : "";
  const connectedOn = `${String(Math.floor(rnd() * 28) + 1).padStart(2, "0")} ${pick(MONTHS)} ${2018 + Math.floor(rnd() * 7)}`;
  return { first, last, company, title, url, email, connectedOn, tier };
}

// A company's BENCH as an org PYRAMID: a fixed, UNIQUE C-suite up top (never two COOs), thinning down to
// analysts. Tiny firms are mostly ICs with the occasional founder/owner.
function makeBench(company: string, n: number, tiny = false): Contact[] {
  const usedExec = new Set<string>();
  const tiers: Tier[] = [];
  if (tiny) {
    for (let k = 0; k < n; k++) tiers.push(k === 0 && chance(0.4) ? "exec" : chance(0.3) ? "head" : chance(0.4) ? "mgr" : "ic");
  } else {
    const nExec = n >= 25 ? 2 : n >= 6 ? 1 : chance(0.5) ? 1 : 0;
    const nHead = Math.max(1, Math.round(n * 0.15));
    const nVp = Math.round(n * 0.24);
    const nMgr = Math.round(n * 0.28);
    for (let k = 0; k < nExec; k++) tiers.push("exec");
    for (let k = 0; k < nHead; k++) tiers.push("head");
    for (let k = 0; k < nVp; k++) tiers.push("vpsm");
    for (let k = 0; k < nMgr; k++) tiers.push("mgr");
    while (tiers.length < n) tiers.push("ic");
    tiers.length = n;
  }
  return tiers.map((tier) => {
    if (tiny && tier === "exec") return makeOne(company, "exec", pick(SMALL_FIRM_OWNER));
    let title = pick(TITLES_BY_TIER[tier]);
    if (tier === "exec") {
      let tries = 0;
      while (usedExec.has(title) && tries++ < 8) title = pick(TITLES_BY_TIER.exec);
      if (usedExec.has(title)) return makeOne(company, "head", pick(TITLES_BY_TIER.head)); // out of unique C-suite → a Head
      usedExec.add(title);
    }
    return makeOne(company, tier, title);
  });
}

const contacts: Contact[] = [];
const TARGET_CONTACTS = 2319;
// POWER-LAW: 5 deep anchors ("I know everyone here"), an upper-mid tier, a mid tier, then small firms — the
// biggest benches on the dominant-sector marquee accounts (front of ORDERED). The remaining ~1,300 are a LONG
// TAIL of 1–2 person firms, ~55% of them small/unknown boutiques the dictionary never sees.
const benchPlan: number[] = [
  40, 34, 30, 26, 22,                              // anchors
  18, 16, 15, 13, 12, 11, 10, 9,                   // upper-mid
  ...Array(16).fill(0).map((_, i) => 6 + (i % 3)), // mid (6–8)
  ...Array(45).fill(4),
  ...Array(85).fill(3),
  ...Array(150).fill(2),
];
let oi = 0;
for (const size of benchPlan) {
  if (contacts.length >= TARGET_CONTACTS) break;
  const company = (ORDERED[oi++] ?? { name: genUnknownFirm() }).name;
  for (const c of makeBench(company, size)) { if (contacts.length >= TARGET_CONTACTS) break; contacts.push(c); }
}
// Long tail — mostly generated unknown boutiques (1–2 people), plus the dictionary's own long tail.
while (contacts.length < TARGET_CONTACTS) {
  const company = chance(0.55) ? genUnknownFirm() : (ORDERED[oi++]?.name ?? genUnknownFirm());
  for (const c of makeBench(company, chance(0.25) ? 2 : 1, true)) { if (contacts.length >= TARGET_CONTACTS) break; contacts.push(c); }
}

// ── messages → derive the contacts-first funnel ──────────────────────────────────────────────
const PROPOSE = ["coffee", "grab a coffee", "catch up", "meet up", "lunch", "get together"];
const AFFIRM = ["sounds great", "sounds good", "would love to", "happy to", "let's do it", "for sure", "that works", "looking forward", "great idea"];
const OWNER = { name: "Phil Bland", url: "https://www.linkedin.com/in/demo-phil-bland" };
type Msg = { convId: string; title: string; from: string; senderUrl: string; to: string; recipUrl: string; date: string; content: string };
const messages: Msg[] = [];
const messagedSet = new Set<string>(), respondedSet = new Set<string>(), agreedSet = new Set<string>();
let conv = 1000;
contacts.forEach((c, i) => {
  // ~43% of the network has been messaged (aspirational but believable — and the app nudges you to DM more),
  // then the funnel tapers: of those, ~45% reply, a subset agree to meet, fewer are met.
  if (!chance(0.43)) return;
  const cid = `conv-${conv++}`, full = `${c.first} ${c.last}`, proposes = chance(0.5);
  const opener = proposes
    ? `Hi ${c.first}, great to be connected. I'd love to ${pick(PROPOSE)} sometime to compare notes. Would you be open to that?`
    : `Hi ${c.first}, thanks for connecting — enjoyed your recent post. Keen to stay in touch.`;
  messages.push({ convId: cid, title: full, from: OWNER.name, senderUrl: OWNER.url, to: full, recipUrl: c.url, date: isoDay(-(95 - (i % 85))) + " 09:15:00 UTC", content: opener });
  messagedSet.add(c.url);
  if (chance(0.45)) {
    respondedSet.add(c.url);
    const affirms = proposes && chance(0.8);
    const reply = affirms ? `Hi Phil — ${pick(AFFIRM)}. Let me know what suits.` : `Thanks Phil, good to connect. Let's keep in touch.`;
    messages.push({ convId: cid, title: full, from: full, senderUrl: c.url, to: OWNER.name, recipUrl: OWNER.url, date: isoDay(-(94 - (i % 85))) + " 14:30:00 UTC", content: reply });
    if (proposes && AFFIRM.some((a) => reply.toLowerCase().includes(a))) agreedSet.add(c.url);
  }
});

// ── meetings + opportunities (seed_meetings.json) for the AGREED contacts ─────────────────────
const byUrl = new Map(contacts.map((c) => [c.url, c]));
const heldSet = new Set<string>();
type SeedOpp = { opportunity_name: string; service_line: string; step?: string; lost?: boolean; description?: string; est_value?: number; probability?: number; next_step?: string };
type SeedMinute = Record<string, unknown> & { contact_url: string; meeting_no: number; meeting_stage: string; opportunity: SeedOpp | null };
const seedMinutes: SeedMinute[] = [];
type Deliverable = { id: string; name: string; category: string; price?: number };
type RateLine = { grade: string; rate_per_hour?: number; hours?: number };
type Sow = { id: string; linked_opportunity_id?: string; organisation: string; engagement_name: string; signed_date?: string; start_date?: string; end_date?: string; service_line: string; project_type?: string; deliverables?: Deliverable[]; rate_card?: RateLine[]; recognised_to_date?: number; next_action?: string; next_action_date?: string; status: string };
const sows: Sow[] = [];
const TM_GRADES = ["Associate", "Senior", "Manager", "Senior Manager", "Director", "Partner"];
const DL_CATS = ["Diagnostic & Assessment", "Strategy & Roadmap", "Operating Model & Org Design", "Process Design & Improvement", "Implementation & Delivery", "Programme & Project Management", "Change Management & Training", "Data & Analytics", "Advisory & Ongoing Support"];

// Workflow step offsets (mirror src/data/vocab.ts OPPORTUNITY_STEPS) so we can anchor each
// opportunity's HELD date such that its NEXT step's planned date lands on a chosen day. The app
// derives the next-step due date as anchor + offsetWeeks(nextStep); inverting that lets the demo
// place an exact, small number of items in the "this week" agenda window instead of a flood.
const STEP_ORDER = ["meeting", "qualify", "pursuit", "scoping", "clearance", "proposal_build", "proposal_delivery", "procurement", "contracting", "setup", "delivery", "revenue"];
const OFFSET_WEEKS: Record<string, number> = { meeting: 0, qualify: 1, pursuit: 2, scoping: 4, clearance: 6, proposal_build: 8, proposal_delivery: 12, procurement: 16, contracting: 24, setup: 25, delivery: 37, revenue: 45 };
const nextStep = (s: string) => STEP_ORDER[STEP_ORDER.indexOf(s) + 1];
// Held date (days from today, negative = past) so that `step`'s NEXT planned step lands `delta`
// days from today. delta=null → a recent hold; the large later-stage offset puts the next step
// well in the future (or there is none), so it never enters the agenda window.
const heldForDelta = (step: string, delta: number | null) =>
  delta == null ? -(6 + (STEP_ORDER.indexOf(step) % 18)) : delta - OFFSET_WEEKS[nextStep(step)] * 7;

const VALUE_POOL = [75000, 120000, 150000, 200000, 250000, 350000, 500000, 800000];
const PIPE_STEPS = ["qualify", "pursuit", "scoping", "clearance", "proposal_build", "proposal_delivery", "procurement"];
const WON_STEPS = ["contracting", "setup", "delivery", "delivery", "revenue"];

// ── opportunity plan (~40 across every stage) ─────────────────────────────────────────────────
// Each slot = { step, delta }. delta = days-from-today the next step is due (drives the agenda):
//   • 6 OVERDUE   (a controlled "to chase" list, not a sea of red)
//   • 3 UPCOMING  (due within the next week)
//   • 11 QUIET    pipeline whose next step slipped weeks ago → shows in "going cold", not the agenda
//   • 20 WON      (contracting → revenue) → these seed most of the Contracts/Revenue book
type OppSlot = { step: string; delta: number | null; lost?: boolean };
const oppPlan: OppSlot[] = [];
[-9, -7, -5, -4, -2, -1].forEach((d, k) => oppPlan.push({ step: PIPE_STEPS[k % PIPE_STEPS.length], delta: d }));
[2, 4, 6].forEach((d, k) => oppPlan.push({ step: PIPE_STEPS[(k + 2) % PIPE_STEPS.length], delta: d }));
for (let k = 0; k < 11; k++) oppPlan.push({ step: PIPE_STEPS[k % PIPE_STEPS.length], delta: -(24 + k * 7) });
for (let k = 0; k < 20; k++) oppPlan.push({ step: WON_STEPS[k % WON_STEPS.length], delta: null });
// LOST: a realistic minority of deals die after real investment (clearance→procurement). Gives a
// believable ~70% win rate (20 won / 9 lost), NOT a fake 100%. These are NOT WON_STEPS, so they never
// become signed engagements; oppStatus returns "Lost" via the lost flag regardless of step.
const LOST_STEPS = ["clearance", "proposal_build", "proposal_delivery", "procurement", "scoping"];
for (let k = 0; k < 9; k++) oppPlan.push({ step: LOST_STEPS[k % LOST_STEPS.length], delta: null, lost: true });

// Collected for the contracts pass below (won opps become signed engagements).
type OppMeta = { url: string; company: string; sl: string; step: string };
const wonOpps: OppMeta[] = [];

const agreed = [...agreedSet];
let schedInWindow = 0; // cap the number of upcoming scheduled meetings that hit the agenda
agreed.forEach((url, i) => {
  const c = byUrl.get(url)!;
  const full = `${c.first} ${c.last}`;
  const pain = pick(PAINS);
  let stage: string;
  let mHeld: string | undefined;
  let mSched: string | undefined;
  const mAgreed = isoDay(-(25 + (i % 60)));
  let opp: SeedOpp | null = null;

  if (i < oppPlan.length) {
    // Opportunity-carrying HELD meeting. The held date is reverse-engineered from the agenda slot.
    const slot = oppPlan[i];
    stage = "Held";
    mHeld = isoDay(heldForDelta(slot.step, slot.delta));
    heldSet.add(url);
    const sl = pick(SERVICE_LINE);
    opp = {
      opportunity_name: `${c.company} — ${sl} engagement`, service_line: sl, step: slot.step,
      lost: slot.lost || undefined,
      description: `Opportunity spotted with ${full} (${c.title}) around ${pain}.`,
      est_value: pick(VALUE_POOL), probability: slot.lost ? 0 : STEP_PROB[slot.step],
      next_step: pick(["Send a follow-up note", "Draft a short proposal", "Schedule a scoping call", "Confirm budget owner", "Share a relevant case study"]),
    };
    if (!slot.lost && WON.has(slot.step)) wonOpps.push({ url, company: c.company, sl, step: slot.step });
  } else {
    // Relationship / pipeline meetings WITHOUT a spotted opportunity (still light up the funnel).
    const j = i - oppPlan.length;
    if (schedInWindow < 2 && j % 2 === 0) {
      stage = "Scheduled"; mSched = isoDay(j === 0 ? 2 : 5); schedInWindow++;   // a couple of real upcoming meetings
    } else if (j % 3 === 0) {
      stage = "Scheduled"; mSched = isoDay(12 + (j % 50));                       // scheduled but further out
    } else if (j % 3 === 1) {
      stage = "Held"; mHeld = isoDay(-(9 + (j % 55))); heldSet.add(url);         // relationship-only held meeting
    } else {
      stage = "Agreed - not scheduled";
    }
  }

  const held = stage === "Held";
  seedMinutes.push({
    contact_url: url, meeting_no: 1, meeting_stage: stage,
    date_agreed: mAgreed, date_scheduled: mSched, date_held: mHeld,
    type: pick(MEETING_TYPE), location: pick(["Their office", "Coffee near Liverpool St", "Video call", "Lunch in the City", "Industry conference"]),
    attendees_ours: OWNER.name, attendees_client: full,
    purpose: "Introductory meeting / explore where we could help.",
    notes: `Good conversation with ${full}. ${held ? `Discussed ${pain}.` : "Looking forward to it."}`,
    org_insights: held ? `${c.company} is dealing with ${pain}.` : undefined,
    pain_points: held ? pain : undefined,
    opportunity_spotted: opp ? "Yes" : "No",
    actions_mine: held ? pick(["Send follow-up + relevant case study", "Draft a one-pager", "Introduce a colleague"]) : undefined,
    actions_theirs: held ? "Share more detail on the current setup" : undefined,
    // Follow-ups sit beyond the agenda window (12+ days out) so they don't crowd "this week".
    followup: held && !opp ? "Reconnect in two weeks" : undefined,
    followup_date: held && !opp ? isoDay(12 + (i % 30)) : undefined,
    sentiment: pick(SENTIMENT),
    opportunity: opp,
  });
});

// ── contracts (~30) — the signed book across stages, fixed-price + T&M ─────────────────────────
// Most come from the won opportunities above (linked); a handful are standalone engagements on
// marquee firms (older work, no live pipeline row). A small, capped few carry an in-window next
// action so the agenda shows ~2–3 upcoming contract steps without flooding it.
let contractInWindow = 0;
function buildSow(id: string, organisation: string, sl: string, idx: number, linkedId?: string): Sow {
  const isTM = idx % 2 === 0;
  let contracted = 0;
  let deliverables: Deliverable[] | undefined;
  let rate_card: RateLine[] | undefined;
  if (isTM) {
    const used = TM_GRADES.slice(1, 2 + (idx % 4));
    rate_card = used.map((grade) => ({ grade, rate_per_hour: pick([180, 220, 260, 320, 420, 550]), hours: pick([80, 120, 160, 240, 320]) }));
    contracted = rate_card.reduce((s, r) => s + (r.rate_per_hour ?? 0) * (r.hours ?? 0), 0);
  } else {
    const n = 2 + (idx % 3);
    deliverables = Array.from({ length: n }, (_, di) => ({ id: `${id}-d${di}`, name: `${["Phase", "Workstream", "Stage"][di % 3]} ${di + 1} — ${DL_CATS[(idx + di) % DL_CATS.length]}`, category: DL_CATS[(idx + di) % DL_CATS.length], price: pick([25000, 40000, 60000, 80000, 120000, 150000]) }));
    contracted = deliverables.reduce((s, d) => s + (d.price ?? 0), 0);
  }
  const completed = idx % 5 === 0;
  const recPct = completed ? 1 : pick([0.15, 0.3, 0.45, 0.6, 0.75]);
  const wantWindow = !completed && contractInWindow < 3 && idx % 4 === 1;
  if (wantWindow) contractInWindow++;
  const nextActionDate = completed ? undefined : wantWindow ? isoDay(pick([1, 3, 6])) : isoDay(15 + (idx % 90));
  // Dates must always run signed ≤ start ≤ end (the old end_date could land BEFORE start). Signed in the past,
  // starts shortly after, then a 3–9 month engagement — so completed ones ended in the past and active ones
  // still have runway ahead.
  const signedOff = -(20 + (idx % 200));
  const startOff = signedOff + 8 + (idx % 14);
  const endOff = startOff + 90 + (idx % 180);
  return {
    id, linked_opportunity_id: linkedId, organisation, engagement_name: `${sl} engagement`,
    signed_date: isoDay(signedOff), start_date: isoDay(startOff), end_date: isoDay(endOff),
    service_line: sl, project_type: isTM ? "Time & materials" : "Fixed price", deliverables, rate_card,
    recognised_to_date: Math.round(contracted * recPct),
    next_action: completed ? undefined : pick(["Invoice milestone 2", "Deliver phase 1", "Send the status report", "Chase the deposit", "Confirm scope for next phase", "Book the close-out review"]),
    next_action_date: nextActionDate,
    status: completed ? "Completed" : "Active",
  };
}
wonOpps.forEach((m, k) => sows.push(buildSow(`sow-w${k}`, m.company, m.sl, k, `opp:meeting:${m.url}#1`)));
for (let k = 0; sows.length < 30; k++) {
  const co = ORDERED[(k * 4 + 1) % ORDERED.length];
  sows.push(buildSow(`sow-s${k}`, co.name, SERVICE_LINE[k % SERVICE_LINE.length], k + 50));
}

// ── owner edits (relationship strength, priority, next actions) — light up Contacts + priorities ──
type OwnerEdit = { url: string; edits: Record<string, unknown> };
const ownerEdits: OwnerEdit[] = [];
contacts.forEach((c, i) => {
  const agreed = agreedSet.has(c.url), responded = respondedSet.has(c.url), messaged = messagedSet.has(c.url);
  if (!messaged && !chance(0.15)) return; // most owner notes are on people you've engaged
  const rel = agreed ? pick(["Strong", "Strong", "Champion", "Warm"]) : responded ? pick(["Warm", "Warm", "Strong"]) : pick(["Cold", "Warm"]);
  const e: Record<string, unknown> = {
    relationship_strength: rel,
    priority: agreed ? pick(["High", "High", "Medium"]) : pick(["Medium", "Low"]),
    decision_role: pick(DECISION),
  };
  // A handful of concrete next-actions (these surface on the dashboard).
  if (agreed && chance(0.6)) { e.next_action = pick(["Send the proposal", "Book the scoping call", "Chase budget sign-off", "Share case study", "Intro the delivery lead"]); e.next_action_date = isoDay((i % 38) - 9); }
  if (responded) e.last_contact_date = isoDay(-(4 + (i % 50)));
  ownerEdits.push({ url: c.url, edits: e });
});

// ── write RAW LinkedIn export ─────────────────────────────────────────────────────────────────
const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const connRows = contacts.map((c) => [c.first, c.last, c.url, c.email, c.company, c.title, c.connectedOn].map(esc).join(","));
writeFileSync(resolve(RAW, "Connections.csv"), `Notes:\n"When exporting your connection data, you may notice that some of the fields are empty."\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\n${connRows.join("\n")}\n`);
const msgRows = messages.map((m) => [m.convId, m.title, m.from, m.senderUrl, m.to, m.recipUrl, m.date, "", m.content, "INBOX"].map(esc).join(","));
writeFileSync(resolve(RAW, "messages.csv"), `CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,SUBJECT,CONTENT,FOLDER\n${msgRows.join("\n")}\n`);

// ── write ENRICHED app data ───────────────────────────────────────────────────────────────────
const COLS = ["first", "last", "organisation", "position", "sector_detail", "sector_group", "sub_group", "seniority", "function", "messaged", "responded", "two_way", "agreed_to_meet", "met", "url", "phone"] as const;
const enriched = contacts.map((c) => {
  const e = classifyContact({ first: c.first, last: c.last, company: c.company, title: c.title, url: c.url });
  return { ...e, messaged: messagedSet.has(c.url), responded: respondedSet.has(c.url), two_way: respondedSet.has(c.url), agreed_to_meet: agreedSet.has(c.url), met: heldSet.has(c.url), phone: "" };
});
const toCsv = (rows: typeof enriched) => [COLS.join(","), ...rows.map((r) => COLS.map((c) => esc((r as Record<string, unknown>)[c])).join(","))].join("\n") + "\n";
writeFileSync(resolve(PUBLIC, "contacts_enriched.csv"), toCsv(enriched));
writeFileSync(resolve(PUBLIC, "connections_enriched.csv"), toCsv(enriched));
writeFileSync(resolve(PUBLIC, "pending_invites.csv"), "name,url,sent_at\n");
writeFileSync(resolve(PUBLIC, "funnel_summary.csv"), `requests_sent,accepted,target_pipeline,messaged,responded,agreed_to_meet,met,pending_invites\n${[contacts.length, contacts.length, contacts.length, messagedSet.size, respondedSet.size, agreedSet.size, heldSet.size, 0].join(",")}\n`);
writeFileSync(resolve(PUBLIC, "seed_meetings.json"), JSON.stringify(seedMinutes, null, 0) + "\n");
writeFileSync(resolve(PUBLIC, "seed_extras.json"), JSON.stringify({ sows, ownerEdits }, null, 0) + "\n");

// ── report ──────────────────────────────────────────────────────────────────────────────────
const distinct = new Set(contacts.map((c) => c.company)).size;
const oppCount = seedMinutes.filter((m) => m.opportunity).length;
const clusters = (() => { const m = new Map<string, number>(); for (const c of contacts) m.set(c.company, (m.get(c.company) ?? 0) + 1); const d: Record<number, number> = {}; for (const n of m.values()) d[n] = (d[n] ?? 0) + 1; return d; })();
console.log(`Contacts ${contacts.length} across ${distinct} companies. Company clusters by size:`, clusters);
console.log(`Funnel: messaged ${messagedSet.size} → responded ${respondedSet.size} → agreed ${agreedSet.size} → met ${heldSet.size}`);
console.log(`Meetings ${seedMinutes.length} (held ${heldSet.size}) · Opportunities ${oppCount} · SoWs ${sows.length} · Owner-edits ${ownerEdits.length} · Messages ${messages.length}`);
