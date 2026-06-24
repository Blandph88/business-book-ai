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
const TIER_W = [0.16, 0.2, 0.22, 0.22, 0.2];
function pickTier() { let r = rnd(); for (let i = 0; i < TIERS.length; i++) { r -= TIER_W[i]; if (r <= 0) return TIERS[i]; } return "ic" as const; }

// ── unique company pool + CLUSTER plan (some companies get 2/3/4 contacts) ───────────────────
const seen = new Set<string>();
const POOL = shuffle(COMPANY_DICTIONARY.filter((c) => { const k = c.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }));
type Contact = { first: string; last: string; company: string; title: string; url: string; email: string; connectedOn: string; tier: string };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function makeContact(company: string): Contact {
  const first = pick(FIRST), last = pick(LAST), tier = pickTier();
  const title = pick(TITLES_BY_TIER[tier]);
  const url = `https://www.linkedin.com/in/demo-${slug(first)}-${slug(last)}-${Math.floor(rnd() * 90000 + 10000)}`;
  const email = chance(0.25) ? `${slug(first)}.${slug(last)}@${slug(company).slice(0, 14)}.com` : "";
  const connectedOn = `${String(Math.floor(rnd() * 28) + 1).padStart(2, "0")} ${pick(MONTHS)} ${2018 + Math.floor(rnd() * 7)}`;
  return { first, last, company, title, url, email, connectedOn, tier };
}
const contacts: Contact[] = [];
// Clusters: 40 companies × 4, 60 × 3, 160 × 2, then 1 each until ~1,400 contacts.
const plan: number[] = [...Array(40).fill(4), ...Array(60).fill(3), ...Array(160).fill(2)];
let ci = 0;
for (const n of plan) { const company = POOL[ci++ % POOL.length].name; for (let k = 0; k < n; k++) contacts.push(makeContact(company)); }
while (contacts.length < 1400) contacts.push(makeContact(POOL[ci++ % POOL.length].name));

// ── messages → derive the contacts-first funnel ──────────────────────────────────────────────
const PROPOSE = ["coffee", "grab a coffee", "catch up", "meet up", "lunch", "get together"];
const AFFIRM = ["sounds great", "sounds good", "would love to", "happy to", "let's do it", "for sure", "that works", "looking forward", "great idea"];
const OWNER = { name: "Phil Bland", url: "https://www.linkedin.com/in/demo-phil-bland" };
type Msg = { convId: string; title: string; from: string; senderUrl: string; to: string; recipUrl: string; date: string; content: string };
const messages: Msg[] = [];
const messagedSet = new Set<string>(), respondedSet = new Set<string>(), agreedSet = new Set<string>();
let conv = 1000;
contacts.forEach((c, i) => {
  if (!chance(0.55)) return;
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
type Sow = { id: string; linked_opportunity_id?: string; organisation: string; engagement_name: string; signed_date?: string; start_date?: string; end_date?: string; service_line: string; project_type?: string; deliverables?: Deliverable[]; rate_card?: RateLine[]; recognised_to_date?: number; status: string };
const sows: Sow[] = [];
const TM_GRADES = ["Associate", "Senior", "Manager", "Senior Manager", "Director", "Partner"];
const DL_CATS = ["Diagnostic & Assessment", "Strategy & Roadmap", "Operating Model & Org Design", "Process Design & Improvement", "Implementation & Delivery", "Programme & Project Management", "Change Management & Training", "Data & Analytics", "Advisory & Ongoing Support"];

const STEPS_SPREAD = ["pursuit", "pursuit", "scoping", "scoping", "clearance", "proposal_build", "proposal_delivery", "procurement", "contracting", "setup", "delivery", "revenue"];
[...agreedSet].forEach((url, i) => {
  const c = byUrl.get(url)!;
  const full = `${c.first} ${c.last}`;
  // stage: 60% Held, 25% Scheduled, 15% Agreed-not-scheduled
  const r = rnd();
  const stage = r < 0.6 ? "Held" : r < 0.85 ? "Scheduled" : "Agreed - not scheduled";
  if (stage === "Held") heldSet.add(url);
  const mAgreed = isoDay(-(20 + (i % 70)));       // agreed a few weeks–months ago
  const mSched = isoDay((i % 28) - 4);            // scheduled = UPCOMING (a few just overdue)
  const mHeld = isoDay(-(6 + (i % 60)));          // held recently
  const pain = pick(PAINS);
  // Held meetings mostly spot an opportunity; scheduled ones sometimes carry a pre-identified one.
  const spots = (stage === "Held" && chance(0.82)) || (stage === "Scheduled" && chance(0.4));
  let opp: SeedOpp | null = null;
  if (spots) {
    const lost = stage === "Held" && chance(0.06);
    // Scheduled meetings haven't happened → opportunity is still early-stage.
    const step = lost ? "pursuit" : stage === "Scheduled" ? pick(["pursuit", "qualify", "scoping"]) : STEPS_SPREAD[i % STEPS_SPREAD.length];
    const sl = pick(SERVICE_LINE);
    const value = pick([75000, 120000, 150000, 200000, 250000, 350000, 500000, 800000]);
    opp = { opportunity_name: `${c.company} — ${sl} engagement`, service_line: sl, step, lost: lost || undefined, description: `Opportunity spotted with ${full} (${c.title}) around ${pain}.`, est_value: value, probability: lost ? undefined : STEP_PROB[step], next_step: lost ? "Closed out — revisit next year" : pick(["Send a follow-up note", "Draft a short proposal", "Schedule a scoping call", "Confirm budget owner", "Share a relevant case study"]) };
    // Won opportunities → a SoW in the Revenue tab. Alternate Fixed-price / T&M so the
    // demo (and the tutorial) showcase both pricing models.
    if (!lost && WON.has(step)) {
      const completed = step === "delivery" && chance(0.5);
      const isTM = i % 2 === 0;
      let contracted = 0;
      let deliverables: Deliverable[] | undefined;
      let rate_card: RateLine[] | undefined;
      if (isTM) {
        const used = TM_GRADES.slice(1, 2 + (i % 4)); // 2–4 grades, skewed mid-senior
        rate_card = used.map((grade) => ({ grade, rate_per_hour: pick([180, 220, 260, 320, 420, 550]), hours: pick([80, 120, 160, 240, 320]) }));
        contracted = rate_card.reduce((s, r) => s + (r.rate_per_hour ?? 0) * (r.hours ?? 0), 0);
      } else {
        const n = 2 + (i % 3); // 2–4 deliverables
        deliverables = Array.from({ length: n }, (_, di) => ({ id: `sow-${i}-d${di}`, name: `${["Phase", "Workstream", "Stage"][di % 3]} ${di + 1} — ${DL_CATS[(i + di) % DL_CATS.length]}`, category: DL_CATS[(i + di) % DL_CATS.length], price: pick([25000, 40000, 60000, 80000, 120000, 150000]) }));
        contracted = deliverables.reduce((s, d) => s + (d.price ?? 0), 0);
      }
      sows.push({ id: `sow-${i}`, linked_opportunity_id: `opp:meeting:${url}#1`, organisation: c.company, engagement_name: `${sl} engagement`, signed_date: mHeld, start_date: isoDay(-(5 + (i % 60))), end_date: isoDay((i % 150) - 25), service_line: sl, project_type: isTM ? "Time & materials" : "Fixed price", deliverables, rate_card, recognised_to_date: Math.round(contracted * (completed ? 1 : pick([0.2, 0.4, 0.6]))), status: completed ? "Completed" : "Active" });
    }
  }
  seedMinutes.push({
    contact_url: url, meeting_no: 1, meeting_stage: stage,
    date_agreed: mAgreed, date_scheduled: stage === "Agreed - not scheduled" ? undefined : mSched, date_held: stage === "Held" ? mHeld : undefined,
    type: pick(MEETING_TYPE), location: pick(["Their office", "Coffee near Liverpool St", "Video call", "Lunch in the City", "Industry conference"]),
    attendees_ours: OWNER.name, attendees_client: full,
    purpose: "Introductory meeting / explore where we could help.",
    notes: `Good conversation with ${full}. ${stage === "Held" ? `Discussed ${pain}.` : "Looking forward to it."}`,
    org_insights: stage === "Held" ? `${c.company} is dealing with ${pain}.` : undefined,
    pain_points: stage === "Held" ? pain : undefined,
    opportunity_spotted: spots ? "Yes" : "No",
    actions_mine: stage === "Held" ? pick(["Send follow-up + relevant case study", "Draft a one-pager", "Introduce a colleague"]) : undefined,
    actions_theirs: stage === "Held" ? "Share more detail on the current setup" : undefined,
    followup: stage === "Held" ? "Reconnect in two weeks" : undefined,
    followup_date: stage === "Held" ? isoDay((i % 18) + 2) : undefined,
    sentiment: pick(SENTIMENT),
    opportunity: opp,
  });
});

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
